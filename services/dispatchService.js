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
    
    /** Socket services injection after creation */
    this.captainSocketService = dependencies.captainSocketService || null;
    this.customerSocketService = dependencies.customerSocketService || null;

    this.rideSettings = null; // Cache for ride settings
    this.backgroundIntervalId = null; // To manage background dispatcher
    
    // Track which captains were notified for each ride
    this.rideNotifications = new Map(); // rideId -> Set of captainIds
    // Track current radius notifications for each ride
    this.currentRadiusNotifications = new Map(); // rideId -> Set of captainIds for current radius
    
    // Analytics and monitoring
    this.dispatchMetrics = {
      totalDispatches: 0,
      successfulDispatches: 0,
      failedDispatches: 0,
      timeoutDispatches: 0,
      averageDispatchTime: 0,
      lastDispatchTime: null
    };
    
    // Performance monitoring
    this.performanceCounters = {
      activeDispatchPeakCount: 0,
      notificationsSentToday: 0,
      lastResetDate: new Date().toDateString()
    };
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

    // Initialize notification tracking for this ride
    this.rideNotifications.set(rideId, new Set());
    this.currentRadiusNotifications.set(rideId, new Set());

    // Update metrics
    this.dispatchMetrics.totalDispatches++;
    this.dispatchMetrics.lastDispatchTime = new Date();
    this.updatePerformanceCounters();

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

    const passenger = await customer.findById(ride.passenger)
      .select("name phoneNumber")
      .lean(); // Lightweight query without full Mongoose documents

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
        
        // Clear current radius notifications at the start of each radius
        this.currentRadiusNotifications.set(rideId, new Set());
        
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
              globalNotifiedCaptains.add(captainId);
              
              // Track this captain was notified for this ride
              this.rideNotifications.get(rideId).add(captainId);
              // Track this captain for current radius
              this.currentRadiusNotifications.get(rideId).add(captainId);

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
                  paymentMethod: ride.paymentMethod,
                  pickupName: ride.pickupLocation.locationName,
                  dropoffName: ride.dropoffLocation.locationName,
                  passengerInfo: {
                    id: passenger?._id,
                    name: passenger?.name,
                    phoneNumber: passenger?.phoneNumber,
                  }
                });
                
                if (!sent) {
                  this.logger.warn(`[Dispatch] Failed to send newRide notification to captain ${captainId} - captain may be offline`);
                  // Remove from tracking if notification failed
                  this.rideNotifications.get(rideId).delete(captainId);
                  this.currentRadiusNotifications.get(rideId).delete(captainId);
                } else {
                  // Update notification counter
                  this.performanceCounters.notificationsSentToday++;
                }
                return sent;
              } else {
                this.logger.error(`[Dispatch] CaptainSocketService not available - cannot notify captain ${captainId}`);
                // Remove from tracking if service not available
                this.rideNotifications.get(rideId).delete(captainId);
                this.currentRadiusNotifications.get(rideId).delete(captainId);
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
              
              // Notify all other captains to hide the ride
              this.notifyCaptainsToHideRide(rideId, updatedRide.driver);
              
              break; // Exit the radius expansion loop
            } else {
              this.logger.info(`[Dispatch] Ride ${rideId}: No captain accepted within ${notificationTimeout / 1000}s. Current status: ${updatedRide?.status}`);
              
              // Send hide to captains who were notified in this radius when timeout occurs
              if (radius < maxRadius) { // Don't hide if this is the last radius
                this.notifyCurrentRadiusCaptainsToHide(rideId, `timeout_radius_${radius}km`);
              }
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
      const dispatchDuration = Date.now() - dispatchStartTime;

      if (accepted) {
        // Ride was accepted by someone, log success
        this.logger.info(`[Dispatch] Ride ${rideId} successfully accepted by captain ${finalRideState?.driver}. Dispatch process complete in ${dispatchDuration / 1000}s.`);
        this.dispatchMetrics.successfulDispatches++;
        this.updateAverageDispatchTime(dispatchDuration);
      } else if (cancelDispatch) {
        // Dispatch was cancelled externally or timed out
        this.logger.warn(`[Dispatch] Dispatch for ride ${rideId} was cancelled or timed out after ${dispatchDuration / 1000}s.`);

        if (Date.now() - dispatchStartTime >= maxDispatchTime && finalRideState && finalRideState.status === 'requested') {
          this.logger.warn(`[Dispatch] Ride ${rideId} timed out after ${maxDispatchTime / 1000}s. Updating status to 'notApprove'.`);
          finalRideState.status = "notApprove";
          finalRideState.isDispatching = false;
          finalRideState.dispatchEndTime = new Date();
          finalRideState.cancellationReason = `Dispatch timeout after ${maxDispatchTime / 1000}s`;
          await finalRideState.save();
          this.logger.info(`[DB] Ride ${rideId} status updated to 'notApprove'.`);

          // Hide ride from all notified captains
          this.notifyCaptainsToHideRide(rideId, null, 'dispatch_timeout');

          // Notify customer
          this.customerSocketService?.emitToCustomer(finalRideState.passenger, 'rideNotApproved', {
            rideId: ride._id,
            message: "We couldn't find a nearby captain in time. Please try requesting again.",
            searchDuration: Math.round((Date.now() - dispatchStartTime) / 1000),
            maxRadius: maxRadius
          });

          this.dispatchMetrics.timeoutDispatches++;
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
            
            // Notify all other captains to hide the ride
            this.notifyCaptainsToHideRide(rideId, stillRequested.driver);
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
            this.logger.info(`[DB] Ride ${rideDoc._id} status updated to 'notApprove'.`);

            // Hide ride from all notified captains
            this.notifyCaptainsToHideRide(rideId, null, 'max_radius_reached');

            this.customerSocketService?.emitToCustomer(rideDoc.passenger, 'rideNotApproved', {
              rideId: rideDoc._id,
              message: 'لم نعثر على كابتن قريب في الوقت الحالي، الرجاء المحاولة مرة أخرى لاحقاً.',
              searchDuration: Math.round((Date.now() - dispatchStartTime) / 1000),
              maxRadius: maxRadius
            });

            this.dispatchMetrics.failedDispatches++;
          }
        }
      }

      // Update metrics if accepted during grace period
      if (accepted) {
        this.dispatchMetrics.successfulDispatches++;
        this.updateAverageDispatchTime(Date.now() - dispatchStartTime);
      }

    } catch (err) {
      this.logger.error(`[Dispatch] Error during dispatch process for ride ${rideId}:`, err);
      this.dispatchMetrics.failedDispatches++;

      try {
        const rideToUpdate = await Ride.findById(rideId);
        if (rideToUpdate && rideToUpdate.status === 'requested') {
          rideToUpdate.status = 'failed';
          rideToUpdate.isDispatching = false;
          rideToUpdate.dispatchEndTime = new Date();
          rideToUpdate.cancellationReason = `Dispatch error: ${err.message}`;
          await rideToUpdate.save();
          this.logger.info(`[DB] Marked ride ${rideId} as 'failed' due to dispatch error.`);

          // Hide ride from all notified captains due to error
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
      // Clean up Dispatch Process
      if (this.dispatchProcesses.has(rideId)) {
        this.dispatchProcesses.delete(rideId);
        this.logger.info(`[Dispatch] Cleaned up dispatch process entry for ride ${rideId}.`);
        this.logger.debug(`[Dispatch] Active dispatch processes: ${Array.from(this.dispatchProcesses.keys())}`);
      }
      
      // Clean up notification tracking only if ride was not accepted
      const finalRide = await Ride.findById(rideId).select('status');
      if (!finalRide || finalRide.status !== 'accepted') {
        this.cleanupRideNotifications(rideId);
      }
      // Note: If ride was accepted, cleanup will be handled by notifyCaptainsToHideRide method
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

  // ✅ NEW CAPTAIN RESPONSE HANDLING METHODS

  /**
   * Check if a captain was notified for a specific ride
   */
  wasCaptainNotified(rideId, captainId) {
    const rideIdStr = rideId.toString();
    const wasNotified = this.rideNotifications.has(rideIdStr) && 
                       this.rideNotifications.get(rideIdStr).has(captainId);
    
    this.logger.debug(`[Dispatch] Captain ${captainId} notification check for ride ${rideIdStr}: ${wasNotified ? 'YES' : 'NO'}`);
    return wasNotified;
  }

  /**
   * Handle captain rejecting a ride notification
   */
  handleCaptainRejection(rideId, captainId) {
    const rideIdStr = rideId.toString();
    
    // Remove captain from notification tracking
    let wasTracked = false;
    if (this.rideNotifications.has(rideIdStr)) {
      wasTracked = this.rideNotifications.get(rideIdStr).has(captainId);
      this.rideNotifications.get(rideIdStr).delete(captainId);
      
      if (wasTracked) {
        this.logger.info(`[Dispatch] Captain ${captainId} rejected ride ${rideIdStr}. Removed from notifications.`);
      } else {
        this.logger.debug(`[Dispatch] Captain ${captainId} rejected ride ${rideIdStr}, but was not in tracking (already processed).`);
      }
    }
    
    // Remove from current radius notifications if present
    if (this.currentRadiusNotifications.has(rideIdStr)) {
      this.currentRadiusNotifications.get(rideIdStr).delete(captainId);
    }
    
    // Calculate remaining notified captains
    const remainingNotifiedCaptains = this.rideNotifications.get(rideIdStr)?.size || 0;
    
    // Log rejection for analytics
    this.logger.info(`[Dispatch] Captain ${captainId} rejected ride ${rideIdStr}. Remaining notified captains: ${remainingNotifiedCaptains}`);
    
    // Return rejection stats for monitoring
    return {
      rideId: rideIdStr,
      captainId: captainId,
      timestamp: new Date(),
      wasTracked: wasTracked,
      remainingNotifiedCaptains: remainingNotifiedCaptains
    };
  }

  /**
   * Handle captain accepting a ride (stop dispatch process)
   */
  async handleCaptainAcceptance(rideId, captainId) {
    const rideIdStr = rideId.toString();
    
    this.logger.info(`[Dispatch] Processing captain ${captainId} acceptance of ride ${rideIdStr}`);
    
    // Cancel the dispatch process for this ride
    if (this.dispatchProcesses.has(rideIdStr)) {
      const cancelFunc = this.dispatchProcesses.get(rideIdStr);
      try {
        cancelFunc(); // This will stop the dispatch loop
        this.dispatchProcesses.delete(rideIdStr);
        this.logger.info(`[Dispatch] Successfully stopped dispatch process for accepted ride ${rideIdStr}`);
      } catch (error) {
        this.logger.error(`[Dispatch] Error stopping dispatch process for ride ${rideIdStr}:`, error);
      }
    } else {
      this.logger.warn(`[Dispatch] No active dispatch process found for accepted ride ${rideIdStr}`);
    }
    
    // Hide ride from all other captains
    try {
      this.notifyCaptainsToHideRide(rideId, captainId, 'ride_taken');
      this.logger.info(`[Dispatch] Notified other captains to hide accepted ride ${rideIdStr}`);
    } catch (error) {
      this.logger.error(`[Dispatch] Error notifying captains to hide accepted ride ${rideIdStr}:`, error);
    }
    
    this.logger.info(`[Dispatch] Captain ${captainId} acceptance of ride ${rideIdStr} processed successfully. Dispatch completed.`);
    
    return {
      rideId: rideIdStr,
      captainId: captainId,
      timestamp: new Date(),
      action: 'accepted',
      dispatchStopped: true
    };
  }

  /**
   * Handle captain canceling an active ride
   */
  async handleCaptainCancellation(rideId, captainId) {
    const rideIdStr = rideId.toString();
    
    this.logger.info(`[Dispatch] Processing captain ${captainId} cancellation of ride ${rideIdStr}`);
    
    // Clean up all tracking for this ride
    this.cleanupRideNotifications(rideIdStr);
    
    // Remove from dispatch processes if still active
    if (this.dispatchProcesses.has(rideIdStr)) {
      try {
        const cancelFunc = this.dispatchProcesses.get(rideIdStr);
        cancelFunc();
        this.dispatchProcesses.delete(rideIdStr);
        this.logger.info(`[Dispatch] Stopped dispatch process for cancelled ride ${rideIdStr}`);
      } catch (error) {
        this.logger.error(`[Dispatch] Error stopping dispatch process for cancelled ride ${rideIdStr}:`, error);
      }
    }
    
    this.logger.info(`[Dispatch] Captain ${captainId} cancellation of ride ${rideIdStr} processed. All tracking cleaned up.`);
    
    return {
      rideId: rideIdStr,
      captainId: captainId,
      timestamp: new Date(),
      action: 'cancelled',
      cleanupCompleted: true
    };
  }

  /**
   * Method to clean up notification tracking
   */
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

  /**
   * Method to notify current radius captains to hide ride (when timeout occurs)
   */
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
    
    // Clear current radius notifications after hiding
    this.currentRadiusNotifications.set(rideIdStr, new Set());
  }

  /**
   * Method to notify captains to hide a ride
   */
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
      // Don't notify the captain who accepted the ride
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
    
    // Clean up after notifying
    this.cleanupRideNotifications(rideIdStr);
  }

  /**
   * Helper method to get hide message based on reason
   */
  getHideMessage(reason) {
    const messages = {
      'ride_taken': 'This ride has been taken by another captain.',
      'dispatch_timeout': 'This ride request has timed out.',
      'max_radius_reached': 'No captain found for this ride.',
      'dispatch_error': 'An error occurred with this ride request.',
      'emergency_stop': 'Dispatch service was stopped.',
      'timeout': 'Searching for captains in a wider area.',
      'force_cleanup_manual_cleanup': 'This ride was manually cleaned up by admin.',
      'force_cleanup_system_maintenance': 'System maintenance cleanup.'
    };
    
    // Check if reason contains specific radius info
    if (reason.includes('timeout_radius_')) {
      return 'Searching for captains in a wider area.';
    }
    
    // Check if reason contains force cleanup info
    if (reason.startsWith('force_cleanup_')) {
      const cleanupType = reason.replace('force_cleanup_', '');
      return messages[reason] || `Ride cleaned up: ${cleanupType}`;
    }
    
    return messages[reason] || 'This ride is no longer available.';
  }

  /**
   * Get notified captains for a ride
   */
  getNotifiedCaptains(rideId) {
    return this.rideNotifications.get(rideId.toString()) || new Set();
  }

  // ✅ ANALYTICS AND MONITORING METHODS

  /**
   * Update performance counters
   */
  updatePerformanceCounters() {
    // Reset daily counters if new day
    const today = new Date().toDateString();
    if (this.performanceCounters.lastResetDate !== today) {
      this.performanceCounters.notificationsSentToday = 0;
      this.performanceCounters.lastResetDate = today;
    }

    // Track peak active dispatches
    const currentActiveDispatches = this.dispatchProcesses.size;
    if (currentActiveDispatches > this.performanceCounters.activeDispatchPeakCount) {
      this.performanceCounters.activeDispatchPeakCount = currentActiveDispatches;
    }
  }

  /**
   * Update average dispatch time
   */
  updateAverageDispatchTime(newDispatchTime) {
    const currentAverage = this.dispatchMetrics.averageDispatchTime;
    const totalSuccessful = this.dispatchMetrics.successfulDispatches;
    
    if (totalSuccessful === 1) {
      this.dispatchMetrics.averageDispatchTime = newDispatchTime;
    } else {
      // Calculate running average
      this.dispatchMetrics.averageDispatchTime = 
        ((currentAverage * (totalSuccessful - 1)) + newDispatchTime) / totalSuccessful;
    }
  }

  /**
   * Get comprehensive statistics about dispatch and captain responses
   */
  getDispatchStats() {
    const activeProcesses = this.dispatchProcesses.size;
    const activeNotifications = this.rideNotifications.size;
    const settings = this.rideSettings?.dispatch || {};

    // Calculate notification stats
    let totalNotifiedCaptains = 0;
    let ridesWithNotifications = 0;
    const notificationBreakdown = {};

    this.rideNotifications.forEach((captainSet, rideId) => {
      if (captainSet.size > 0) {
        ridesWithNotifications++;
        totalNotifiedCaptains += captainSet.size;
        
        const count = captainSet.size;
        notificationBreakdown[count] = (notificationBreakdown[count] || 0) + 1;
      }
    });

    return {
      activeDispatches: activeProcesses,
      activeRideIds: Array.from(this.dispatchProcesses.keys()),
      notifications: {
        activeRides: activeNotifications,
        ridesWithNotifications: ridesWithNotifications,
        totalNotifiedCaptains: totalNotifiedCaptains,
        averageCaptainsPerRide: ridesWithNotifications > 0 ? totalNotifiedCaptains / ridesWithNotifications : 0,
        notificationBreakdown: notificationBreakdown
      },
      metrics: {
        ...this.dispatchMetrics,
        averageDispatchTimeSeconds: Math.round(this.dispatchMetrics.averageDispatchTime / 1000),
        successRate: this.dispatchMetrics.totalDispatches > 0 ? 
          (this.dispatchMetrics.successfulDispatches / this.dispatchMetrics.totalDispatches) * 100 : 0
      },
      performance: {
        ...this.performanceCounters,
        dispatchProcessMemoryUsage: this.dispatchProcesses.size,
        notificationMemoryUsage: this.rideNotifications.size,
        currentRadiusMemoryUsage: this.currentRadiusNotifications.size
      },
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

  /**
   * Get detailed information about a specific ride's dispatch status
   */
  getRideDispatchInfo(rideId) {
    const rideIdStr = rideId.toString();
    
    const hasActiveDispatch = this.dispatchProcesses.has(rideIdStr);
    const notifiedCaptains = this.rideNotifications.get(rideIdStr) || new Set();
    const currentRadiusCaptains = this.currentRadiusNotifications.get(rideIdStr) || new Set();
    
    return {
      rideId: rideIdStr,
      hasActiveDispatch: hasActiveDispatch,
      notifiedCaptains: Array.from(notifiedCaptains),
      notifiedCaptainsCount: notifiedCaptains.size,
      currentRadiusCaptains: Array.from(currentRadiusCaptains),
      currentRadiusCaptainsCount: currentRadiusCaptains.size,
      trackingStarted: this.rideNotifications.has(rideIdStr),
      lastUpdated: new Date()
    };
  }

  /**
   * Get all rides currently being tracked (for monitoring)
   */
  getAllTrackedRides() {
    const trackedRides = [];
    
    this.rideNotifications.forEach((captainSet, rideId) => {
      const hasActiveDispatch = this.dispatchProcesses.has(rideId);
      const currentRadiusCaptains = this.currentRadiusNotifications.get(rideId) || new Set();
      
      trackedRides.push({
        rideId: rideId,
        notifiedCaptainsCount: captainSet.size,
        notifiedCaptains: Array.from(captainSet),
        currentRadiusCaptainsCount: currentRadiusCaptains.size,
        currentRadiusCaptains: Array.from(currentRadiusCaptains),
        hasActiveDispatch: hasActiveDispatch
      });
    });
    
    return {
      totalTrackedRides: trackedRides.length,
      rides: trackedRides,
      generatedAt: new Date()
    };
  }

  /**
   * Force cleanup of a specific ride (for admin/maintenance use)
   */
  forceCleanupRide(rideId, reason = 'manual_cleanup') {
    const rideIdStr = rideId.toString();
    
    this.logger.warn(`[Dispatch] Force cleanup requested for ride ${rideIdStr}. Reason: ${reason}`);
    
    let cleanupActions = [];
    
    // Stop dispatch process if active
    if (this.dispatchProcesses.has(rideIdStr)) {
      try {
        const cancelFunc = this.dispatchProcesses.get(rideIdStr);
        cancelFunc();
        this.dispatchProcesses.delete(rideIdStr);
        cleanupActions.push('dispatch_process_stopped');
        this.logger.info(`[Dispatch] Force stopped dispatch process for ride ${rideIdStr}`);
      } catch (error) {
        this.logger.error(`[Dispatch] Error force stopping dispatch process for ride ${rideIdStr}:`, error);
        cleanupActions.push('dispatch_process_stop_failed');
      }
    }
    
    // Hide ride from all notified captains
    try {
      this.notifyCaptainsToHideRide(rideId, null, `force_cleanup_${reason}`);
      cleanupActions.push('captains_notified_to_hide');
    } catch (error) {
      this.logger.error(`[Dispatch] Error notifying captains to hide during force cleanup of ride ${rideIdStr}:`, error);
      cleanupActions.push('captain_notification_failed');
    }
    
    // Clean up notification tracking
    this.cleanupRideNotifications(rideIdStr);
    cleanupActions.push('notification_tracking_cleaned');
    
    this.logger.warn(`[Dispatch] Force cleanup completed for ride ${rideIdStr}. Actions taken: ${cleanupActions.join(', ')}`);
    
    return {
      rideId: rideIdStr,
      reason: reason,
      timestamp: new Date(),
      actionsCompleted: cleanupActions,
      success: !cleanupActions.some(action => action.includes('failed'))
    };
  }

  /**
   * Validate system state and report any inconsistencies
   */
  validateSystemState() {
    const issues = [];
    const warnings = [];
    
    // Check for rides with dispatch processes but no notification tracking
    this.dispatchProcesses.forEach((cancelFunc, rideId) => {
      if (!this.rideNotifications.has(rideId)) {
        issues.push(`Ride ${rideId} has dispatch process but no notification tracking`);
      }
    });
    
    // Check for rides with notification tracking but no dispatch process
    this.rideNotifications.forEach((captainSet, rideId) => {
      if (!this.dispatchProcesses.has(rideId) && captainSet.size > 0) {
        warnings.push(`Ride ${rideId} has notification tracking but no dispatch process`);
      }
    });
    
    // Check for current radius notifications without main notifications
    this.currentRadiusNotifications.forEach((captainSet, rideId) => {
      if (!this.rideNotifications.has(rideId)) {
        issues.push(`Ride ${rideId} has current radius notifications but no main notification tracking`);
      }
    });
    
    // Check for orphaned current radius notifications
    this.currentRadiusNotifications.forEach((currentCaptains, rideId) => {
      const mainCaptains = this.rideNotifications.get(rideId);
      if (mainCaptains) {
        currentCaptains.forEach(captainId => {
          if (!mainCaptains.has(captainId)) {
            warnings.push(`Ride ${rideId}: Captain ${captainId} in current radius but not in main notifications`);
          }
        });
      }
    });
    
    this.logger.info(`[Dispatch] System state validation completed. Issues: ${issues.length}, Warnings: ${warnings.length}`);
    
    if (issues.length > 0) {
      this.logger.error(`[Dispatch] System state issues found:`, issues);
    }
    
    if (warnings.length > 0) {
      this.logger.warn(`[Dispatch] System state warnings:`, warnings);
    }
    
    return {
      isHealthy: issues.length === 0,
      issues: issues,
      warnings: warnings,
      checkedAt: new Date(),
      summary: {
        dispatchProcesses: this.dispatchProcesses.size,
        notificationTracking: this.rideNotifications.size,
        currentRadiusTracking: this.currentRadiusNotifications.size
      }
    };
  }

  /**
   * Reset metrics (for maintenance or testing)
   */
  resetMetrics() {
    this.dispatchMetrics = {
      totalDispatches: 0,
      successfulDispatches: 0,
      failedDispatches: 0,
      timeoutDispatches: 0,
      averageDispatchTime: 0,
      lastDispatchTime: null
    };
    
    this.performanceCounters = {
      activeDispatchPeakCount: 0,
      notificationsSentToday: 0,
      lastResetDate: new Date().toDateString()
    };
    
    this.logger.info('[DispatchService] Metrics reset.');
  }

  // Emergency stop all dispatch processes
  emergencyStopAllDispatches() {
    this.logger.warn('[DispatchService] Emergency stop requested for all dispatch processes.');

    for (const [rideId, cancelFunc] of this.dispatchProcesses.entries()) {
      this.logger.warn(`[DispatchService] Emergency stopping dispatch for ride ${rideId}`);
      
      // Hide ride from all notified captains before stopping
      this.notifyCaptainsToHideRide(rideId, null, 'emergency_stop');
      
      try {
        cancelFunc();
      } catch (error) {
        this.logger.error(`[DispatchService] Error during emergency stop of ride ${rideId}:`, error);
      }
    }

    // Clear the processes map
    this.dispatchProcesses.clear();

    // Clean up all notification tracking
    const trackedRides = Array.from(this.rideNotifications.keys());
    this.rideNotifications.clear();
    this.currentRadiusNotifications.clear();
    this.logger.info(`[DispatchService] Cleaned up notification tracking for ${trackedRides.length} rides during emergency stop.`);
    
    this.logger.info('[DispatchService] All dispatch processes emergency stopped.');
  }
}

module.exports = DispatchService;