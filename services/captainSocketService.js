const jwt = require("jsonwebtoken");
const Ride = require("../model/ride");
const Captain = require("../model/Driver");
const RideSetting = require("../model/rideSetting");
const { calculateDistance } = require("../utils/helpers");

class CaptainSocketService {
  constructor(io, logger, dependencies) {
    this.io = io;
    this.logger = logger;
    this.onlineCustomers = dependencies.onlineCustomers;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    this.rideSharingMap = dependencies.rideSharingMap;
    this.redisClient = dependencies.redisClient;
    this.dispatchRide = dependencies.dispatchRide;
    this.customerSocketService = dependencies.customerSocketService;

    // NEW: Add reference to DispatchService for notification management
    this.dispatchService = dependencies.dispatchService || null;

    this.captainNamespace = null;
    this.rideSettings = null;
  }

  async initialize() {
    await this.loadRideSettings();
    this.captainNamespace = this.io.of("/captain");
    this.captainNamespace.on("connection", (socket) => this.handleConnection(socket));
    this.logger.info('[CaptainSocketService] Captain namespace initialized.');
  }

  async loadRideSettings() {
    try {
      this.rideSettings = await RideSetting.findOne({ name: "default" });
      if (!this.rideSettings) {
        this.rideSettings = new RideSetting({});
        await this.rideSettings.save();
        this.logger.info('[CaptainSocketService] Created default ride settings.');
      }
      this.logger.info('[CaptainSocketService] Ride settings loaded successfully.');
    } catch (err) {
      this.logger.error('[CaptainSocketService] Error loading ride settings:', err);
      this.rideSettings = {
        dispatch: {
          initialRadiusKm: 2,
          maxRadiusKm: 10,
          radiusIncrementKm: 1,
          notificationTimeout: 15,
          maxDispatchTime: 300,
          graceAfterMaxRadius: 30
        },
        captainRules: {
          maxTopUpLimit: 1000,
          minWalletBalance: 0,
          minRating: 3.5,
          maxActiveRides: 1
        },
        fare: {
          currency: "IQD",
          baseFare: 3000,
          pricePerKm: 500,
          minRidePrice: 2000,
          maxRidePrice: 7000
        }
      };
    }
  }

