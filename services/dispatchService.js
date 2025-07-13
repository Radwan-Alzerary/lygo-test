const customer = require("../model/customer");
const Ride = require("../model/ride");
const RideSetting = require("../model/rideSetting");
const { findNearbyCaptains } = require("../utils/helpers");

class DispatchService {
  constructor(logger, dependencies) {
    this.logger = logger;
    this.redisClient = dependencies.redisClient;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    
    this.captainSocketService = dependencies.captainSocketService || null;
    this.customerSocketService = dependencies.customerSocketService || null;

    this.rideSettings = null;
    this.backgroundIntervalId = null;
    
    // Enhanced tracking structures
    this.rideNotifications = new Map(); // rideId -> Set of captainIds
    this.currentRadiusNotifications = new Map(); // rideId -> Set of captainIds for current radius
    
    // NEW: Track active dispatches with their current radius and state
    this.activeDispatches = new Map(); // rideId -> { radius, startTime, notifiedCaptains: Set, isWaiting: boolean }
    
    // NEW: Track monitoring intervals for each ride
    this.radiusMonitoringIntervals = new Map(); // rideId -> intervalId
    
    // NEW: Track rides that each captain has been notified about (to prevent duplicate notifications)
    this.captainRideHistory = new Map(); // captainId -> Set of rideIds
  }

  setSocketServices(captainSocketService, customerSocketService) {
    this.captainSocketService = captainSocketService;
    this.customerSocketService = customerSocketService;
    this.logger.info('[DispatchService] Socket services injected.');
  }

  async initialize() {
    await this.loadRideSettings();
    this.logger.info('[DispatchService] Dispatch service initialized with settings.');
  }

  async loadRideSettings() {
    try {
      this.rideSettings = await RideSetting.findOne({ name: "default" });
      if (!this.rideSettings) {
        this.rideSettings = new RideSetting({});
        await this.rideSettings.save();
        this.logger.info('[DispatchService] Created default ride settings.');
      }
      this.logger.info('[DispatchService] Ride settings loaded successfully.');
      this.logCurrentSettings();
    } catch (err) {
      this.logger.error('[DispatchService] Error loading ride settings:', err);
      this.rideSettings = {
        dispatch: {
          initialRadiusKm: 2,
          maxRadiusKm: 10,
          radiusIncrementKm: 1,
          notificationTimeout: 15,
          maxDispatchTime: 300,
          graceAfterMaxRadius: 30,
          captainMonitoringInterval: 3 // NEW: How often to check for new captains (seconds)
        }
      };
      this.logger.warn('[DispatchService] Using fallback default settings due to DB error.');
    }
  }

  logCurrentSettings() {
    const dispatch = this.rideSettings.dispatch;
    this.logger.info(`[DispatchService] Current dispatch settings:
      - Initial radius: ${dispatch.initialRadiusKm} km
      - Max radius: ${dispatch.maxRadiusKm} km  
      - Radius increment: ${dispatch.radiusIncrementKm} km
      - Notification timeout: ${dispatch.notificationTimeout} seconds
      - Max dispatch time: ${dispatch.maxDispatchTime} seconds (${dispatch.maxDispatchTime / 60} minutes)
      - Grace after max radius: ${dispatch.graceAfterMaxRadius} seconds
      - Captain monitoring interval: ${dispatch.captainMonitoringInterval || 3} seconds`);
  }

  validateDispatchSettings() {
    const dispatch = this.rideSettings.dispatch;

    if (dispatch.initialRadiusKm <= 0 || dispatch.maxRadiusKm <= 0 || dispatch.radiusIncrementKm <= 0) {
      this.logger.error('[DispatchService] Invalid radius settings detected. All radius values must be positive.');
      return false;
    }

    if (dispatch.initialRadiusKm > dispatch.maxRadiusKm) {
      this.logger.error('[DispatchService] Initial radius cannot be greater than max radius.');
      return false;
    }

    if (dispatch.notificationTimeout <= 0 || dispatch.maxDispatchTime <= 0 || dispatch.graceAfterMaxRadius < 0) {
      this.logger.error('[DispatchService] Invalid timeout settings detected.');
      return false;
    }

    if (dispatch.notificationTimeout > 60) {
      this.logger.warn('[DispatchService] Notification timeout is very high (>60s). This may lead to poor user experience.');
    }

    if (dispatch.maxDispatchTime < 60) {
      this.logger.warn('[DispatchService] Max dispatch time is very low (<60s). This may result in many failed dispatches.');
    }

    return true;
  }

