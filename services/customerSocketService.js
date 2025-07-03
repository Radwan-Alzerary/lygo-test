const jwt = require("jsonwebtoken");
const Ride = require("../model/ride");
const Customer = require("../model/customer"); // Assuming you have a Customer model
const RideSetting = require("../model/rideSetting"); // Add RideSetting import

class CustomerSocketService {
  constructor(io, logger, dependencies) {
    this.io = io;
    this.logger = logger;
    this.onlineCustomers = dependencies.onlineCustomers;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    this.rideSharingMap = dependencies.rideSharingMap;
    this.dispatchRide = dependencies.dispatchRide;
    this.calculateDistance = dependencies.calculateDistance;
    this.customerNamespace = null;
    this.rideSettings = null; // Cache for ride settings
  }

  async initialize() {
    // Load ride settings
    console.log('[CustomerSocketService] Initializing ride settings...');
    await this.loadRideSettings();

    // Customer Namespace
    this.customerNamespace = this.io.of("/customer");
    this.customerNamespace.on("connection", (socket) => this.handleConnection(socket));
    this.logger.info('[CustomerSocketService] Customer namespace initialized.');
  }

  async loadRideSettings() {
    try {
      this.rideSettings = await RideSetting.findOne({ name: "default" });
      if (!this.rideSettings) {
        // Create default settings if none exist
        this.rideSettings = new RideSetting({});
        await this.rideSettings.save();
        this.logger.info('[CustomerSocketService] Created default ride settings.');
      }
      this.logger.info('[CustomerSocketService] Ride settings loaded successfully.');
    } catch (err) {
      this.logger.error('[CustomerSocketService] Error loading ride settings:', err);
      // Use default values if DB fails
      this.rideSettings = {
        fare: {
          currency: "IQD",
          baseFare: 3000,
          pricePerKm: 500,
          pricePerMinute: 0,
          minRidePrice: 2000,
          maxRidePrice: 7000,
          nightMultiplier: 1.2,
          weekendMultiplier: 1.15,
          surge: {
            enabled: false,
            multiplier: 1.5
          }
        },
        passengerRules: {
          cancellationFee: 1000,
          freeCancelWindow: 120,
          minRatingRequired: 0
        },
        paymentMethods: ["cash", "wallet"],
        allowShared: false
      };
    }
  }

  handleConnection(socket) {
    this.logger.info(`[Socket.IO Customer] Incoming connection attempt. Socket ID: ${socket.id}`);
    const token = socket.handshake.query.token;

    if (!token) {
      this.logger.warn(`[Socket.IO Customer] Connection attempt without token. Socket ID: ${socket.id}. Disconnecting.`);
      socket.disconnect(true);
      return;
    }

    // Verify JWT token

    // داخل handleConnection بعد استخراج token
    jwt.verify(
      token,
      process.env.JWT_SECRET || "kishan sheth super secret key",
      async (err, decoded) => {
        if (err) {
          this.logger.warn(
            `[Socket.IO Customer] JWT verification failed for token: ${token}. Error: ${err.message}. Socket ID: ${socket.id}. Disconnecting.`
          );
          socket.disconnect(true);
          return;
        }

        // ✅ تحقّق من أن الحساب موجود ومفعّل قبل المتابعة
        try {
          this.logger.warn(decoded.id)
          const customer = await Customer.findById(decoded.id).select(
            "isActive isBlocked"
          );

          if (!customer) {
            this.logger.warn(
              `[Socket.IO Customer] Customer ${decoded.id} not found in DB. Disconnecting socket ${socket.id}.`
            );
            socket.emit("authError", { message: "Account not found." });
            socket.disconnect(true);
            return;
          }

          if (!customer.isActive) {
            this.logger.warn(
              `[Socket.IO Customer] Customer ${decoded.id} account inactive. Disconnecting socket ${socket.id}.`
            );
            socket.emit("authError", { message: "Account is inactive." });
            socket.disconnect(true);
            return;
          }

          // كل شيء سليم – تابع المنطق الاعتيادي
          await this.handleAuthenticated(socket, decoded);
        } catch (dbErr) {
          this.logger.error(
            `[Socket.IO Customer] DB error while checking customer ${decoded.id}:`,
            dbErr
          );
          socket.disconnect(true);
        }
      }
    );




  }

