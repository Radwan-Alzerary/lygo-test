const Ride = require("../model/ride");
const RideSetting = require("../model/rideSetting"); // Add RideSetting import
const { findNearbyCaptains } = require("../utils/helpers");

class DispatchService {
  constructor(logger, dependencies) {
    this.logger = logger;
    this.redisClient = dependencies.redisClient;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    /** حقن/تحديث خدمات السوكِت بعد إنشائها */
    // Socket services may be set later during initialization
    this.captainSocketService = dependencies.captainSocketService || null;
    this.customerSocketService = dependencies.customerSocketService || null;

    this.rideSettings = null; // Cache for ride settings
    this.backgroundIntervalId = null; // To manage background dispatcher
  }
  
  setSocketServices(captainSocketService, customerSocketService) {
    this.captainSocketService = captainSocketService;
    this.customerSocketService = customerSocketService;
    this.logger.info('[DispatchService] Socket services injected.');
  }

  async initialize() {
    // Load ride settings
    await this.loadRideSettings();
    this.logger.info('[DispatchService] Dispatch service initialized with settings.');
  }

  async loadRideSettings() {
    try {
      this.rideSettings = await RideSetting.findOne({ name: "default" });
      if (!this.rideSettings) {
        // Create default settings if none exist
        this.rideSettings = new RideSetting({});
        await this.rideSettings.save();
        this.logger.info('[DispatchService] Created default ride settings.');
      }
      this.logger.info('[DispatchService] Ride settings loaded successfully.');
      this.logCurrentSettings();
    } catch (err) {
      this.logger.error('[DispatchService] Error loading ride settings:', err);
      // Use default values if DB fails
      this.rideSettings = {
        dispatch: {
          initialRadiusKm: 2,
          maxRadiusKm: 10,
          radiusIncrementKm: 1,
          notificationTimeout: 15,
          maxDispatchTime: 300,
          graceAfterMaxRadius: 30
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
      - Grace after max radius: ${dispatch.graceAfterMaxRadius} seconds`);
  }

  validateDispatchSettings() {
    const dispatch = this.rideSettings.dispatch;

    // Validate radius settings
    if (dispatch.initialRadiusKm <= 0 || dispatch.maxRadiusKm <= 0 || dispatch.radiusIncrementKm <= 0) {
      this.logger.error('[DispatchService] Invalid radius settings detected. All radius values must be positive.');
      return false;
    }

    if (dispatch.initialRadiusKm > dispatch.maxRadiusKm) {
      this.logger.error('[DispatchService] Initial radius cannot be greater than max radius.');
      return false;
    }

    // Validate timeout settings
    if (dispatch.notificationTimeout <= 0 || dispatch.maxDispatchTime <= 0 || dispatch.graceAfterMaxRadius < 0) {
      this.logger.error('[DispatchService] Invalid timeout settings detected.');
      return false;
    }

    // Warn about potentially problematic settings
    if (dispatch.notificationTimeout > 60) {
      this.logger.warn('[DispatchService] Notification timeout is very high (>60s). This may lead to poor user experience.');
    }

    if (dispatch.maxDispatchTime < 60) {
      this.logger.warn('[DispatchService] Max dispatch time is very low (<60s). This may result in many failed dispatches.');
    }

    return true;
  }

  async dispatchRide(ride, origin) {
    // Ensure settings are loaded
    if (!this.rideSettings) {
      await this.loadRideSettings();
    }

    // Validate settings before dispatch
    if (!this.validateDispatchSettings()) {
      this.logger.error(`[Dispatch] Invalid dispatch settings. Cannot dispatch ride ${ride._id}`);
      return;
    }

    const rideId = ride._id.toString();
    const dispatch = this.rideSettings.dispatch;

    this.logger.info(`[Dispatch] Starting dispatch for ride ${rideId}. Origin: (${origin.longitude}, ${origin.latitude})`);
    this.logger.info(`[Dispatch] Using settings - Initial radius: ${dispatch.initialRadiusKm}km, Max: ${dispatch.maxRadiusKm}km, Timeout: ${dispatch.notificationTimeout}s`);

    let radius = dispatch.initialRadiusKm; // Starting radius from settings
    const maxRadius = dispatch.maxRadiusKm; // Maximum search radius from settings
    const radiusIncrement = dispatch.radiusIncrementKm; // Radius increment from settings
    const notificationTimeout = dispatch.notificationTimeout * 1000; // Convert to milliseconds
    const maxDispatchTime = dispatch.maxDispatchTime * 1000; // Convert to milliseconds
    const graceAfterMaxRadius = dispatch.graceAfterMaxRadius * 1000; // Convert to milliseconds

    const dispatchStartTime = Date.now();

    let cancelDispatch = false;
    let accepted = false; // Flag to track if ride was accepted

    // Cancellation function for this specific dispatch process
    const cancelFunc = () => {
      this.logger.warn(`[Dispatch] Cancellation requested externally for ride ${rideId}.`);
      cancelDispatch = true;
    };
    this.dispatchProcesses.set(rideId, cancelFunc);
    this.logger.debug(`[Dispatch] Registered cancellation function for ride ${rideId}`);

    try {
      // Keep track of all captains notified across all radius expansions
      const globalNotifiedCaptains = new Set();

      while (!cancelDispatch && !accepted && radius <= maxRadius) {
        // Check for overall timeout
        const elapsedTime = Date.now() - dispatchStartTime;
        if (elapsedTime >= maxDispatchTime) {
          this.logger.warn(`[Dispatch] Max dispatch time (${maxDispatchTime / 1000}s) exceeded for ride ${rideId}. Elapsed: ${elapsedTime / 1000}s`);
          cancelDispatch = true;
          break;
        }

        // Check if the ride object still exists and is 'requested' before searching
        const currentRideState = await Ride.findById(rideId).select('status');
        if (!currentRideState || currentRideState.status !== 'requested') {
          this.logger.warn(`[Dispatch] Ride ${rideId} is no longer in 'requested' state (current: ${currentRideState?.status}). Stopping dispatch.`);
          cancelDispatch = true;
          break;
        }

        this.logger.info(`[Dispatch] Ride ${rideId}: Searching radius ${radius} km (${radius}/${maxRadius}).`);
        const nearbyCaptainIds = await findNearbyCaptains(this.redisClient, this.logger, origin, radius);

        if (nearbyCaptainIds.length > 0) {
          // Filter out already notified captains and offline captains
          const newOnlineCaptains = nearbyCaptainIds.filter(captainId => 
            this.onlineCaptains[captainId] && !globalNotifiedCaptains.has(captainId)
          );

          if (newOnlineCaptains.length > 0) {
            this.logger.info(`[Dispatch] Ride ${rideId}: Found ${newOnlineCaptains.length} new online captains within ${radius}km radius.`);
            
            // Send notifications to ALL captains simultaneously
            const notificationPromises = newOnlineCaptains.map(captainId => {
              globalNotifiedCaptains.add(captainId); // Mark as notified
              
              this.logger.info(`[Dispatch] Ride ${rideId}: Notifying captain ${captainId}`);
              
              if (this.captainSocketService) {
                const sent = this.captainSocketService.emitToCaptain(captainId, "newRide", {
                  rideId: ride._id,
                  pickupLocation: ride.pickupLocation.coordinates,
                  dropoffLocation: ride.dropoffLocation.coordinates,
                  fare: ride.fare.amount,
                  currency: ride.fare.currency,
                  distance: ride.distance,
                  duration: ride.duration,
                  paymentMethod: ride.paymentMethod
                });

                if (!sent) {
                  this.logger.warn(`[Dispatch] Failed to send newRide notification to captain ${captainId} - captain may be offline`);
                }
                
                return sent;
              } else {
                this.logger.error(`[Dispatch] CaptainSocketService not available - cannot notify captain ${captainId}`);
                return false;
              }
            });

            // Wait for all notifications to be sent
            const notificationResults = await Promise.all(notificationPromises);
            const successfulNotifications = notificationResults.filter(result => result).length;
            
            this.logger.info(`[Dispatch] Ride ${rideId}: Successfully notified ${successfulNotifications}/${newOnlineCaptains.length} captains in radius ${radius}km`);

            // Wait for the notification timeout period to see if any captain accepts
            this.logger.debug(`[Dispatch] Ride ${rideId}: Waiting ${notificationTimeout / 1000}s for captains to respond.`);
            await new Promise((resolve) => setTimeout(resolve, notificationTimeout));

            // Check if the ride was accepted during the wait period
            const updatedRide = await Ride.findById(rideId).select('status driver');
            if (updatedRide && updatedRide.status === "accepted") {
              accepted = true;
              this.logger.info(`[Dispatch] Ride ${rideId} was accepted by captain ${updatedRide.driver} within ${notificationTimeout / 1000}s.`);
              break; // Exit the radius expansion loop
            } else {
              this.logger.info(`[Dispatch] Ride ${rideId}: No captain accepted within ${notificationTimeout / 1000}s. Current status: ${updatedRide?.status}`);
            }
          } else {
            this.logger.info(`[Dispatch] Ride ${rideId}: All ${nearbyCaptainIds.length} captains in radius ${radius}km were already notified or offline.`);
          }
        } else {
          this.logger.info(`[Dispatch] Ride ${rideId}: No captains found within radius ${radius} km.`);
        }

        // Increase radius only if not accepted and not cancelled
        if (!accepted && !cancelDispatch) {
          radius += radiusIncrement;
          this.logger.info(`[Dispatch] Ride ${rideId}: Increasing search radius to ${radius} km.`);
          
          // Small delay before expanding radius to avoid overwhelming the system
          if (radius <= maxRadius) {
            await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay before expanding
          }
        }
      } // End while loop

      // --- Handle Dispatch Outcome ---
      const finalRideState = await Ride.findById(rideId);

      if (accepted) {
        // Ride was accepted by someone, log success
        this.logger.info(`[Dispatch] Ride ${rideId} successfully accepted by captain ${finalRideState?.driver}. Dispatch process complete.`);
      } else if (cancelDispatch) {
        // Dispatch was cancelled externally or timed out
        this.logger.warn(`[Dispatch] Dispatch for ride ${rideId} was cancelled or timed out.`);
        
        if (Date.now() - dispatchStartTime >= maxDispatchTime && finalRideState && finalRideState.status === 'requested') {
          this.logger.warn(`[Dispatch] Ride ${rideId} timed out after ${maxDispatchTime / 1000}s. Updating status to 'notApprove'.`);
          finalRideState.status = "notApprove";
          finalRideState.isDispatching = false;
          finalRideState.dispatchEndTime = new Date();
          finalRideState.cancellationReason = `Dispatch timeout after ${maxDispatchTime / 1000}s`;
          await finalRideState.save();
          this.logger.info(`[DB] Ride ${rideId} status updated to 'notApprove'.`);

          // Notify customer
          this.customerSocketService?.emitToCustomer(finalRideState.passenger, 'rideNotApproved', {
            rideId: ride._id,
            message: "We couldn't find a nearby captain in time. Please try requesting again.",
            searchDuration: Math.round((Date.now() - dispatchStartTime) / 1000),
            maxRadius: maxRadius
          });
        }
      } else if (radius > maxRadius && !cancelDispatch && !accepted) {
        // Max radius reached — wait a final grace period before giving up
        this.logger.warn(
          `[Dispatch] Ride ${rideId}: reached max radius (${maxRadius} km). ` +
          `Holding for an extra ${graceAfterMaxRadius / 1000}s before aborting.`,
        );

        // Check periodically during grace period
        const pollInterval = 5 * 1000;
        const giveUpAt = Date.now() + graceAfterMaxRadius;

        while (Date.now() < giveUpAt && !accepted && !cancelDispatch) {
          await new Promise(res => setTimeout(res, pollInterval));

          const stillRequested = await Ride.findById(rideId).select('status driver');
          if (stillRequested?.status === 'accepted') {
            accepted = true;
            this.logger.info(
              `[Dispatch] Ride ${rideId} was accepted by captain ` +
              `${stillRequested.driver} during grace period.`,
            );
          }
        }

        if (!accepted && !cancelDispatch) {
          this.logger.warn(
            `[Dispatch] Ride ${rideId}: no acceptance after extra ${graceAfterMaxRadius / 1000}s. ` +
            `Updating status to 'notApprove'.`,
          );

          const rideDoc = await Ride.findById(rideId);
          if (rideDoc && rideDoc.status === 'requested') {
            rideDoc.status = 'notApprove';
            rideDoc.isDispatching = false;
            rideDoc.dispatchEndTime = new Date();
            rideDoc.cancellationReason = `No captain found within ${maxRadius}km radius after ${(Date.now() - dispatchStartTime) / 1000}s`;
            await rideDoc.save();
            this.logger.info(`[DB] Ride ${rideId} status updated to 'notApprove'.`);

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
          this.logger.info(`[DB] Marked ride ${rideId} as 'failed' due to dispatch error.`);

          this.customerSocketService?.emitToCustomer(rideToUpdate.passenger, 'rideError', {
            rideId: rideToUpdate._id,
            message: 'An error occurred while searching for captains. Please try again.',
          });
        }
      } catch (saveErr) {
        this.logger.error(`[Dispatch] Failed to update ride ${rideId} status after dispatch error:`, saveErr);
      }
    } finally {
      // Clean up Dispatch Process
      if (this.dispatchProcesses.has(rideId)) {
        this.dispatchProcesses.delete(rideId);
        this.logger.info(`[Dispatch] Cleaned up dispatch process entry for ride ${rideId}.`);
        this.logger.debug(`[Dispatch] Active dispatch processes: ${Array.from(this.dispatchProcesses.keys())}`);
      }
    }
  }

  // Background dispatcher to check for missed rides
  startBackgroundDispatcher() {
    // Use a configurable interval, but with a sensible default
    const dispatchCheckInterval = (this.rideSettings?.dispatch?.notificationTimeout || 15) * 2 * 1000; // 2x notification timeout, minimum 30s
    const finalInterval = Math.max(30000, Math.min(dispatchCheckInterval, 120000)); // Between 30s and 2 minutes

    this.logger.info(`[Dispatch] Background dispatcher check interval set to ${finalInterval / 1000}s.`);

    // Clear any existing interval
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
    }

    this.backgroundIntervalId = setInterval(async () => {
      this.logger.debug('[Dispatch Interval] Checking for requested rides needing dispatch...');
      try {
        // Find rides that are 'requested' but NOT currently being handled by an active dispatch process
        const ridesToDispatch = await Ride.find({
          status: 'requested',
          isDispatching: { $ne: true }, // Also check the isDispatching flag
          _id: { $nin: Array.from(this.dispatchProcesses.keys()) } // Find rides not in the active dispatch map
        });

        if (ridesToDispatch.length > 0) {
          this.logger.info(`[Dispatch Interval] Found ${ridesToDispatch.length} requested rides potentially needing dispatch: ${ridesToDispatch.map(r => r._id).join(', ')}`);

          for (const ride of ridesToDispatch) {
            // Double check if a process was somehow created just now
            if (this.dispatchProcesses.has(ride._id.toString())) {
              this.logger.warn(`[Dispatch Interval] Dispatch process for ride ${ride._id} already exists. Skipping.`);
              continue;
            }

            // Check if ride is too old (older than max dispatch time + grace period)
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

            // Mark as dispatching to prevent duplicate processing
            ride.isDispatching = true;
            await ride.save();

            const originCoords = {
              latitude: ride.pickupLocation.coordinates[1],
              longitude: ride.pickupLocation.coordinates[0],
            };

            // Start dispatch (don't await - let it run in background)
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

  // Stop background dispatcher
  stopBackgroundDispatcher() {
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = null;
      this.logger.info('[DispatchService] Background dispatcher stopped.');
    }
  }

  // Refresh settings (can be called externally)
  async refreshSettings() {
    this.logger.info('[DispatchService] Refreshing ride settings...');
    await this.loadRideSettings();

    // Restart background dispatcher with new settings
    this.startBackgroundDispatcher();
  }

  // Get current settings (for external use)
  getCurrentSettings() {
    return this.rideSettings;
  }

  // Get dispatch statistics
  getDispatchStats() {
    const activeProcesses = this.dispatchProcesses.size;
    const settings = this.rideSettings?.dispatch || {};

    return {
      activeDispatches: activeProcesses,
      activeRideIds: Array.from(this.dispatchProcesses.keys()),
      settings: {
        initialRadiusKm: settings.initialRadiusKm,
        maxRadiusKm: settings.maxRadiusKm,
        radiusIncrementKm: settings.radiusIncrementKm,
        notificationTimeoutSeconds: settings.notificationTimeout,
        maxDispatchTimeSeconds: settings.maxDispatchTime,
        graceAfterMaxRadiusSeconds: settings.graceAfterMaxRadius
      }
    };
  }

  // Emergency stop all dispatch processes
  emergencyStopAllDispatches() {
    this.logger.warn('[DispatchService] Emergency stop requested for all dispatch processes.');

    for (const [rideId, cancelFunc] of this.dispatchProcesses.entries()) {
      this.logger.warn(`[DispatchService] Emergency stopping dispatch for ride ${rideId}`);
      cancelFunc();
    }

    // Clear the processes map
    this.dispatchProcesses.clear();
    this.logger.info('[DispatchService] All dispatch processes emergency stopped.');
  }
}

module.exports = DispatchService;