  handleConnection(socket) {
    this.logger.info(`[Socket.IO Captain] Incoming connection attempt. Socket ID: ${socket.id}`);
    const token = socket.handshake.query.token;

    if (!token) {
      this.logger.warn(`[Socket.IO Captain] Connection attempt without token. Socket ID: ${socket.id}. Disconnecting.`);
      socket.disconnect(true);
      return;
    }

    jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
      if (err) {
        this.logger.warn(`[Socket.IO Captain] JWT verification failed for token: ${token}. Error: ${err.message}. Socket ID: ${socket.id}. Disconnecting.`);
        socket.disconnect(true);
      } else {
        await this.handleAuthenticated(socket, decoded);
      }
    });
  }

  async handleAuthenticated(socket, decoded) {
    const captainId = decoded.id;

    const isEligible = await this.validateCaptainEligibility(captainId);
    if (!isEligible.eligible) {
      this.logger.warn(`[Socket.IO Captain] Captain ${captainId} not eligible: ${isEligible.reason}`);
      socket.emit("eligibilityError", {
        message: isEligible.reason,
        requiredRating: this.rideSettings.captainRules.minRating,
        minBalance: this.rideSettings.captainRules.minWalletBalance
      });
      socket.disconnect(true);
      return;
    }

    const oldSocketId = this.onlineCaptains[captainId];
    if (oldSocketId && oldSocketId !== socket.id) {
      this.logger.warn(`[Socket.IO Captain] Captain ${captainId} already connected with socket ${oldSocketId}. Disconnecting old socket.`);
      const oldSocket = this.captainNamespace.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
    }

    this.onlineCaptains[captainId] = socket.id;
    this.logger.info(`[Socket.IO Captain] Captain ${captainId} successfully connected. Socket ID: ${socket.id}`);
    this.logger.debug(`[State] Online captains: ${JSON.stringify(this.onlineCaptains)}`);

    socket.emit("rideSettings", {
      fare: this.rideSettings.fare,
      paymentMethods: this.rideSettings.paymentMethods,
      allowShared: this.rideSettings.allowShared
    });

    // NEW: Get captain location and notify dispatch service
    await this.notifyDispatchOfCaptainOnline(captainId);

    await this.restoreCaptainState(socket, captainId);
    this.setupEventListeners(socket, captainId);
  }

  // NEW: Notify dispatch service when captain comes online
  async notifyDispatchOfCaptainOnline(captainId) {
    try {
      const captainLocation = await this.getCaptainLocation(captainId);
      if (captainLocation && this.dispatchService) {
        await this.dispatchService.onCaptainOnline(captainId, captainLocation);
        this.logger.info(`[CaptainSocketService] Notified dispatch service of captain ${captainId} coming online`);
      }
    } catch (err) {
      this.logger.error(`[CaptainSocketService] Error notifying dispatch of captain ${captainId} online:`, err);
    }
  }

  // NEW: Get captain's current location
  async getCaptainLocation(captainId) {
    try {
      const locationData = await this.redisClient.geoPos("captains", captainId);
      if (locationData && locationData.length > 0 && locationData[0]) {
        const { longitude: lonStr, latitude: latStr } = locationData[0];
        return {
          latitude: parseFloat(latStr),
          longitude: parseFloat(lonStr)
        };
      }
      return null;
    } catch (err) {
      this.logger.error(`[CaptainSocketService] Error getting location for captain ${captainId}:`, err);
      return null;
    }
  }

  async validateCaptainEligibility(captainId) {
    try {
      const captain = await Captain.findById(captainId).select('rating walletBalance');
      if (!captain) {
        return { eligible: false, reason: "Captain not found" };
      }

      if (captain.rating < this.rideSettings.captainRules.minRating) {
        return {
          eligible: false,
          reason: `Minimum rating required: ${this.rideSettings.captainRules.minRating}. Current: ${captain.rating}`
        };
      }

      if (captain.walletBalance < this.rideSettings.captainRules.minWalletBalance) {
        return {
          eligible: false,
          reason: `Minimum wallet balance required: ${this.rideSettings.captainRules.minWalletBalance} ${this.rideSettings.fare.currency}`
        };
      }

      const activeRides = await Ride.countDocuments({
        driver: captainId,
        status: { $in: ['accepted', 'arrived', 'onRide'] }
      });

      if (activeRides >= this.rideSettings.captainRules.maxActiveRides) {
        return {
          eligible: false,
          reason: `Maximum active rides limit reached: ${this.rideSettings.captainRules.maxActiveRides}`
        };
      }

      return { eligible: true };
    } catch (err) {
      this.logger.error(`[CaptainSocketService] Error validating captain eligibility for ${captainId}:`, err);
      return { eligible: false, reason: "Validation error" };
    }
  }

  async restoreCaptainState(socket, captainId) {
    try {
      this.logger.info(`[Socket.IO Captain] Checking for ongoing or assigned rides for captain ${captainId}`);

      const ongoingRide = await Ride.findOne({
        driver: captainId,
        status: { $in: ['accepted', 'arrived', 'onRide'] },
      }).populate('passenger', 'name phoneNumber');

      if (ongoingRide) {
        this.logger.info(`[DB] Found ongoing ride ${ongoingRide._id} (Status: ${ongoingRide.status}) for captain ${captainId}. Restoring state.`);

        if (!this.rideSharingMap.has(captainId)) {
          this.rideSharingMap.set(captainId, ongoingRide.passenger._id);
          this.logger.info(`[State] Restored ride sharing for captain ${captainId} and customer ${ongoingRide.passenger._id}`);
        }

        socket.emit("restoreRide", {
          rideId: ongoingRide._id,
          pickupLocation: ongoingRide.pickupLocation.coordinates,
          dropoffLocation: ongoingRide.dropoffLocation.coordinates,
          fare: ongoingRide.fare.amount,
          distance: ongoingRide.distance,
          duration: ongoingRide.duration,
          status: ongoingRide.status,
          passengerInfo: {
            id: ongoingRide.passenger._id,
            name: ongoingRide.passenger.name,
            phoneNumber: ongoingRide.passenger.phoneNumber
          }
        });
        this.logger.info(`[Socket.IO Captain] Emitted 'restoreRide' for ride ${ongoingRide._id} to captain ${captainId}`);
      } else {
        this.logger.info(`[Socket.IO Captain] No active ride found for captain ${captainId}. Checking for pending requests in area.`);
        await this.checkForNearbyPendingRides(socket, captainId);
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error restoring state for captain ${captainId}:`, err);
    }
  }

  async checkForNearbyPendingRides(socket, captainId) {
    try {
      const captainLocation = await this.redisClient.geoPos("captains", captainId);
      if (captainLocation && captainLocation.length > 0 && captainLocation[0]) {
        const { longitude: lonStr, latitude: latStr } = captainLocation[0];
        const longitude = parseFloat(lonStr);
        const latitude = parseFloat(latStr);
        this.logger.info(`[Redis] Captain ${captainId} last known location: (${longitude}, ${latitude})`);

        const pendingRides = await Ride.find({ status: "requested" });
        this.logger.info(`[DB] Found ${pendingRides.length} rides with status 'requested'. Checking proximity for captain ${captainId}.`);

        const notificationRadius = this.rideSettings.dispatch.initialRadiusKm;
        let notifiedRideCount = 0;

        for (let ride of pendingRides) {
          const distance = calculateDistance(
            { latitude, longitude },
            {
              latitude: ride.pickupLocation.coordinates[1],
              longitude: ride.pickupLocation.coordinates[0],
            }
          );

          if (distance <= notificationRadius) {
            if (this.validateFareInBounds(ride.fare.amount)) {
              notifiedRideCount++;
              this.logger.info(`[Socket.IO Captain] Ride ${ride._id} is within ${notificationRadius}km (${distance.toFixed(2)}km). Emitting 'newRide' to captain ${captainId}`);
              socket.emit("newRide", {
                rideId: ride._id,
                pickupLocation: ride.pickupLocation.coordinates,
                pickupName: ride.pickupLocation.locationName,
                dropoffLocation: ride.dropoffLocation.coordinates,
                dropoffName: ride.dropoffLocation.locationName,
                fare: ride.fare.amount,
                currency: this.rideSettings.fare.currency,
                distance: ride.distance,
                duration: ride.duration,
                paymentMethod: ride.paymentMethod,
              });
            }
          }
        }
        this.logger.info(`[Socket.IO Captain] Notified captain ${captainId} about ${notifiedRideCount} pending rides within ${notificationRadius}km.`);
      } else {
        this.logger.warn(`[Redis] No location found in Redis for captain ${captainId}. Cannot check for pending rides.`);
      }
    } catch (geoErr) {
      this.logger.error(`[Redis] Error fetching captain ${captainId} location or checking pending rides:`, geoErr);
    }
  }

  validateFareInBounds(fareAmount) {
    return fareAmount >= this.rideSettings.fare.minRidePrice &&
      fareAmount <= this.rideSettings.fare.maxRidePrice;
  }

  setupEventListeners(socket, captainId) {
    socket.on("updateLocation", async (data) => {
      await this.handleLocationUpdate(socket, captainId, data);
    });

    socket.on("acceptRide", async (data) => {
      await this.handleRideAcceptance(socket, captainId, data);
    });

    socket.on("cancelRide", async (data) => {
      await this.handleRideCancellation(socket, captainId, data);
    });

    socket.on("arrived", async (data) => {
      await this.handleCaptainArrived(socket, captainId, data);
    });

    socket.on("startRide", async (data) => {
      await this.handleStartRide(socket, captainId, data);
    });

    socket.on("endRide", async (data) => {
      await this.handleEndRide(socket, captainId, data);
    });

    socket.on("hideRideAcknowledge", (data) => {
      this.handleHideRideAcknowledge(socket, captainId, data);
    });

    socket.on("disconnect", (reason) => {
      this.handleDisconnect(socket, captainId, reason);
    });

    socket.on('error', (error) => {
      this.logger.error(`[Socket.IO Captain] Socket error for captain ${captainId} on socket ${socket.id}:`, error);
    });

    socket.on("refreshSettings", async () => {
      await this.loadRideSettings();
      socket.emit("rideSettings", {
        fare: this.rideSettings.fare,
        paymentMethods: this.rideSettings.paymentMethods,
        allowShared: this.rideSettings.allowShared
      });
    });
  }

  handleHideRideAcknowledge(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    this.logger.debug(`[Socket.IO Captain] Captain ${captainId} acknowledged hiding ride ${rideId}`);
  }

  async handleLocationUpdate(socket, captainId, data) {
    if (!data || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
      this.logger.warn(`[Socket.IO Captain] Received invalid location update from captain ${captainId}. Data: ${JSON.stringify(data)}`);
      return;
    }

    this.logger.debug(`[Socket.IO Captain] Received 'updateLocation' from captain ${captainId}. Data: ${JSON.stringify(data)}`);

    try {
      await this.redisClient.geoAdd("captains", {
        longitude: data.longitude,
        latitude: data.latitude,
        member: captainId,
      });
      this.logger.info(`[Redis] Location updated for captain ${captainId} to (${data.longitude}, ${data.latitude})`);

      if (this.rideSharingMap.has(captainId)) {
        const customerId = this.rideSharingMap.get(captainId);
        const sent = this.customerSocketService.emitToCustomer(customerId, "driverLocationUpdate", {
          latitude: data.latitude,
          longitude: data.longitude,
        });

        if (sent) {
          this.logger.debug(`[Socket.IO Customer] Sent location update to customer ${customerId} for captain ${captainId}`);
        } else {
          this.logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send location update from captain ${captainId}`);
        }
      }
    } catch (err) {
      this.logger.error(`[Redis] Error saving location to Redis for captain ${captainId}:`, err);
      socket.emit("locationError", { message: "Location update failed on server." });
    }
  }

  async handleRideAcceptance(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    if (!rideId) {
      this.logger.warn(`[Socket.IO Captain] Received 'acceptRide' without rideId from captain ${captainId}.`);
      socket.emit("rideError", { message: "Missing ride ID in acceptance request." });
      return;
    }

    this.logger.info(`[Socket.IO Captain] Received 'acceptRide' for ride ${rideId} from captain ${captainId}. Socket ID: ${socket.id}`);

    try {
      const eligibilityCheck = await this.validateCaptainEligibility(captainId);
      if (!eligibilityCheck.eligible) {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} not eligible to accept ride: ${eligibilityCheck.reason}`);
        socket.emit("rideError", { message: eligibilityCheck.reason, rideId: rideId });
        return;
      }

      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, status: "requested" },
        {
          $set: {
            status: "accepted",
            driver: captainId,
            isDispatching: false
          }
        },
        { new: true }
      ).populate('passenger', 'name phoneNumber');

      if (ride) {
        this.logger.info(`[DB] Ride ${rideId} successfully accepted by captain ${captainId}. Status updated to 'accepted'.`);

        // *** KEY ADDITION *** 
        // Notify other captains to hide this ride
        if (this.dispatchService) {
          this.logger.info(`[Socket.IO Captain] Notifying other captains to hide ride ${rideId}`);
          this.dispatchService.notifyCaptainsToHideRide(rideId, captainId);
        } else {
          this.logger.warn(`[Socket.IO Captain] DispatchService not available - cannot notify other captains to hide ride ${rideId}`);
        }

        // Stop dispatch process
        if (this.dispatchProcesses.has(rideId.toString())) {
          this.logger.info(`[Dispatch] Found active dispatch process for ride ${rideId}. Cancelling.`);
          const cancelDispatch = this.dispatchProcesses.get(rideId.toString());
          cancelDispatch();
          this.dispatchProcesses.delete(rideId.toString());
          this.logger.info(`[Dispatch] Dispatch process for ride ${rideId} cancelled and removed.`);
        }

        // *** NEW CRITICAL ADDITION ***
        // Re-evaluate all active dispatches since this captain is now busy
        if (this.dispatchService) {
          await this.dispatchService.reevaluateActiveDispatches();
          this.logger.info(`[Socket.IO Captain] Re-evaluated active dispatches after captain ${captainId} accepted ride ${rideId}`);
        }

        // Notify customer
        const customerId = ride.passenger._id;
        try {
          const captainInfo = await Captain.findById(captainId).select('name carDetails phoneNumber');
          if (!captainInfo) {
            throw new Error(`Captain ${captainId} not found in DB`);
          }

          const sent = this.customerSocketService.emitToCustomer(customerId, "rideAccepted", {
            rideId: ride._id,
            driverId: captainId,
            driverInfo: {
              name: captainInfo.name,
              vehicle: captainInfo.carDetails,
              phoneNumber: captainInfo.phoneNumber,
            },
            passengerInfo: {
              id: ride.passenger._id,
              name: ride.passenger.name,
              phoneNumber: ride.passenger.phoneNumber
            }
          });

          if (!sent) {
            this.logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send 'rideAccepted' notification for ride ${rideId}.`);
          }
        } catch (captainErr) {
          this.logger.error(`[DB] Failed to fetch captain details for captain ${captainId}:`, captainErr);
          this.customerSocketService.emitToCustomer(customerId, "rideAccepted", {
            rideId: ride._id,
            driverId: captainId,
            driverInfo: null,
            message: "Captain accepted, details loading..."
          });
        }

        this.rideSharingMap.set(captainId, customerId);
        this.logger.info(`[State] Started ride sharing for captain ${captainId} and customer ${customerId}. Ride: ${rideId}`);

        socket.emit('rideAcceptedConfirmation', {
          rideId: ride._id,
          status: ride.status,
          pickupLocation: ride.pickupLocation.coordinates,
          dropoffLocation: ride.dropoffLocation.coordinates,
          fare: ride.fare.amount,
          currency: this.rideSettings.fare.currency,
          paymentMethod: ride.paymentMethod,
          passengerInfo: {
            id: ride.passenger._id,
            name: ride.passenger.name,
            phoneNumber: ride.passenger.phoneNumber
          }
        });

      } else {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to accept ride ${rideId}, but it was not found or status was not 'requested'.`);
        socket.emit("rideError", { message: "Ride already taken or cancelled.", rideId: rideId });
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error accepting ride ${rideId} for captain ${captainId}:`, err);
      socket.emit("rideError", { message: "Failed to accept ride due to a server error.", rideId: rideId });
    }
  }

  async handleRideCancellation(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    if (!rideId) {
      this.logger.warn(`[Socket.IO Captain] Received 'cancelRide' without rideId from captain ${captainId}.`);
      socket.emit("rideError", { message: "Missing ride ID in cancellation request." });
      return;
    }

    this.logger.info(`[Socket.IO Captain] Received 'cancelRide' for ride ${rideId} from captain ${captainId}`);

    try {
      const ride = await Ride.findOne({ _id: rideId, driver: captainId });

      if (!ride) {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to cancel ride ${rideId}, but ride was not found or captain not assigned.`);
        socket.emit("rideError", { message: "Cannot cancel ride. Ride not found or you are not assigned.", rideId: rideId });
        return;
      }

      const cancellableStatuses = ['accepted', 'arrived'];
      if (!cancellableStatuses.includes(ride.status)) {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to cancel ride ${rideId} with status ${ride.status}, which is not allowed.`);
        socket.emit("rideError", { message: `Cannot cancel ride. Current status is '${ride.status}'.`, rideId: rideId });
        return;
      }

      this.logger.info(`[DB] Updating ride ${rideId} status to 'requested' due to captain cancellation by ${captainId}. Previous status: ${ride.status}`);

      ride.status = "requested";
      ride.driver = null;
      ride.isDispatching = true;
      ride.cancellationReason = `Cancelled by captain ${captainId} at status ${ride.status}`;
      await ride.save();

      if (this.rideSharingMap.has(captainId)) {
        this.rideSharingMap.delete(captainId);
        this.logger.info(`[State] Stopped ride sharing for captain ${captainId} due to cancellation. Ride: ${rideId}`);
      }

      // *** NEW CRITICAL ADDITION ***
      // Notify dispatch service that captain is available again
      if (this.dispatchService) {
        const location = await this.getCaptainLocation(captainId);
        if (location) {
          await this.dispatchService.onCaptainAvailable(captainId, location);
          this.logger.info(`[Socket.IO Captain] Notified dispatch service that captain ${captainId} is available after cancelling ride ${rideId}`);
        }
      }

      const customerId = ride.passenger;
      this.customerSocketService.emitToCustomer(customerId, "rideCanceled", {
        rideId: ride._id,
        message: "The captain has canceled the ride. We are searching for another captain...",
        reason: "captain_canceled"
      });

      socket.emit("rideCancelledConfirmation", { rideId: ride._id, message: "Ride successfully cancelled." });

      this.logger.info(`[Dispatch] Restarting dispatch process for cancelled ride ${rideId}`);
      const originCoords = {
        latitude: ride.pickupLocation.coordinates[1],
        longitude: ride.pickupLocation.coordinates[0],
      };
      this.dispatchRide(ride, originCoords);

    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error cancelling ride ${rideId} for captain ${captainId}:`, err);
      socket.emit("rideError", { message: "Failed to cancel ride due to a server error.", rideId: rideId });
    }
  }

  async handleCaptainArrived(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    if (!rideId) {
      this.logger.warn(`[Socket.IO Captain] Received 'arrived' without rideId from captain ${captainId}.`);
      socket.emit("rideError", { message: "Missing ride ID in arrival notification." });
      return;
    }

    this.logger.info(`[Socket.IO Captain] Received 'arrived' for ride ${rideId} from captain ${captainId}`);

    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: captainId, status: "accepted" },
        { $set: { status: "arrived" } },
        { new: true }
      );

      if (ride) {
        this.logger.info(`[DB] Ride ${rideId} status updated to 'arrived' by captain ${captainId}.`);

        const customerId = ride.passenger;
        this.customerSocketService.emitToCustomer(customerId, "driverArrived", {
          rideId: ride._id,
          message: "Your captain has arrived at the pickup location.",
        });

        socket.emit("rideStatusUpdate", { rideId: ride._id, status: "arrived" });

      } else {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to mark ride ${rideId} as 'arrived', but condition failed.`);
        const currentRide = await Ride.findById(rideId);
        const errorMsg = currentRide ? `Cannot mark as arrived. Current status is '${currentRide.status}'.` : "Ride not found or you are not assigned.";
        socket.emit("rideError", { message: errorMsg, rideId: rideId });
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error marking ride ${rideId} as arrived for captain ${captainId}:`, err);
      socket.emit("rideError", { message: "Failed to mark ride as arrived due to a server error.", rideId: rideId });
    }
  }

  async handleStartRide(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    if (!rideId) {
      this.logger.warn(`[Socket.IO Captain] Received 'startRide' without rideId from captain ${captainId}.`);
      socket.emit("rideError", { message: "Missing ride ID in start ride request." });
      return;
    }

    this.logger.info(`[Socket.IO Captain] Received 'startRide' for ride ${rideId} from captain ${captainId}`);

    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: captainId, status: "arrived" },
        { $set: { status: "onRide", rideStartTime: new Date() } },
        { new: true }
      );

      if (ride) {
        this.logger.info(`[DB] Ride ${rideId} status updated to 'onRide' by captain ${captainId}.`);

        const customerId = ride.passenger;
        this.customerSocketService.emitToCustomer(customerId, "rideStarted", {
          rideId: ride._id,
          message: "Your ride has started.",
        });

        socket.emit("rideStartedConfirmation", { rideId: ride._id, status: "onRide" });

      } else {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to start ride ${rideId}, but condition failed.`);
        const currentRide = await Ride.findById(rideId);
        const errorMsg = currentRide ? `Cannot start ride. Current status is '${currentRide.status}'.` : "Ride not found or you are not assigned.";
        socket.emit("rideError", { message: errorMsg, rideId: rideId });
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error starting ride ${rideId} for captain ${captainId}:`, err);
      socket.emit("rideError", { message: "Failed to start ride due to a server error.", rideId: rideId });
    }
  }

  async handleEndRide(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    if (!rideId) {
      this.logger.warn(`[Socket.IO Captain] Received 'endRide' without rideId from captain ${captainId}.`);
      socket.emit("rideError", { message: "Missing ride ID in end ride request." });
      return;
    }

    this.logger.info(`[Socket.IO Captain] Received 'endRide' for ride ${rideId} from captain ${captainId}`);

    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: captainId, status: "onRide" },
        {
          $set: {
            status: "completed",
            rideEndTime: new Date(),
            isDispatching: false
          }
        },
        { new: true }
      );

      if (ride) {
        this.logger.info(`[DB] Ride ${rideId} status updated to 'completed' by captain ${captainId}.`);

        const customerId = ride.passenger;
        this.customerSocketService.emitToCustomer(customerId, "rideCompleted", {
          rideId: ride._id,
          message: "Your ride has been completed. Thank you for riding with us!",
          fare: ride.fare.amount,
          currency: this.rideSettings.fare.currency,
        });

        socket.emit("rideStatusUpdate", {
          rideId: ride._id,
          status: "completed",
          message: "Ride successfully completed.",
          fare: ride.fare.amount,
          currency: this.rideSettings.fare.currency
        });

        if (this.rideSharingMap.has(captainId)) {
          this.rideSharingMap.delete(captainId);
          this.logger.info(`[State] Stopped ride sharing for captain ${captainId} after ride completion. Ride: ${rideId}`);
        }

        // *** NEW CRITICAL ADDITION ***
        // Notify dispatch service that captain is available again
        if (this.dispatchService) {
          const location = await this.getCaptainLocation(captainId);
          if (location) {
            await this.dispatchService.onCaptainAvailable(captainId, location);
            this.logger.info(`[Socket.IO Captain] Notified dispatch service that captain ${captainId} is available after completing ride ${rideId}`);
          }
        }

      } else {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to end ride ${rideId}, but condition failed.`);
        const currentRide = await Ride.findById(rideId);
        const errorMsg = currentRide ? `Cannot end ride. Current status is '${currentRide.status}'.` : "Ride not found or you are not assigned.";
        socket.emit("rideError", { message: errorMsg, rideId: rideId });
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error ending ride ${rideId} for captain ${captainId}:`, err);
      socket.emit("rideError", { message: "Failed to end ride due to a server error.", rideId: rideId });
    }
  }

  handleDisconnect(socket, captainId, reason) {
    this.logger.info(`[Socket.IO Captain] Captain ${captainId} disconnected. Socket ID: ${socket.id}. Reason: ${reason}`);

    for (let id in this.onlineCaptains) {
      if (this.onlineCaptains[id] === socket.id) {
        delete this.onlineCaptains[id];
        this.logger.info(`[State] Removed captain ${id} from onlineCaptains.`);
        this.logger.debug(`[State] Online captains: ${JSON.stringify(this.onlineCaptains)}`);
        
        // *** NEW ADDITION ***
        // Notify dispatch service that captain went offline
        if (this.dispatchService) {
          this.dispatchService.onCaptainOffline(id);
          this.logger.info(`[Socket.IO Captain] Notified dispatch service that captain ${id} went offline`);
        }
        break;
      }
    }

    if (this.rideSharingMap.has(captainId)) {
      const customerId = this.rideSharingMap.get(captainId);
      this.rideSharingMap.delete(captainId);
      this.logger.warn(`[State] Captain ${captainId} disconnected during active ride sharing with customer ${customerId}. Ride sharing stopped.`);
    }
  }

  // Enhanced emitToCaptain with better error handling
  emitToCaptain(captainId, event, data) {
    try {
      const captainSocketId = this.onlineCaptains[captainId];
      if (captainSocketId) {
        const socket = this.captainNamespace.sockets.get(captainSocketId);
        if (socket && socket.connected) {
          socket.emit(event, data);
          this.logger.debug(`[Socket.IO Captain] Emitted '${event}' to captain ${captainId}`);
          return true;
        } else {
          this.logger.warn(`[Socket.IO Captain] Captain ${captainId} socket not connected`);
          // Clean up offline captain
          delete this.onlineCaptains[captainId];
          if (this.dispatchService) {
            this.dispatchService.onCaptainOffline(captainId);
          }
          return false;
        }
      } else {
        this.logger.warn(`[Socket.IO Captain] Captain ${captainId} socket not found`);
        return false;
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error emitting '${event}' to captain ${captainId}:`, err);
      return false;
    }
  }

  emitToMultipleCaptains(captainIds, event, data) {
    const results = [];
    for (const captainId of captainIds) {
      results.push({
        captainId,
        sent: this.emitToCaptain(captainId, event, data)
      });
    }
    return results;
  }

  getCurrentSettings() {
    return this.rideSettings;
  }

  applySurgePricing(baseFare) {
    if (this.rideSettings.fare.surge.enabled) {
      const now = new Date();
      const surgeStart = this.rideSettings.fare.surge.activeFrom;
      const surgeEnd = this.rideSettings.fare.surge.activeTo;

      if (surgeStart && surgeEnd && now >= surgeStart && now <= surgeEnd) {
        return baseFare * this.rideSettings.fare.surge.multiplier;
      } else if (!surgeStart && !surgeEnd) {
        return baseFare * this.rideSettings.fare.surge.multiplier;
      }
    }
    return baseFare;
  }

  setDispatchService(dispatchService) {
    this.dispatchService = dispatchService;
    this.logger.info('[CaptainSocketService] DispatchService reference injected.');
  }

  setCustomerSocketService(customerSocketService) {
    this.customerSocketService = customerSocketService;
    this.logger.info('[CaptainSocketService] customerSocketService injected.');
  }
}

module.exports = CaptainSocketService;