  async handleAuthenticated(socket, decoded) {
    const customerId = decoded.id;

    // Validate customer eligibility based on rules
    const isEligible = await this.validateCustomerEligibility(customerId);
    if (!isEligible.eligible) {
      this.logger.warn(`[Socket.IO Customer] Customer ${customerId} not eligible: ${isEligible.reason}`);
      socket.emit("eligibilityError", {
        message: isEligible.reason,
        requiredRating: this.rideSettings.passengerRules.minRatingRequired
      });
      socket.disconnect(true);
      return;
    }

    const oldSocketId = this.onlineCustomers[customerId];

    if (oldSocketId && oldSocketId !== socket.id) {
      this.logger.warn(`[Socket.IO Customer] Customer ${customerId} already connected with socket ${oldSocketId}. Disconnecting old socket.`);
      const oldSocket = this.customerNamespace.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
    }

    this.onlineCustomers[customerId] = socket.id;
    this.logger.info(`[Socket.IO Customer] Customer ${customerId} successfully connected. Socket ID: ${socket.id}`);
    this.logger.debug(`[State] Online customers: ${JSON.stringify(this.onlineCustomers)}`);

    // Send current settings to customer
    socket.emit("rideSettings", {
      fare: this.rideSettings.fare,
      paymentMethods: this.rideSettings.paymentMethods,
      allowShared: this.rideSettings.allowShared,
      cancellationPolicy: {
        fee: this.rideSettings.passengerRules.cancellationFee,
        freeCancelWindow: this.rideSettings.passengerRules.freeCancelWindow
      }
    });

    // Restore ride state on connection
    await this.restoreRideState(socket, customerId);

    // Setup event listeners
    this.setupEventListeners(socket, customerId);
  }

  async validateCustomerEligibility(customerId) {
    try {
      const customer = await Customer.findById(customerId).select('rating isBlocked');
      if (!customer) {
        return { eligible: false, reason: "Customer not found" };
      }

      // Check if customer is blocked
      if (customer.isBlocked) {
        return { eligible: false, reason: "Account is temporarily blocked" };
      }

      // Check minimum rating
      if (customer.rating < this.rideSettings.passengerRules.minRatingRequired) {
        return {
          eligible: false,
          reason: `Minimum rating required: ${this.rideSettings.passengerRules.minRatingRequired}. Current: ${customer.rating}`
        };
      }

      return { eligible: true };
    } catch (err) {
      this.logger.error(`[CustomerSocketService] Error validating customer eligibility for ${customerId}:`, err);
      return { eligible: false, reason: "Validation error" };
    }
  }

  async restoreRideState(socket, customerId) {
    try {
      this.logger.info(`[Socket.IO Customer] Checking for existing rides for customer ${customerId}`);
      const rides = await Ride.find({
        passenger: customerId,
        status: { $in: ['requested', 'accepted', 'notApprove', 'cancelled', 'arrived', 'onRide', 'completed'] },
      }).populate('driver', 'name carDetails phoneNumber');

      this.logger.info(`[DB] Found ${rides.length} relevant rides for customer ${customerId}`);

      for (const ride of rides) {
        this.logger.info(`[Socket.IO Customer] Processing ride ${ride._id} with status ${ride.status} for customer ${customerId}`);
        let captainInfo = null;

        if (ride.driver && ride.status !== 'requested' && ride.status !== 'notApprove' && ride.status !== 'cancelled') {
          captainInfo = ride.driver ? {
            name: ride.driver.name,
            vehicle: ride.driver.carDetails,
            phoneNumber: ride.driver.phoneNumber,
          } : null;
        }

        this.emitRideStatus(socket, ride, captainInfo);
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error checking/notifying customer ${customerId} about rides:`, err);
    }
  }

  emitRideStatus(socket, ride, captainInfo) {
    const rideId = ride._id;

    switch (ride.status) {
      case 'requested':
        this.logger.info(`[Socket.IO Customer] Emitting 'ridePending' for ride ${rideId}`);
        socket.emit('ridePending', {
          rideId: ride._id,
          pickupLocation: ride.pickupLocation.coordinates,
          dropoffLocation: ride.dropoffLocation.coordinates,
          distance: ride.distance,
          duration: ride.duration,
          fare: ride.fare.amount,
          currency: this.rideSettings.fare.currency,
          paymentMethod: ride.paymentMethod
        });
        break;

      case 'accepted':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideAccepted' for ride ${rideId}`);
        socket.emit("rideAccepted", {
          rideId: ride._id,
          driverId: ride.driver?._id,
          driverInfo: captainInfo,
        });
        break;

      case 'arrived':
        this.logger.info(`[Socket.IO Customer] Emitting 'driverArrived' for ride ${rideId}`);
        socket.emit("driverArrived", {
          rideId: ride._id,
          message: "Your captain has arrived.",
        });
        break;

      case 'onRide':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideStarted' for ride ${rideId}`);
        socket.emit("rideStarted", { rideId: ride._id });
        break;

      case 'completed':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideCompleted' for ride ${rideId}`);
        socket.emit("rideCompleted", {
          rideId: ride._id,
          message: "Your ride has been completed. Thank you for riding with us.",
          fare: ride.fare.amount,
          currency: this.rideSettings.fare.currency
        });
        break;

      case 'notApprove':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideNotApproved' for ride ${rideId}`);
        socket.emit("rideNotApproved", {
          rideId: ride._id,
          message: "We couldn't find a captain for your previous request.",
        });
        break;

      case 'cancelled':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideCanceled' for ride ${rideId}`);
        socket.emit("rideCanceled", {
          rideId: ride._id,
          message: "Your ride was cancelled.",
        });
        break;
      default:
        this.logger.warn(`[Socket.IO Customer] Unknown ride status "${ride.status}" for ride ${rideId}`);
    }
  }