  // NEW: Method to handle captain coming online
  async onCaptainOnline(captainId, location) {
    this.logger.debug(`[DispatchService] Captain ${captainId} came online at location: ${JSON.stringify(location)}`);
    
    // Check if captain is available (not busy with other rides)
    const isAvailable = await this.filterAvailableCaptains([captainId]);
    if (isAvailable.length === 0) {
      this.logger.debug(`[DispatchService] Captain ${captainId} is busy, not checking for rides`);
      return;
    }
    
    // Check all active dispatches to see if this captain should be notified
    for (const [rideId, dispatchInfo] of this.activeDispatches.entries()) {
      // Skip if captain was already notified about this ride
      if (this.captainRideHistory.get(captainId)?.has(rideId)) {
        continue;
      }

      // Skip if dispatch is not currently waiting (between radius expansions)
      if (!dispatchInfo.isWaiting) {
        continue;
      }

      try {
        // Check if captain is within current search radius
        const ride = await Ride.findById(rideId).select('pickupLocation status');
        if (!ride || ride.status !== 'requested') {
          continue;
        }

        const origin = {
          latitude: ride.pickupLocation.coordinates[1],
          longitude: ride.pickupLocation.coordinates[0]
        };

        // Calculate distance to captain
        const distance = this.calculateDistance(origin, location);
        
        if (distance <= dispatchInfo.radius) {
          this.logger.info(`[DispatchService] New available captain ${captainId} is within ${dispatchInfo.radius}km of ride ${rideId}. Notifying...`);
          await this.notifySingleCaptain(captainId, rideId);
        }
      } catch (err) {
        this.logger.error(`[DispatchService] Error checking new captain ${captainId} for ride ${rideId}:`, err);
      }
    }
  }

  // NEW: Method to continuously monitor for new captains within current radius
  startRadiusMonitoring(rideId, origin, radius) {
    const rideIdStr = rideId.toString();
    const monitoringInterval = (this.rideSettings.dispatch.captainMonitoringInterval || 3) * 1000;

    // Clear any existing monitoring for this ride
    this.stopRadiusMonitoring(rideId);

    const intervalId = setInterval(async () => {
      try {
        // Check if dispatch is still active
        if (!this.activeDispatches.has(rideIdStr)) {
          this.stopRadiusMonitoring(rideId);
          return;
        }

        const dispatchInfo = this.activeDispatches.get(rideIdStr);
        
        // Only monitor if we're currently waiting for responses
        if (!dispatchInfo.isWaiting) {
          return;
        }

        // Check if ride is still in requested state
        const ride = await Ride.findById(rideId).select('status');
        if (!ride || ride.status !== 'requested') {
          this.stopRadiusMonitoring(rideId);
          return;
        }

        // Find captains within current radius
        const nearbyCaptainIds = await findNearbyCaptains(this.redisClient, this.logger, origin, radius);
        
        // Filter for available captains who haven't been notified about this ride
        const availableCaptains = await this.filterAvailableCaptains(nearbyCaptainIds, rideId);
        const newCaptains = availableCaptains.filter(captainId => {
          return !this.rideNotifications.get(rideIdStr)?.has(captainId);
        });

        if (newCaptains.length > 0) {
          this.logger.info(`[DispatchService] Found ${newCaptains.length} new available captains for ride ${rideId} within ${radius}km radius during monitoring`);
          
          // Notify new captains
          for (const captainId of newCaptains) {
            await this.notifySingleCaptain(captainId, rideId);
          }
        }

      } catch (err) {
        this.logger.error(`[DispatchService] Error in radius monitoring for ride ${rideId}:`, err);
      }
    }, monitoringInterval);

    this.radiusMonitoringIntervals.set(rideIdStr, intervalId);
    this.logger.debug(`[DispatchService] Started radius monitoring for ride ${rideId} with ${monitoringInterval/1000}s interval`);
  }

  // NEW: Stop radius monitoring for a specific ride
  stopRadiusMonitoring(rideId) {
    const rideIdStr = rideId.toString();
    const intervalId = this.radiusMonitoringIntervals.get(rideIdStr);
    
    if (intervalId) {
      clearInterval(intervalId);
      this.radiusMonitoringIntervals.delete(rideIdStr);
      this.logger.debug(`[DispatchService] Stopped radius monitoring for ride ${rideId}`);
    }
  }

