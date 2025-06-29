const Ride = require("../model/ride");
const { findNearbyCaptains } = require("../utils/helpers");

class DispatchService {
  constructor(logger, dependencies) {
    this.logger = logger;
    this.redisClient = dependencies.redisClient;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    this.captainSocketService = dependencies.captainSocketService;
    this.customerSocketService = dependencies.customerSocketService;
  }

  async dispatchRide(ride, origin) {
    const rideId = ride._id.toString();
    this.logger.info(`[Dispatch] Starting dispatch for ride ${rideId}. Origin: (${origin.longitude}, ${origin.latitude})`);

    let radius = 2; // Starting radius in km
    const maxRadius = 10; // Maximum search radius
    const radiusIncrement = 1; // Radius increment in km
    const notificationTimeout = 15 * 1000; // Time to wait for a captain to accept (15 seconds)
    const maxDispatchTime = 5 * 60 * 1000; // Max time to search (5 minutes)
    const graceAfterMaxRadius = 30 * 1000; // 30 s extra wait

    const dispatchStartTime = Date.now();

    let cancelDispatch = false;
    let accepted = false; // Flag to track if ride was accepted within the loop

    // Cancellation function for this specific dispatch process
    const cancelFunc = () => {
      this.logger.warn(`[Dispatch] Cancellation requested externally for ride ${rideId}.`);
      cancelDispatch = true;
    };
    this.dispatchProcesses.set(rideId, cancelFunc);
    this.logger.debug(`[Dispatch] Registered cancellation function for ride ${rideId}`);

    try {
      // Keep track of captains already notified in this dispatch cycle to avoid spamming
      const notifiedCaptains = new Set();

      while (!cancelDispatch && !accepted && radius <= maxRadius) {
        // Check for overall timeout
        if (Date.now() - dispatchStartTime >= maxDispatchTime) {
          this.logger.warn(`[Dispatch] Max dispatch time (${maxDispatchTime / 1000}s) exceeded for ride ${rideId}.`);
          cancelDispatch = true; // Mark for cancellation, status update happens after loop
          break; // Exit the while loop
        }

        // Check if the ride object still exists and is 'requested' before searching
        const currentRideState = await Ride.findById(rideId).select('status');
        if (!currentRideState || currentRideState.status !== 'requested') {
          this.logger.warn(`[Dispatch] Ride ${rideId} is no longer in 'requested' state (current: ${currentRideState?.status}). Stopping dispatch.`);
          cancelDispatch = true;
          break;
        }

        this.logger.info(`[Dispatch] Ride ${rideId}: Searching radius ${radius} km.`);
        const nearbyCaptainIds = await findNearbyCaptains(this.redisClient, this.logger, origin, radius);

        if (nearbyCaptainIds.length > 0) {
          let newCaptainsFoundInRadius = false;
          for (const captainId of nearbyCaptainIds) {
            if (cancelDispatch || accepted) break; // Exit loop early if cancelled or accepted

            // Check if captain is online and *not* already notified in this cycle
            if (this.onlineCaptains[captainId] && !notifiedCaptains.has(captainId)) {
              newCaptainsFoundInRadius = true;
              notifiedCaptains.add(captainId); // Mark as notified for this cycle

              this.logger.info(`[Dispatch] Ride ${rideId}: Notifying captain ${captainId}`);
              // Use captain socket service to emit new ride
              const sent = this.captainSocketService.emitToCaptain(captainId, "newRide", {
                rideId: ride._id,
                pickupLocation: ride.pickupLocation.coordinates,
                dropoffLocation: ride.dropoffLocation.coordinates,
                fare: ride.fare.amount,
                distance: ride.distance,
                duration: ride.duration,
              });

              if (!sent) {
                this.logger.warn(`[Dispatch] Failed to send newRide notification to captain ${captainId} - captain may be offline`);
              }

              // --- Asynchronous Wait and Check ---
              this.logger.debug(`[Dispatch] Ride ${rideId}: Waiting ${notificationTimeout / 1000}s for captain ${captainId} to potentially accept.`);
              await new Promise((resolve) => setTimeout(resolve, notificationTimeout));

              // Check if the ride was accepted *during* the wait
              const updatedRide = await Ride.findById(rideId).select('status driver'); // Select only needed fields
              if (updatedRide && updatedRide.status === "accepted") {
                accepted = true; // Mark as accepted
                this.logger.info(`[Dispatch] Ride ${rideId} was accepted by captain ${updatedRide.driver} during wait period.`);
                break; // Exit the inner captain loop
              } else {
                this.logger.info(`[Dispatch] Ride ${rideId}: Captain ${captainId} did not accept within ${notificationTimeout / 1000}s (or ride status changed). Current status: ${updatedRide?.status}`);
              }
            }
          } // End captain loop

          // If we found new captains in this radius, wait a bit before expanding radius further
          if (newCaptainsFoundInRadius && !accepted && !cancelDispatch) {
            this.logger.debug(`[Dispatch] Ride ${rideId}: Pausing briefly after notifying captains in radius ${radius}km.`);
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

            // Re-check if accepted during the pause
            const updatedRide = await Ride.findById(rideId).select('status');
            if (updatedRide && updatedRide.status === "accepted") {
              accepted = true;
              this.logger.info(`[Dispatch] Ride ${rideId} was accepted during pause.`);
            }
          }

        } else {
          this.logger.info(`[Dispatch] Ride ${rideId}: No captains found within radius ${radius} km.`);
        }

        // Increase radius only if not accepted and not cancelled
        if (!accepted && !cancelDispatch) {
          radius += radiusIncrement;
          this.logger.info(`[Dispatch] Ride ${rideId}: Increasing search radius to ${radius} km.`);
        }
      } // End while loop

      // --- Handle Dispatch Outcome ---
      const finalRideState = await Ride.findById(rideId); // Get the latest state

      if (accepted) {
        // Ride was accepted by someone, log success. State changes handled in 'acceptRide'
        this.logger.info(`[Dispatch] Ride ${rideId} successfully accepted by captain ${finalRideState?.driver}. Dispatch process complete.`);
      } else if (cancelDispatch) {
        // Dispatch was cancelled externally or timed out
        this.logger.warn(`[Dispatch] Dispatch for ride ${rideId} was cancelled or timed out.`);
        // If timeout occurred specifically, mark as notApprove
        if (Date.now() - dispatchStartTime >= maxDispatchTime && finalRideState && finalRideState.status === 'requested') {
          this.logger.warn(`[Dispatch] Ride ${rideId} timed out. Updating status to 'notApprove'.`);
          finalRideState.status = "notApprove";
          finalRideState.isDispatching = false;
          await finalRideState.save();
          this.logger.info(`[DB] Ride ${rideId} status updated to 'notApprove'.`);

          // Notify customer
          this.customerSocketService.emitToCustomer(finalRideState.passenger, 'rideNotApproved', {
            rideId: ride._id,
            message: "We couldn't find a nearby captain in time. Please try requesting again.",
          });
        }
      } else if (radius > maxRadius && !cancelDispatch && !accepted) {
        // Max radius reached — wait a final 30 s before giving up
        this.logger.warn(
          `[Dispatch] Ride ${rideId}: reached max radius (${maxRadius} km). ` +
          `Holding for an extra ${graceAfterMaxRadius / 1000}s before aborting.`,
        );

        // non‑blocking sleep, polling every 5 s in case someone accepts
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
            `[Dispatch] Ride ${rideId}: no acceptance after extra 30 s. ` +
            `Updating status to 'notApprove'.`,
          );

          const rideDoc = await Ride.findById(rideId);
          if (rideDoc && rideDoc.status === 'requested') {
            rideDoc.status = 'notApprove';
            rideDoc.isDispatching = false;
            await rideDoc.save();
            this.logger.info(`[DB] Ride ${rideId} status updated to 'notApprove'.`);

            this.customerSocketService.emitToCustomer(rideDoc.passenger, 'rideNotApproved', {
              rideId: rideDoc._id,
              message:
                'لم نعثر على كابتن قريب في الوقت الحالي، الرجاء المحاولة مرة أخرى لاحقاً.',
            });
          }
        }
      } else {
        // Should not happen if logic is correct
        this.logger.warn(`[Dispatch] Ride ${rideId}: Dispatch loop ended with unexpected state. Final Status: ${finalRideState?.status}`);
      }

    } catch (err) {
      this.logger.error(`[Dispatch] Error during dispatch process for ride ${rideId}:`, err);
      // Attempt to mark ride as failed
      try {
        const rideToUpdate = await Ride.findById(rideId);
        if (rideToUpdate && rideToUpdate.status === 'requested') {
          rideToUpdate.status = 'failed';
          rideToUpdate.isDispatching = false;
          rideToUpdate.cancellationReason = `Dispatch error: ${err.message}`;
          await rideToUpdate.save();
          this.logger.info(`[DB] Marked ride ${rideId} as 'failed' due to dispatch error.`);
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
    const dispatchCheckInterval = 30 * 1000; // Check every 30 seconds
    this.logger.info(`[Dispatch] Background dispatcher check interval set to ${dispatchCheckInterval / 1000}s.`);

    setInterval(async () => {
      this.logger.debug('[Dispatch Interval] Checking for requested rides needing dispatch...');
      try {
        // Find rides that are 'requested' but NOT currently being handled by an active dispatch process
        const ridesToDispatch = await Ride.find({
          status: 'requested',
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

            this.logger.info(`[Dispatch Interval] Initiating dispatch for ride ${ride._id}`);

            const originCoords = {
              latitude: ride.pickupLocation.coordinates[1],
              longitude: ride.pickupLocation.coordinates[0],
            };
            this.dispatchRide(ride, originCoords); // Start dispatch
          }
        } else {
          this.logger.debug('[Dispatch Interval] No requested rides found needing dispatch initiation.');
        }
      } catch (err) {
        this.logger.error("[Dispatch Interval] Error checking for dispatchable rides:", err);
      }
    }, dispatchCheckInterval);
  }
}

module.exports = DispatchService;