  setupEventListeners(socket, customerId) {
    // Listen for ride requests
    socket.on("requestRide", async (rideData) => {
      await this.handleRideRequest(socket, customerId, rideData);
    });

    // Listen for ride cancellation
    socket.on("cancelRide", async (data) => {
      await this.handleRideCancellation(socket, customerId, data);
    });

    // Listen for fare estimate requests
    socket.on("requestFareEstimate", async (data) => {
      await this.handleFareEstimate(socket, customerId, data);
    });

    // Handle settings refresh request
    socket.on("refreshSettings", async () => {
      await this.loadRideSettings();
      socket.emit("rideSettings", {
        fare: this.rideSettings.fare,
        paymentMethods: this.rideSettings.paymentMethods,
        allowShared: this.rideSettings.allowShared,
        cancellationPolicy: {
          fee: this.rideSettings.passengerRules.cancellationFee,
          freeCancelWindow: this.rideSettings.passengerRules.freeCancelWindow
        }
      });
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      this.handleDisconnect(socket, customerId, reason);
    });

    // Handle socket errors
    socket.on('error', (error) => {
      this.logger.error(`[Socket.IO Customer] Socket error for customer ${customerId} on socket ${socket.id}:`, error);
    });
  }

  async handleFareEstimate(socket, customerId, data) {
    this.logger.info(`[Socket.IO Customer] Received 'requestFareEstimate' from customer ${customerId}. Data: ${JSON.stringify(data)}`);

    // Validate input
    if (!data || !data.origin || !data.destination || !data.distance) {
      socket.emit("fareEstimateError", { message: "Invalid location or distance data provided." });
      return;
    }

    try {
      const estimatedFare = this.calculateFare(data.distance, data.duration || 0);

      socket.emit("fareEstimate", {
        baseFare: this.rideSettings.fare.baseFare,
        pricePerKm: this.rideSettings.fare.pricePerKm,
        distance: data.distance,
        estimatedFare: estimatedFare,
        currency: this.rideSettings.fare.currency,
        surge: this.rideSettings.fare.surge.enabled ? {
          active: this.isSurgeActive(),
          multiplier: this.rideSettings.fare.surge.multiplier
        } : null
      });

    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error calculating fare estimate for customer ${customerId}:`, err);
      socket.emit("fareEstimateError", { message: "Failed to calculate fare estimate." });
    }
  }

  calculateFare(distanceKm, durationMinutes = 0) {
    let fare = this.rideSettings.fare.baseFare;

    // Add distance cost
    fare += distanceKm * this.rideSettings.fare.pricePerKm;

    // Add time cost if configured
    fare += durationMinutes * this.rideSettings.fare.pricePerMinute;

    // Apply time-based multipliers
    const now = new Date();
    const hour = now.getHours();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    // Night multiplier (assuming 10 PM to 6 AM is night)
    if (hour >= 22 || hour < 6) {
      fare *= this.rideSettings.fare.nightMultiplier;
    }

    // Weekend multiplier
    if (isWeekend) {
      fare *= this.rideSettings.fare.weekendMultiplier;
    }

    // Apply surge pricing if active
    if (this.isSurgeActive()) {
      fare *= this.rideSettings.fare.surge.multiplier;
    }

    // Ensure fare is within bounds
    fare = Math.max(this.rideSettings.fare.minRidePrice, fare);
    fare = Math.min(this.rideSettings.fare.maxRidePrice, fare);

    return Math.round(fare);
  }

  isSurgeActive() {
    if (!this.rideSettings.fare.surge.enabled) {
      return false;
    }

    const now = new Date();
    const surgeStart = this.rideSettings.fare.surge.activeFrom;
    const surgeEnd = this.rideSettings.fare.surge.activeTo;

    if (surgeStart && surgeEnd) {
      return now >= surgeStart && now <= surgeEnd;
    }

    // If no time window specified, surge is always active when enabled
    return true;
  }

  async handleRideRequest(socket, customerId, rideData) {
    this.logger.info(`[Socket.IO Customer] Received 'requestRide' from customer ${customerId}. Socket ID: ${socket.id}. Data: ${JSON.stringify(rideData)}`);

    // Basic validation
    if (!rideData || !rideData.origin || !rideData.destination ||
      typeof rideData.origin.latitude !== "number" || typeof rideData.origin.longitude !== "number" ||
      typeof rideData.destination.latitude !== "number" || typeof rideData.destination.longitude !== "number") {
      this.logger.warn(`[Socket.IO Customer] Invalid rideData received from customer ${customerId}. Data: ${JSON.stringify(rideData)}`);
      socket.emit("rideError", { message: "Invalid location data provided. Please try again." });
      return;
    }

    // Validate payment method
    if (rideData.paymentMethod && !this.rideSettings.paymentMethods.includes(rideData.paymentMethod)) {
      this.logger.warn(`[Socket.IO Customer] Invalid payment method ${rideData.paymentMethod} from customer ${customerId}`);
      socket.emit("rideError", {
        message: `Payment method not supported. Available: ${this.rideSettings.paymentMethods.join(', ')}`
      });
      return;
    }

    try {
      // Check if customer already has an active ride
      const existingRide = await Ride.findOne({
        passenger: customerId,
        status: { $in: ['requested', 'accepted', 'arrived', 'onRide'] }
      });

      if (existingRide) {
        existingRide.status = "cancelled"; // Cancel existing ride}
        await existingRide.save();
      }

      // Calculate fare based on settings
      const distance = rideData.distance || 0;
      const duration = rideData.duration || 0;
      const calculatedFare = this.calculateFare(distance, duration);

      this.logger.info(`[Socket.IO Customer] Creating new ride for customer ${customerId}. Calculated fare: ${calculatedFare} ${this.rideSettings.fare.currency}`);

      const newRide = new Ride({
        passenger: customerId,
        driver: null,
        pickupLocation: {
          type: 'Point',
          coordinates: [rideData.origin.longitude, rideData.origin.latitude],
        },
        dropoffLocation: {
          type: 'Point',
          coordinates: [rideData.destination.longitude, rideData.destination.latitude],
        },
        fare: {
          amount: calculatedFare,
          currency: this.rideSettings.fare.currency,
        },
        distance: distance,
        duration: duration,
        paymentMethod: rideData.paymentMethod || this.rideSettings.paymentMethods[0], // Default to first available method
        status: "requested",
        isDispatching: true,
        notified: false,
      });

      await newRide.save();
      this.logger.info(`[DB] Ride ${newRide._id} created successfully for customer ${customerId}. Status: requested. Fare: ${calculatedFare} ${this.rideSettings.fare.currency}`);

      // Emit confirmation back to customer
      socket.emit('ridePending', {
        rideId: newRide._id,
        pickupLocation: newRide.pickupLocation.coordinates,
        dropoffLocation: newRide.dropoffLocation.coordinates,
        distance: newRide.distance,
        duration: newRide.duration,
        fare: newRide.fare.amount,
        currency: this.rideSettings.fare.currency,
        paymentMethod: newRide.paymentMethod,
        message: "Ride requested. Searching for nearby captains..."
      });

      // Start the dispatch process
      this.logger.info(`[Dispatch] Starting dispatch process for ride ${newRide._id, rideData.origin}`);
      this.dispatchRide(newRide, rideData.origin);

    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error creating/broadcasting ride for customer ${customerId}:`, err);
      socket.emit("rideError", { message: "Failed to create ride. Please try again later." });
    }
  }

  async handleRideCancellation(socket, customerId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    if (!rideId) {
      this.logger.warn(`[Socket.IO Customer] Received 'cancelRide' without rideId from customer ${customerId}.`);
      socket.emit("rideError", { message: "Missing ride ID in cancellation request." });
      return;
    }

    this.logger.info(`[Socket.IO Customer] Received 'cancelRide' for ride ${rideId} from customer ${customerId}`);

    try {
      const ride = await Ride.findOne({ _id: rideId, passenger: customerId });

      if (!ride) {
        this.logger.warn(`[Socket.IO Customer] Customer ${customerId} tried to cancel ride ${rideId}, but ride was not found.`);
        socket.emit("rideError", { message: "Cannot cancel ride. Ride not found.", rideId: rideId });
        return;
      }

      const cancellableStatuses = ['requested', 'accepted', 'arrived'];
      if (!cancellableStatuses.includes(ride.status)) {
        this.logger.warn(`[Socket.IO Customer] Customer ${customerId} tried to cancel ride ${rideId} with status ${ride.status}, which is not allowed.`);
        socket.emit("rideError", { message: `Cannot cancel ride. Current status is '${ride.status}'.`, rideId: rideId });
        return;
      }

      // Calculate cancellation fee
      const createdAt = new Date(ride.createdAt);
      const now = new Date();
      const timeDifference = (now - createdAt) / 1000; // seconds

      let cancellationFee = 0;
      if (timeDifference > this.rideSettings.passengerRules.freeCancelWindow) {
        cancellationFee = this.rideSettings.passengerRules.cancellationFee;
        // Here you would typically deduct from customer's wallet
        this.logger.info(`[Socket.IO Customer] Cancellation fee of ${cancellationFee} ${this.rideSettings.fare.currency} applied to customer ${customerId} for ride ${rideId}`);
      }

      this.logger.info(`[DB] Updating ride ${rideId} status to 'cancelled' due to customer cancellation. Fee: ${cancellationFee}`);

      ride.status = "cancelled";
      ride.isDispatching = false;
      ride.cancellationReason = `Cancelled by customer ${customerId}`;
      ride.cancellationFee = cancellationFee;
      await ride.save();

      // Stop dispatch process if running
      if (this.dispatchProcesses.has(rideId.toString())) {
        this.logger.info(`[Dispatch] Found active dispatch process for ride ${rideId}. Cancelling.`);
        const cancelDispatch = this.dispatchProcesses.get(rideId.toString());
        cancelDispatch();
        this.dispatchProcesses.delete(rideId.toString());
        this.logger.info(`[Dispatch] Dispatch process for ride ${rideId} cancelled and removed.`);
      }

      // Notify captain if ride was accepted
      if (ride.driver && (ride.status === 'accepted' || ride.status === 'arrived')) {
        // This would typically be handled by injecting the captain service
        this.logger.info(`[Socket.IO Captain] Notifying captain ${ride.driver} about ride ${rideId} cancellation`);
      }

      // Confirm cancellation to customer
      socket.emit("rideCancelledConfirmation", {
        rideId: ride._id,
        message: "Ride successfully cancelled.",
        cancellationFee: cancellationFee,
        currency: this.rideSettings.fare.currency
      });

    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error cancelling ride ${rideId} for customer ${customerId}:`, err);
      socket.emit("rideError", { message: "Failed to cancel ride due to a server error.", rideId: rideId });
    }
  }

  handleDisconnect(socket, customerId, reason) {
    this.logger.info(`[Socket.IO Customer] Customer ${customerId} disconnected. Socket ID: ${socket.id}. Reason: ${reason}`);

    // Clean up: Find the customerId associated with this socket.id and remove it
    for (let id in this.onlineCustomers) {
      if (this.onlineCustomers[id] === socket.id) {
        delete this.onlineCustomers[id];
        this.logger.info(`[State] Removed customer ${id} from onlineCustomers.`);
        this.logger.debug(`[State] Online customers: ${JSON.stringify(this.onlineCustomers)}`);
        break;
      }
    }
  }

  // Method to emit events to customers (called from other services)
  emitToCustomer(customerId, event, data) {
    const customerSocketId = this.onlineCustomers[customerId];
    if (customerSocketId) {
      this.customerNamespace.to(customerSocketId).emit(event, data);
      return true;
    }
    return false;
  }

  // Method to get current settings (for external use)
  getCurrentSettings() {
    return this.rideSettings;
  }

  // Method to validate if fare is within bounds
  validateFareInBounds(fareAmount) {
    return fareAmount >= this.rideSettings.fare.minRidePrice &&
      fareAmount <= this.rideSettings.fare.maxRidePrice;
  }
}

module.exports = CustomerSocketService;