  // NEW: Notify a single captain about a ride
  async notifySingleCaptain(captainId, rideId) {
    try {
      const ride = await Ride.findById(rideId);
      if (!ride || ride.status !== 'requested') {
        return false;
      }

      const passenger = await customer.findById(ride.passenger)
        .select("name phoneNumber")
        .lean();

      // Track this notification
      if (!this.rideNotifications.has(rideId.toString())) {
        this.rideNotifications.set(rideId.toString(), new Set());
      }
      if (!this.currentRadiusNotifications.has(rideId.toString())) {
        this.currentRadiusNotifications.set(rideId.toString(), new Set());
      }
      if (!this.captainRideHistory.has(captainId)) {
        this.captainRideHistory.set(captainId, new Set());
      }

      this.rideNotifications.get(rideId.toString()).add(captainId);
      this.currentRadiusNotifications.get(rideId.toString()).add(captainId);
      this.captainRideHistory.get(captainId).add(rideId.toString());

      if (this.captainSocketService) {
        const sent = this.captainSocketService.emitToCaptain(captainId, "newRide", {
          rideId: ride._id,
          pickupLocation: ride.pickupLocation.coordinates,
          dropoffLocation: ride.dropoffLocation.coordinates,
          fare: ride.fare.amount,
          currency: ride.fare.currency,
          distance: ride.distance,
          duration: ride.duration,
          paymentMethod: ride.paymentMethod,
          pickupName: ride.pickupLocation.locationName,
          dropoffName: ride.dropoffLocation.locationName,
          passengerInfo: {
            id: passenger?._id,
            name: passenger?.name,
            phoneNumber: passenger?.phoneNumber,
          }
        });

        if (sent) {
          this.logger.info(`[DispatchService] Successfully notified captain ${captainId} about ride ${rideId}`);
          return true;
        } else {
          this.logger.warn(`[DispatchService] Failed to notify captain ${captainId} about ride ${rideId} - captain may be offline`);
          // Remove from tracking if notification failed
          this.rideNotifications.get(rideId.toString()).delete(captainId);
          this.currentRadiusNotifications.get(rideId.toString()).delete(captainId);
          this.captainRideHistory.get(captainId).delete(rideId.toString());
          return false;
        }
      } else {
        this.logger.error(`[DispatchService] CaptainSocketService not available`);
        return false;
      }
    } catch (err) {
      this.logger.error(`[DispatchService] Error notifying captain ${captainId} about ride ${rideId}:`, err);
      return false;
    }
  }

  // NEW: Calculate distance between two points (simple approximation)
  calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.deg2rad(point2.latitude - point1.latitude);
    const dLon = this.deg2rad(point2.longitude - point1.longitude);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(point1.latitude)) * Math.cos(this.deg2rad(point2.latitude)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in km
    return distance;
  }

  deg2rad(deg) {
    return deg * (Math.PI/180);
  }

  // NEW: Filter captains to get only available ones (online and not busy)
  async filterAvailableCaptains(captainIds, currentRideId = null) {
    const availableCaptains = [];
    
    for (const captainId of captainIds) {
      // Check if captain is online
      if (!this.onlineCaptains[captainId]) {
        this.logger.debug(`[DispatchService] Captain ${captainId} is offline`);
        continue;
      }

      try {
        // Check if captain is currently busy with another ride
        const currentRide = await Ride.findOne({
          driver: captainId,
          status: { $in: ['accepted', 'onWay', 'arrived', 'onRide'] }
        }).select('_id status');

        if (currentRide) {
          // If it's the same ride as the current one being dispatched, consider captain as available
          if (currentRideId && currentRide._id.toString() === currentRideId.toString()) {
            this.logger.debug(`[DispatchService] Captain ${captainId} is assigned to current ride ${currentRideId}`);
            availableCaptains.push(captainId);
          } else {
            this.logger.debug(`[DispatchService] Captain ${captainId} is busy with ride ${currentRide._id} (status: ${currentRide.status})`);
          }
        } else {
          // Captain is not busy with any ride
          availableCaptains.push(captainId);
        }
      } catch (err) {
        this.logger.error(`[DispatchService] Error checking captain ${captainId} availability:`, err);
        // In case of error, assume captain is available to avoid blocking
        availableCaptains.push(captainId);
      }
    }

    this.logger.debug(`[DispatchService] Filtered ${availableCaptains.length} available captains from ${captainIds.length} total captains`);
    return availableCaptains;
  }

  async dispatchRide(ride, origin) {
    if (!this.rideSettings) {
      await this.loadRideSettings();
    }

    if (!this.validateDispatchSettings()) {
      this.logger.error(`[Dispatch] Invalid dispatch settings. Cannot dispatch ride ${ride._id}`);
      return;
    }

    const rideId = ride._id.toString();
    const dispatch = this.rideSettings.dispatch;

    // Initialize tracking
    this.rideNotifications.set(rideId, new Set());
    this.currentRadiusNotifications.set(rideId, new Set());
    
    // NEW: Initialize active dispatch tracking
    this.activeDispatches.set(rideId, {
      radius: dispatch.initialRadiusKm,
      startTime: Date.now(),
      notifiedCaptains: new Set(),
      isWaiting: false
    });

    this.logger.info(`[Dispatch] Starting enhanced dispatch for ride ${rideId}. Origin: (${origin.longitude}, ${origin.latitude})`);
    this.logger.info(`[Dispatch] Using settings - Initial radius: ${dispatch.initialRadiusKm}km, Max: ${dispatch.maxRadiusKm}km, Timeout: ${dispatch.notificationTimeout}s`);

    let radius = dispatch.initialRadiusKm;
    const maxRadius = dispatch.maxRadiusKm;
    const radiusIncrement = dispatch.radiusIncrementKm;
    const notificationTimeout = dispatch.notificationTimeout * 1000;
    const maxDispatchTime = dispatch.maxDispatchTime * 1000;
    const graceAfterMaxRadius = dispatch.graceAfterMaxRadius * 1000;

    const dispatchStartTime = Date.now();
    let cancelDispatch = false;
    let accepted = false;

    const passenger = await customer.findById(ride.passenger)
      .select("name phoneNumber")
      .lean();

    // Cancellation function
    const cancelFunc = () => {
      this.logger.warn(`[Dispatch] Cancellation requested externally for ride ${rideId}.`);
      cancelDispatch = true;
    };
    this.dispatchProcesses.set(rideId, cancelFunc);

    try {
      while (!cancelDispatch && !accepted && radius <= maxRadius) {
        // Check for overall timeout
        const elapsedTime = Date.now() - dispatchStartTime;
        if (elapsedTime >= maxDispatchTime) {
          this.logger.warn(`[Dispatch] Max dispatch time (${maxDispatchTime / 1000}s) exceeded for ride ${rideId}. Elapsed: ${elapsedTime / 1000}s`);
          cancelDispatch = true;
          break;
        }

        // Check ride status
        const currentRideState = await Ride.findById(rideId).select('status');
        if (!currentRideState || currentRideState.status !== 'requested') {
          this.logger.warn(`[Dispatch] Ride ${rideId} is no longer in 'requested' state (current: ${currentRideState?.status}). Stopping dispatch.`);
          cancelDispatch = true;
          break;
        }

        this.logger.info(`[Dispatch] Ride ${rideId}: Searching radius ${radius} km (${radius}/${maxRadius}).`);
        
        // Update active dispatch info
        this.activeDispatches.get(rideId).radius = radius;
        this.activeDispatches.get(rideId).isWaiting = false;
        
        // Clear current radius notifications
        this.currentRadiusNotifications.set(rideId, new Set());
        
        // Find captains in current radius
        const nearbyCaptainIds = await findNearbyCaptains(this.redisClient, this.logger, origin, radius);

        if (nearbyCaptainIds.length > 0) {
          // Filter for available captains (online and not busy)
          const globalNotifiedCaptains = this.rideNotifications.get(rideId);
          const availableCaptains = await this.filterAvailableCaptains(nearbyCaptainIds, rideId);
          const newAvailableCaptains = availableCaptains.filter(captainId =>
            !globalNotifiedCaptains.has(captainId)
          );

          if (newAvailableCaptains.length > 0) {
            this.logger.info(`[Dispatch] Ride ${rideId}: Found ${newAvailableCaptains.length} new available captains within ${radius}km radius.`);

            // Notify all new available captains
            const notificationPromises = newAvailableCaptains.map(captainId => 
              this.notifySingleCaptain(captainId, rideId)
            );

            const notificationResults = await Promise.all(notificationPromises);
            const successfulNotifications = notificationResults.filter(result => result).length;

            this.logger.info(`[Dispatch] Ride ${rideId}: Successfully notified ${successfulNotifications}/${newAvailableCaptains.length} available captains in radius ${radius}km`);

            // NEW: Start continuous monitoring for new captains
            this.activeDispatches.get(rideId).isWaiting = true;
            this.startRadiusMonitoring(rideId, origin, radius);

            // Wait for notification timeout
            this.logger.debug(`[Dispatch] Ride ${rideId}: Waiting ${notificationTimeout / 1000}s for captains to respond (with continuous monitoring).`);
            await new Promise((resolve) => setTimeout(resolve, notificationTimeout));

            // Stop monitoring for this radius
            this.stopRadiusMonitoring(rideId);
            this.activeDispatches.get(rideId).isWaiting = false;

            // Check if ride was accepted
            const updatedRide = await Ride.findById(rideId).select('status driver');
            if (updatedRide && updatedRide.status === "accepted") {
              accepted = true;
              this.logger.info(`[Dispatch] Ride ${rideId} was accepted by captain ${updatedRide.driver} within ${notificationTimeout / 1000}s.`);
              
              this.notifyCaptainsToHideRide(rideId, updatedRide.driver);
              break;
            } else {
              this.logger.info(`[Dispatch] Ride ${rideId}: No captain accepted within ${notificationTimeout / 1000}s. Current status: ${updatedRide?.status}`);
              
              if (radius < maxRadius) {
                this.notifyCurrentRadiusCaptainsToHide(rideId, `timeout_radius_${radius}km`);
              }
            }
          } else {
            this.logger.info(`[Dispatch] Ride ${rideId}: All ${availableCaptains.length} available captains in radius ${radius}km were already notified. Total found: ${nearbyCaptainIds.length}`);
          }
        } else {
          this.logger.info(`[Dispatch] Ride ${rideId}: No captains found within radius ${radius} km.`);
        }

        // Increase radius
        if (!accepted && !cancelDispatch) {
          radius += radiusIncrement;
          this.logger.info(`[Dispatch] Ride ${rideId}: Increasing search radius to ${radius} km.`);

          if (radius <= maxRadius) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
      }

      // Handle dispatch outcome
      const finalRideState = await Ride.findById(rideId);

      if (accepted) {
        this.logger.info(`[Dispatch] Ride ${rideId} successfully accepted by captain ${finalRideState?.driver}. Dispatch process complete.`);
      } else if (cancelDispatch) {
        this.logger.warn(`[Dispatch] Dispatch for ride ${rideId} was cancelled or timed out.`);

        if (Date.now() - dispatchStartTime >= maxDispatchTime && finalRideState && finalRideState.status === 'requested') {
          this.logger.warn(`[Dispatch] Ride ${rideId} timed out after ${maxDispatchTime / 1000}s. Updating status to 'notApprove'.`);
          finalRideState.status = "notApprove";
          finalRideState.isDispatching = false;
          finalRideState.dispatchEndTime = new Date();
          finalRideState.cancellationReason = `Dispatch timeout after ${maxDispatchTime / 1000}s`;
          await finalRideState.save();

          this.notifyCaptainsToHideRide(rideId, null, 'dispatch_timeout');

          this.customerSocketService?.emitToCustomer(finalRideState.passenger, 'rideNotApproved', {
            rideId: ride._id,
            message: "We couldn't find a nearby captain in time. Please try requesting again.",
            searchDuration: Math.round((Date.now() - dispatchStartTime) / 1000),
            maxRadius: maxRadius
          });
        }
      } else if (radius > maxRadius && !cancelDispatch && !accepted) {
        // Handle max radius reached
        this.logger.warn(`[Dispatch] Ride ${rideId}: reached max radius (${maxRadius} km). Holding for an extra ${graceAfterMaxRadius / 1000}s before aborting.`);

        const pollInterval = 5 * 1000;
        const giveUpAt = Date.now() + graceAfterMaxRadius;

        while (Date.now() < giveUpAt && !accepted && !cancelDispatch) {
          await new Promise(res => setTimeout(res, pollInterval));

          const stillRequested = await Ride.findById(rideId).select('status driver');
          if (stillRequested?.status === 'accepted') {
            accepted = true;
            this.logger.info(`[Dispatch] Ride ${rideId} was accepted by captain ${stillRequested.driver} during grace period.`);
            this.notifyCaptainsToHideRide(rideId, stillRequested.driver);
          }
        }

        if (!accepted && !cancelDispatch) {
          this.logger.warn(`[Dispatch] Ride ${rideId}: no acceptance after extra ${graceAfterMaxRadius / 1000}s. Updating status to 'notApprove'.`);

          const rideDoc = await Ride.findById(rideId);
          if (rideDoc && rideDoc.status === 'requested') {
            rideDoc.status = 'notApprove';
            rideDoc.isDispatching = false;
            rideDoc.dispatchEndTime = new Date();
            rideDoc.cancellationReason = `No captain found within ${maxRadius}km radius after ${(Date.now() - dispatchStartTime) / 1000}s`;
            await rideDoc.save();

            this.notifyCaptainsToHideRide(rideId, null, 'max_radius_reached');

            this.customerSocketService?.emitToCustomer(rideDoc.passenger, 'rideNotApproved', {
              rideId: rideDoc._id,
              message: 'لم نعثر على كابتن قريب في الوقت الحالي، الرجاء المحاولة مرة أخرى لاحقاً.',
              searchDuration: Math.round((Date.now() - dispatchStartTime) / 1000),
              maxRadius: maxRadius
            });
          }
        }
      }

    } catch (err) {
      this.logger.error(`[Dispatch] Error during dispatch process for ride ${rideId}:`, err);

      try {
        const rideToUpdate = await Ride.findById(rideId);
        if (rideToUpdate && rideToUpdate.status === 'requested') {
          rideToUpdate.status = 'failed';
          rideToUpdate.isDispatching = false;
          rideToUpdate.dispatchEndTime = new Date();
          rideToUpdate.cancellationReason = `Dispatch error: ${err.message}`;
          await rideToUpdate.save();

          this.notifyCaptainsToHideRide(rideId, null, 'dispatch_error');

          this.customerSocketService?.emitToCustomer(rideToUpdate.passenger, 'rideError', {
            rideId: rideToUpdate._id,
            message: 'An error occurred while searching for captains. Please try again.',
          });
        }
      } catch (saveErr) {
        this.logger.error(`[Dispatch] Failed to update ride ${rideId} status after dispatch error:`, saveErr);
      }
    } finally {
      // Enhanced cleanup
      this.stopRadiusMonitoring(rideId);
      
      if (this.dispatchProcesses.has(rideId)) {
        this.dispatchProcesses.delete(rideId);
      }
      
      // Clean up active dispatch tracking
      this.activeDispatches.delete(rideId);
      
      const finalRide = await Ride.findById(rideId).select('status');
      if (!finalRide || finalRide.status !== 'accepted') {
        this.cleanupRideNotifications(rideId);
      }
      
      this.logger.info(`[Dispatch] Cleaned up all tracking for ride ${rideId}.`);
    }
  }

  startBackgroundDispatcher() {
    const dispatchCheckInterval = (this.rideSettings?.dispatch?.notificationTimeout || 15) * 2 * 1000;
    const finalInterval = Math.max(30000, Math.min(dispatchCheckInterval, 120000));

    this.logger.info(`[Dispatch] Background dispatcher check interval set to ${finalInterval / 1000}s.`);

    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
    }

    this.backgroundIntervalId = setInterval(async () => {
      this.logger.debug('[Dispatch Interval] Checking for requested rides needing dispatch...');
      try {
        const ridesToDispatch = await Ride.find({
          status: 'requested',
          isDispatching: { $ne: true },
          _id: { $nin: Array.from(this.dispatchProcesses.keys()) }
        });

        if (ridesToDispatch.length > 0) {
          this.logger.info(`[Dispatch Interval] Found ${ridesToDispatch.length} requested rides potentially needing dispatch: ${ridesToDispatch.map(r => r._id).join(', ')}`);

          for (const ride of ridesToDispatch) {
            if (this.dispatchProcesses.has(ride._id.toString())) {
              this.logger.warn(`[Dispatch Interval] Dispatch process for ride ${ride._id} already exists. Skipping.`);
              continue;
            }

            const maxAge = (this.rideSettings?.dispatch?.maxDispatchTime || 300) + (this.rideSettings?.dispatch?.graceAfterMaxRadius || 30);
            const rideAge = (Date.now() - new Date(ride.createdAt)) / 1000;

            if (rideAge > maxAge) {
              this.logger.warn(`[Dispatch Interval] Ride ${ride._id} is too old (${rideAge}s > ${maxAge}s). Marking as expired.`);
              ride.status = 'notApprove';
              ride.isDispatching = false;
              ride.cancellationReason = `Ride expired - too old (${Math.round(rideAge)}s)`;
              await ride.save();

              this.customerSocketService?.emitToCustomer(ride.passenger, 'rideNotApproved', {
                rideId: ride._id,
                message: 'Your ride request has expired. Please try requesting again.',
              });
              continue;
            }

            this.logger.info(`[Dispatch Interval] Initiating dispatch for ride ${ride._id} (age: ${Math.round(rideAge)}s)`);

            ride.isDispatching = true;
            await ride.save();

            const originCoords = {
              latitude: ride.pickupLocation.coordinates[1],
              longitude: ride.pickupLocation.coordinates[0],
            };

            this.dispatchRide(ride, originCoords);
          }
        } else {
          this.logger.debug('[Dispatch Interval] No requested rides found needing dispatch initiation.');
        }
      } catch (err) {
        this.logger.error("[Dispatch Interval] Error checking for dispatchable rides:", err);
      }
    }, finalInterval);
  }

  stopBackgroundDispatcher() {
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = null;
      this.logger.info('[DispatchService] Background dispatcher stopped.');
    }
  }

  async refreshSettings() {
    this.logger.info('[DispatchService] Refreshing ride settings...');
    await this.loadRideSettings();
    this.startBackgroundDispatcher();
  }

  getCurrentSettings() {
    return this.rideSettings;
  }

  getDispatchStats() {
    const activeProcesses = this.dispatchProcesses.size;
    const settings = this.rideSettings?.dispatch || {};

    return {
      activeDispatches: activeProcesses,
      activeRideIds: Array.from(this.dispatchProcesses.keys()),
      activeNotifications: this.rideNotifications.size,
      activeDispatchDetails: Array.from(this.activeDispatches.entries()).map(([rideId, info]) => ({
        rideId,
        currentRadius: info.radius,
        isWaiting: info.isWaiting,
        elapsedTime: Math.round((Date.now() - info.startTime) / 1000)
      })),
      monitoringIntervals: this.radiusMonitoringIntervals.size,
      settings: {
        initialRadiusKm: settings.initialRadiusKm,
        maxRadiusKm: settings.maxRadiusKm,
        radiusIncrementKm: settings.radiusIncrementKm,
        notificationTimeoutSeconds: settings.notificationTimeout,
        maxDispatchTimeSeconds: settings.maxDispatchTime,
        graceAfterMaxRadiusSeconds: settings.graceAfterMaxRadius,
        captainMonitoringIntervalSeconds: settings.captainMonitoringInterval || 3
      }
    };
  }

  emergencyStopAllDispatches() {
    this.logger.warn('[DispatchService] Emergency stop requested for all dispatch processes.');

    for (const [rideId, cancelFunc] of this.dispatchProcesses.entries()) {
      this.logger.warn(`[DispatchService] Emergency stopping dispatch for ride ${rideId}`);
      this.notifyCaptainsToHideRide(rideId, null, 'emergency_stop');
      this.stopRadiusMonitoring(rideId);
      cancelFunc();
    }

    this.dispatchProcesses.clear();
    this.activeDispatches.clear();
    
    // Clear all monitoring intervals
    for (const intervalId of this.radiusMonitoringIntervals.values()) {
      clearInterval(intervalId);
    }
    this.radiusMonitoringIntervals.clear();

    const trackedRides = Array.from(this.rideNotifications.keys());
    this.rideNotifications.clear();
    this.currentRadiusNotifications.clear();
    this.logger.info(`[DispatchService] Cleaned up notification tracking for ${trackedRides.length} rides during emergency stop.`);
    
    this.logger.info('[DispatchService] All dispatch processes emergency stopped.');
  }

  getNotifiedCaptains(rideId) {
    return this.rideNotifications.get(rideId.toString()) || new Set();
  }

  cleanupRideNotifications(rideId) {
    const rideIdStr = rideId.toString();
    if (this.rideNotifications.has(rideIdStr)) {
      const notifiedCount = this.rideNotifications.get(rideIdStr).size;
      this.rideNotifications.delete(rideIdStr);
      this.logger.info(`[Dispatch] Cleaned up notification tracking for ride ${rideIdStr}. ${notifiedCount} captains were notified.`);
    }
    
    if (this.currentRadiusNotifications.has(rideIdStr)) {
      this.currentRadiusNotifications.delete(rideIdStr);
    }
  }

  notifyCurrentRadiusCaptainsToHide(rideId, reason = 'timeout') {
    const rideIdStr = rideId.toString();
    const currentRadiusCaptains = this.currentRadiusNotifications.get(rideIdStr);
    
    if (!currentRadiusCaptains || currentRadiusCaptains.size === 0) {
      this.logger.debug(`[Dispatch] No current radius captains to notify for hiding ride ${rideIdStr}`);
      return;
    }

    let notifiedCount = 0;
    const failedNotifications = [];

    currentRadiusCaptains.forEach(captainId => {
      if (this.captainSocketService) {
        const sent = this.captainSocketService.emitToCaptain(captainId, "hideRide", {
          rideId: rideId,
          reason: reason,
          message: this.getHideMessage(reason)
        });
        
        if (sent) {
          notifiedCount++;
          this.logger.debug(`[Dispatch] Notified captain ${captainId} to hide ride ${rideIdStr} (reason: ${reason})`);
        } else {
          failedNotifications.push(captainId);
          this.logger.warn(`[Dispatch] Failed to notify captain ${captainId} to hide ride ${rideIdStr} - captain may be offline`);
        }
      } else {
        failedNotifications.push(captainId);
        this.logger.error(`[Dispatch] CaptainSocketService not available - cannot notify captain ${captainId} to hide ride ${rideIdStr}`);
      }
    });

    this.logger.info(`[Dispatch] Notified ${notifiedCount} current radius captains to hide ride ${rideIdStr} (reason: ${reason}). Failed: ${failedNotifications.length}`);
    
    if (failedNotifications.length > 0) {
      this.logger.warn(`[Dispatch] Failed to notify current radius captains to hide ride ${rideIdStr}: ${failedNotifications.join(', ')}`);
    }
    
    this.currentRadiusNotifications.set(rideIdStr, new Set());
  }

  notifyCaptainsToHideRide(rideId, excludeCaptainId = null, reason = 'ride_taken') {
    const rideIdStr = rideId.toString();
    const notifiedCaptains = this.rideNotifications.get(rideIdStr);
    
    if (!notifiedCaptains || notifiedCaptains.size === 0) {
      this.logger.debug(`[Dispatch] No captains to notify for hiding ride ${rideIdStr}`);
      return;
    }

    let notifiedCount = 0;
    const failedNotifications = [];

    notifiedCaptains.forEach(captainId => {
      if (captainId !== excludeCaptainId) {
        if (this.captainSocketService) {
          const sent = this.captainSocketService.emitToCaptain(captainId, "hideRide", {
            rideId: rideId,
            reason: reason,
            message: this.getHideMessage(reason)
          });
          
          if (sent) {
            notifiedCount++;
            this.logger.debug(`[Dispatch] Notified captain ${captainId} to hide ride ${rideIdStr} (reason: ${reason})`);
          } else {
            failedNotifications.push(captainId);
            this.logger.warn(`[Dispatch] Failed to notify captain ${captainId} to hide ride ${rideIdStr} - captain may be offline`);
          }
        } else {
          failedNotifications.push(captainId);
          this.logger.error(`[Dispatch] CaptainSocketService not available - cannot notify captain ${captainId} to hide ride ${rideIdStr}`);
        }
      }
    });

    this.logger.info(`[Dispatch] Notified ${notifiedCount} captains to hide ride ${rideIdStr} (reason: ${reason}). Failed: ${failedNotifications.length}`);
    
    if (failedNotifications.length > 0) {
      this.logger.warn(`[Dispatch] Failed to notify captains to hide ride ${rideIdStr}: ${failedNotifications.join(', ')}`);
    }
    
    this.cleanupRideNotifications(rideIdStr);
  }

  getHideMessage(reason) {
    const messages = {
      'ride_taken': 'This ride has been taken by another captain.',
      'dispatch_timeout': 'This ride request has timed out.',
      'max_radius_reached': 'No captain found for this ride.',
      'dispatch_error': 'An error occurred with this ride request.',
      'emergency_stop': 'Dispatch service was stopped.',
      'timeout': 'Searching for captains in a wider area.'
    };
    
    if (reason.includes('timeout_radius_')) {
      return 'Searching for captains in a wider area.';
    }
    
    return messages[reason] || 'This ride is no longer available.';
  }

  onCaptainOffline(captainId) {
    if (this.captainRideHistory.has(captainId)) {
      this.captainRideHistory.delete(captainId);
      this.logger.debug(`[DispatchService] Cleaned up ride history for offline captain ${captainId}`);
    }
  }

  // NEW: Handle captain becoming available after completing a ride
  async onCaptainAvailable(captainId, location) {
    this.logger.debug(`[DispatchService] Captain ${captainId} became available after completing a ride`);
    
    // Clear any previous ride history for this captain to allow re-notification
    if (this.captainRideHistory.has(captainId)) {
      this.captainRideHistory.delete(captainId);
    }
    
    // Check all active dispatches to see if this captain should be notified
    for (const [rideId, dispatchInfo] of this.activeDispatches.entries()) {
      try {
        // Check if captain is within current search radius
        const ride = await Ride.findById(rideId).select('pickupLocation status');
        if (!ride || ride.status !== 'requested') {
          continue;
        }

        const origin = {
          latitude: ride.pickupLocation.coordinates[1],
          longitude: ride.pickupLocation.coordinates[0]
        };

        // Calculate distance to captain
        const distance = this.calculateDistance(origin, location);
        
        if (distance <= dispatchInfo.radius) {
          this.logger.info(`[DispatchService] Newly available captain ${captainId} is within ${dispatchInfo.radius}km of ride ${rideId}. Notifying...`);
          await this.notifySingleCaptain(captainId, rideId);
        }
      } catch (err) {
        this.logger.error(`[DispatchService] Error checking newly available captain ${captainId} for ride ${rideId}:`, err);
      }
    }
  }

  // NEW: Re-evaluate active dispatches when a captain becomes available
  async reevaluateActiveDispatches() {
    this.logger.debug(`[DispatchService] Re-evaluating ${this.activeDispatches.size} active dispatches for newly available captains`);
    
    for (const [rideId, dispatchInfo] of this.activeDispatches.entries()) {
      // Only re-evaluate if dispatch is currently waiting
      if (!dispatchInfo.isWaiting) {
        continue;
      }

      try {
        const ride = await Ride.findById(rideId).select('pickupLocation status');
        if (!ride || ride.status !== 'requested') {
          continue;
        }

        const origin = {
          latitude: ride.pickupLocation.coordinates[1],
          longitude: ride.pickupLocation.coordinates[0]
        };

        // Find captains in current radius and check for newly available ones
        const nearbyCaptainIds = await findNearbyCaptains(this.redisClient, this.logger, origin, dispatchInfo.radius);
        const availableCaptains = await this.filterAvailableCaptains(nearbyCaptainIds, rideId);
        const notifiedCaptains = this.rideNotifications.get(rideId) || new Set();
        
        const newlyAvailableCaptains = availableCaptains.filter(captainId => 
          !notifiedCaptains.has(captainId)
        );

        if (newlyAvailableCaptains.length > 0) {
          this.logger.info(`[DispatchService] Found ${newlyAvailableCaptains.length} newly available captains for ride ${rideId}`);
          
          // Notify newly available captains
          for (const captainId of newlyAvailableCaptains) {
            await this.notifySingleCaptain(captainId, rideId);
          }
        }
      } catch (err) {
        this.logger.error(`[DispatchService] Error re-evaluating ride ${rideId}:`, err);
      }
    }
  }
}

module.exports = DispatchService;