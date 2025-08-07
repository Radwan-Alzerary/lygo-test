const jwt = require("jsonwebtoken");
const Ride = require("../model/ride");
const Customer = require("../model/customer"); // Assuming you have a Customer model
const RideSetting = require("../model/rideSetting"); // Add RideSetting import
const UserSavedState = require("../model/userSavedState"); // State management model
const ChatService = require("./chatService"); // Chat service for messaging
const StateManagementService = require("./stateManagementService"); // State management service

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
    
    // Initialize chat service
    this.chatService = new ChatService(logger, dependencies.redisClient);
    
    // Initialize state management service
    this.stateManagementService = new StateManagementService(logger, dependencies.redisClient);
    
    // Validate dependencies
    this.validateDependencies();
  }

  /**
   * Validate required dependencies
   */
  validateDependencies() {
    const requiredDependencies = [
      'onlineCustomers',
      'onlineCaptains',
      'dispatchProcesses',
      'rideSharingMap',
      'dispatchRide'
    ];
    
    const missingDependencies = requiredDependencies.filter(dep => !this[dep]);
    
    if (missingDependencies.length > 0) {
      throw new Error(`Missing required dependencies: ${missingDependencies.join(', ')}`);
    }
    
    // Warn about optional dependencies
    const optionalDependencies = ['calculateDistance'];
    const missingOptional = optionalDependencies.filter(dep => !this[dep]);
    
    if (missingOptional.length > 0) {
      this.logger.warn(`[CustomerSocketService] Missing optional dependencies: ${missingOptional.join(', ')}. Some features may be limited.`);
    }
  }

  async initialize() {
    // Load ride settings
    this.logger.info('[CustomerSocketService] Initializing ride settings...');
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
        this.rideSettings = new RideSetting({
          name: "default",
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
        });
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
          this.logger.debug(`[Socket.IO Customer] Authenticating customer ${decoded.id}`);
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
    try {
      socket.emit("rideSettings", {
        fare: this.rideSettings?.fare || {},
        paymentMethods: this.rideSettings?.paymentMethods || ["cash"],
        allowShared: this.rideSettings?.allowShared || false,
        cancellationPolicy: {
          fee: this.rideSettings?.passengerRules?.cancellationFee || 1000,
          freeCancelWindow: this.rideSettings?.passengerRules?.freeCancelWindow || 120
        }
      });
    } catch (error) {
      this.logger.error(`[Socket.IO Customer] Error sending ride settings to customer ${customerId}:`, error);
    }

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
      const minRatingRequired = this.rideSettings?.passengerRules?.minRatingRequired || 0;
      if (customer.rating < minRatingRequired) {
        return {
          eligible: false,
          reason: `Minimum rating required: ${minRatingRequired}. Current: ${customer.rating}`
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

      // Only look for truly active rides + very recent completed rides
      const activeRides = await Ride.find({
        passenger: customerId,
        status: { $in: ['requested', 'accepted', 'arrived', 'onRide'] },
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Last 24 hours
      }).populate('driver', 'name carDetails phoneNumber')
        .sort({ createdAt: -1 })
        .limit(1); // Only get the most recent active ride

      // Check for very recent completed rides (last 30 minutes) for rating
      const recentCompleted = await Ride.find({
        passenger: customerId,
        status: 'completed',
        passengerRating: null,
        updatedAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // Last 30 minutes
      }).populate('driver', 'name carDetails phoneNumber')
        .sort({ updatedAt: -1 })
        .limit(1);

      let rideToRestore = null;

      if (activeRides.length > 0) {
        rideToRestore = activeRides[0];
        this.logger.info(`[Socket.IO Customer] Found active ride ${rideToRestore._id} with status ${rideToRestore.status}`);
      } else if (recentCompleted.length > 0) {
        rideToRestore = recentCompleted[0];
        this.logger.info(`[Socket.IO Customer] Found recent completed ride ${rideToRestore._id} for rating`);
      }

      if (rideToRestore) {
        // Prepare comprehensive ride data
        const rideData = {
          rideId: rideToRestore._id,
          status: rideToRestore.status,
          pickupLocation: rideToRestore.pickupLocation,
          dropoffLocation: rideToRestore.dropoffLocation,
          distance: rideToRestore.distance,
          duration: rideToRestore.duration,
          fare: rideToRestore.fare,
          paymentMethod: rideToRestore.paymentMethod,
          createdAt: rideToRestore.createdAt,
          updatedAt: rideToRestore.updatedAt
        };

        // Add driver info if available and ride is not in initial states
        if (rideToRestore.driver && !['requested', 'notApprove', 'cancelled'].includes(rideToRestore.status)) {
          rideData.driverInfo = {
            name: rideToRestore.driver.name,
            vehicle: rideToRestore.driver.carDetails,
            phoneNumber: rideToRestore.driver.phoneNumber,
          };
        }

        // Send comprehensive restoration event
        this.logger.info(`[Socket.IO Customer] Sending ride restoration data for ride ${rideToRestore._id}`);
        socket.emit('rideRestored', rideData);

        // Then send the appropriate status event based on current status
        this.emitRideStatus(socket, rideToRestore, rideData.driverInfo);

      } else {
        this.logger.info(`[Socket.IO Customer] No active or recent rides found for customer ${customerId}`);
      }

    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error restoring ride state for customer ${customerId}:`, err);
    }
  }

  emitRideStatus(socket, ride, captainInfo) {
    try {
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
          currency: this.rideSettings?.fare?.currency || "IQD"
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
    } catch (error) {
      this.logger.error(`[Socket.IO Customer] Error emitting ride status for ride ${ride?._id}:`, error);
    }
  }

  setupEventListeners(socket, customerId) {
    try {
      // Listen for ride requests
      socket.on("requestRide", async (rideData) => {
        try {
          await this.handleRideRequest(socket, customerId, rideData);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling ride request for customer ${customerId}:`, error);
          socket.emit("rideError", { message: "Failed to process ride request." });
        }
      });

      // Listen for ride cancellation
      socket.on("cancelRide", async (data) => {
        try {
          await this.handleRideCancellation(socket, customerId, data);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling ride cancellation for customer ${customerId}:`, error);
          socket.emit("rideError", { message: "Failed to cancel ride." });
        }
      });

      // Listen for fare estimate requests
      socket.on("requestFareEstimate", async (data) => {
        try {
          await this.handleFareEstimate(socket, customerId, data);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling fare estimate for customer ${customerId}:`, error);
          socket.emit("fareEstimateError", { message: "Failed to calculate fare estimate." });
        }
      });

      // Handle settings refresh request
      socket.on("refreshSettings", async () => {
        try {
          await this.loadRideSettings();
          socket.emit("rideSettings", {
            fare: this.rideSettings?.fare || {},
            paymentMethods: this.rideSettings?.paymentMethods || ["cash"],
            allowShared: this.rideSettings?.allowShared || false,
            cancellationPolicy: {
              fee: this.rideSettings?.passengerRules?.cancellationFee || 1000,
              freeCancelWindow: this.rideSettings?.passengerRules?.freeCancelWindow || 120
            }
          });
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error refreshing settings for customer ${customerId}:`, error);
        }
      });

      // ===============================
      // Chat System Events - Customer
      // ===============================

      // Send chat message
      socket.on("sendChatMessage", async (data, callback) => {
        try {
          await this.handleSendChatMessage(socket, customerId, data, callback);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling send chat message for customer ${customerId}:`, error);
          if (callback) callback({ success: false, message: "Failed to send message" });
        }
      });

      // Get chat history
      socket.on("getChatHistory", async (data, callback) => {
        try {
          await this.handleGetChatHistory(socket, customerId, data, callback);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error getting chat history for customer ${customerId}:`, error);
          if (callback) callback({ success: false, message: "Failed to get chat history" });
        }
      });

      // Mark messages as read
      socket.on("markMessagesAsRead", async (data) => {
        try {
          await this.handleMarkMessagesAsRead(socket, customerId, data);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error marking messages as read for customer ${customerId}:`, error);
        }
      });

      // Typing indicator
      socket.on("typingIndicator", async (data) => {
        try {
          await this.handleTypingIndicator(socket, customerId, data);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling typing indicator for customer ${customerId}:`, error);
        }
      });

      // Get quick messages
      socket.on("getQuickMessages", (callback) => {
        try {
          const quickMessages = this.chatService.getQuickMessages('customer');
          if (callback) callback({ success: true, messages: quickMessages });
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error getting quick messages for customer ${customerId}:`, error);
          if (callback) callback({ success: false, message: "Failed to get quick messages" });
        }
      });

      // ===============================
      // End Chat System Events
      // ===============================

      // ===============================
      // State Management Events
      // ===============================

      // Save ride state
      socket.on("saveRideState", async (data) => {
        try {
          await this.handleSaveRideState(socket, customerId, data);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling save ride state for customer ${customerId}:`, error);
          socket.emit("saveRideStateResult", {
            success: false,
            error: error.message,
            message: "فشل في حفظ الحالة"
          });
        }
      });

      // Restore ride state
      socket.on("restoreRideState", async (data) => {
        try {
          await this.handleRestoreRideState(socket, customerId, data);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling restore ride state for customer ${customerId}:`, error);
          socket.emit("restoreRideStateResult", {
            success: false,
            error: error.message,
            message: "فشل في استرجاع الحالة"
          });
        }
      });

      // Clear saved state
      socket.on("clearSavedState", async (data) => {
        try {
          await this.handleClearSavedState(socket, customerId, data);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error handling clear saved state for customer ${customerId}:`, error);
          socket.emit("clearSavedStateResult", {
            success: false,
            error: error.message,
            message: "فشل في مسح الحالة المحفوظة"
          });
        }
      });

      // Validate promo code
      socket.on("validatePromoCode", async (data, callback) => {
        try {
          await this.handleValidatePromoCode(socket, customerId, data, callback);
        } catch (error) {
          this.logger.error(`[Socket.IO Customer] Error validating promo code for customer ${customerId}:`, error);
          if (callback) callback({
            success: false,
            error: error.message,
            message: "فشل في التحقق من كود الخصم"
          });
        }
      });

      // ===============================
      // End State Management Events
      // ===============================      // Handle disconnect
      socket.on("disconnect", (reason) => {
        this.handleDisconnect(socket, customerId, reason);
      });

      // Handle socket errors
      socket.on('error', (error) => {
        this.logger.error(`[Socket.IO Customer] Socket error for customer ${customerId} on socket ${socket.id}:`, error);
      });
    } catch (error) {
      this.logger.error(`[Socket.IO Customer] Error setting up event listeners for customer ${customerId}:`, error);
    }
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
        baseFare: this.rideSettings?.fare?.baseFare || 3000,
        pricePerKm: this.rideSettings?.fare?.pricePerKm || 500,
        distance: data.distance,
        estimatedFare: estimatedFare,
        currency: this.rideSettings?.fare?.currency || "IQD",
        surge: this.rideSettings?.fare?.surge?.enabled ? {
          active: this.isSurgeActive(),
          multiplier: this.rideSettings?.fare?.surge?.multiplier || 1.5
        } : null
      });

    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error calculating fare estimate for customer ${customerId}:`, err);
      socket.emit("fareEstimateError", { message: "Failed to calculate fare estimate." });
    }
  }

  calculateFare(distanceKm, durationMinutes = 0) {
    if (!this.rideSettings?.fare) {
      this.logger.warn('[CustomerSocketService] Ride settings not available for fare calculation, using defaults');
      return 3000; // Default fare
    }

    let fare = this.rideSettings.fare.baseFare || 3000;

    // Add distance cost
    fare += distanceKm * (this.rideSettings.fare.pricePerKm || 500);

    // Add time cost if configured
    fare += durationMinutes * (this.rideSettings.fare.pricePerMinute || 0);

    // Apply time-based multipliers
    const now = new Date();
    const hour = now.getHours();
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    // Night multiplier (assuming 10 PM to 6 AM is night)
    if (hour >= 22 || hour < 6) {
      fare *= (this.rideSettings.fare.nightMultiplier || 1.2);
    }

    // Weekend multiplier
    if (isWeekend) {
      fare *= (this.rideSettings.fare.weekendMultiplier || 1.15);
    }

    // Apply surge pricing if active
    if (this.isSurgeActive()) {
      fare *= (this.rideSettings.fare.surge?.multiplier || 1.5);
    }

    // Ensure fare is within bounds
    fare = Math.max(this.rideSettings.fare.minRidePrice || 2000, fare);
    fare = Math.min(this.rideSettings.fare.maxRidePrice || 7000, fare);

    return Math.round(fare);
  }

  isSurgeActive() {
    if (!this.rideSettings?.fare?.surge?.enabled) {
      return false;
    }

    const now = new Date();
    const surgeStart = this.rideSettings?.fare?.surge?.activeFrom;
    const surgeEnd = this.rideSettings?.fare?.surge?.activeTo;

    if (surgeStart && surgeEnd) {
      return now >= surgeStart && now <= surgeEnd;
    }

    // If no time window specified, surge is always active when enabled
    return true;
  }

  async handleRideRequest(socket, customerId, rideData) {
    this.logger.info(`[Socket.IO Customer] Received 'requestRide' from customer ${customerId}. Socket ID: ${socket.id}. Data: ${JSON.stringify(rideData)}`);

    // Updated validation to handle GeoJSON coordinate format
    if (!rideData || !rideData.origin || !rideData.destination) {
      this.logger.warn(`[Socket.IO Customer] Invalid rideData received from customer ${customerId}. Data: ${JSON.stringify(rideData)}`);
      socket.emit("rideError", { message: "Invalid location data provided. Please try again." });
      return;
    }

    // Handle both coordinate formats: {latitude, longitude} and {coordinates: [lng, lat]}
    let originLat, originLng, destLat, destLng;

    if (rideData.origin.coordinates && Array.isArray(rideData.origin.coordinates)) {
      // GeoJSON format: coordinates: [longitude, latitude]
      originLng = rideData.origin.coordinates[0];
      originLat = rideData.origin.coordinates[1];
    } else if (rideData.origin.latitude && rideData.origin.longitude) {
      // Separate properties format
      originLat = rideData.origin.latitude;
      originLng = rideData.origin.longitude;
    } else {
      this.logger.warn(`[Socket.IO Customer] Invalid origin coordinates from customer ${customerId}. Data: ${JSON.stringify(rideData.origin)}`);
      socket.emit("rideError", { message: "Invalid origin location data provided. Please try again." });
      return;
    }

    if (rideData.destination.coordinates && Array.isArray(rideData.destination.coordinates)) {
      // GeoJSON format: coordinates: [longitude, latitude]
      destLng = rideData.destination.coordinates[0];
      destLat = rideData.destination.coordinates[1];
    } else if (rideData.destination.latitude && rideData.destination.longitude) {
      // Separate properties format
      destLat = rideData.destination.latitude;
      destLng = rideData.destination.longitude;
    } else {
      this.logger.warn(`[Socket.IO Customer] Invalid destination coordinates from customer ${customerId}. Data: ${JSON.stringify(rideData.destination)}`);
      socket.emit("rideError", { message: "Invalid destination location data provided. Please try again." });
      return;
    }

    // Validate coordinate values
    if (typeof originLat !== "number" || typeof originLng !== "number" ||
      typeof destLat !== "number" || typeof destLng !== "number" ||
      isNaN(originLat) || isNaN(originLng) || isNaN(destLat) || isNaN(destLng)) {
      this.logger.warn(`[Socket.IO Customer] Invalid coordinate values from customer ${customerId}. Origin: [${originLng}, ${originLat}], Destination: [${destLng}, ${destLat}]`);
      socket.emit("rideError", { message: "Invalid coordinate values provided. Please try again." });
      return;
    }

    // Validate payment method
    const availablePaymentMethods = this.rideSettings?.paymentMethods || ["cash"];
    if (rideData.paymentMethod && !availablePaymentMethods.includes(rideData.paymentMethod)) {
      this.logger.warn(`[Socket.IO Customer] Invalid payment method ${rideData.paymentMethod} from customer ${customerId}`);
      socket.emit("rideError", {
        message: `Payment method not supported. Available: ${availablePaymentMethods.join(', ')}`
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
        existingRide.status = "cancelled"; // Cancel existing ride
        await existingRide.save();
      }

      // Calculate fare based on settings
      const distance = rideData.distance || 0;
      const duration = rideData.duration || 0;
      const calculatedFare = rideData.fareAmount || this.calculateFare(distance, duration);

      this.logger.info(`[Socket.IO Customer] Creating new ride for customer ${customerId}. Calculated fare: ${calculatedFare} ${this.rideSettings?.fare?.currency || "IQD"}`);

      const newRide = new Ride({
        passenger: customerId,
        driver: null,
        pickupLocation: {
          type: 'Point',
          locationName: rideData.originPlaceName,
          coordinates: [originLng, originLat], // GeoJSON format: [longitude, latitude]
        },
        dropoffLocation: {
          type: 'Point',
          locationName: rideData.destinationPlaceName,
          coordinates: [destLng, destLat], // GeoJSON format: [longitude, latitude]
        },
        fare: {
          amount: calculatedFare,
          currency: this.rideSettings?.fare?.currency || "IQD",
        },
        distance: distance,
        duration: duration,
        paymentMethod: rideData.paymentMethod || this.rideSettings.paymentMethods[0], // Default to first available method
        status: "requested",
        isDispatching: true,
        notified: false,
      });

      await newRide.save();
      this.logger.info(`[DB] Ride ${newRide._id} created successfully for customer ${customerId}. Status: requested. Fare: ${calculatedFare} ${this.rideSettings?.fare?.currency || "IQD"}`);

      // Emit confirmation back to customer
      socket.emit('ridePending', {
        rideId: newRide._id,
        pickupLocation: newRide.pickupLocation.coordinates,
        dropoffLocation: newRide.dropoffLocation.coordinates,
        distance: newRide.distance,
        duration: newRide.duration,
        fare: newRide.fare.amount,
        currency: this.rideSettings?.fare?.currency || "IQD",
        paymentMethod: newRide.paymentMethod,
        message: "Ride requested. Searching for nearby captains..."
      });

      // Start the dispatch process - create origin object for dispatch
      const originForDispatch = {
        latitude: originLat,
        longitude: originLng
      };

      this.logger.info(`[Dispatch] Starting dispatch process for ride ${newRide._id}`);
      this.dispatchRide(newRide, originForDispatch);

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
      const freeCancelWindow = this.rideSettings?.passengerRules?.freeCancelWindow || 120;
      if (timeDifference > freeCancelWindow) {
        cancellationFee = this.rideSettings?.passengerRules?.cancellationFee || 1000;
        // Here you would typically deduct from customer's wallet
        const currency = this.rideSettings?.fare?.currency || "IQD";
        this.logger.info(`[Socket.IO Customer] Cancellation fee of ${cancellationFee} ${currency} applied to customer ${customerId} for ride ${rideId}`);
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
        currency: this.rideSettings?.fare?.currency || "IQD"
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
    const minPrice = this.rideSettings?.fare?.minRidePrice || 2000;
    const maxPrice = this.rideSettings?.fare?.maxRidePrice || 7000;
    return fareAmount >= minPrice && fareAmount <= maxPrice;
  }

  // ===============================
  // Chat System Handler Methods
  // ===============================

  /**
   * Handle sending chat message
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - Message data
   * @param {Function} callback - Response callback
   */
  async handleSendChatMessage(socket, customerId, data, callback) {
    try {
      const { rideId, text, tempId, isQuick = false, quickMessageType = null } = data;

      // Validate required fields
      if (!rideId || !text) {
        if (callback) callback({ 
          success: false, 
          message: "Missing required fields: rideId and text are required" 
        });
        return;
      }

      // Send message through chat service
      const message = await this.chatService.sendMessage({
        rideId,
        senderId: customerId,
        senderType: 'customer',
        text,
        tempId,
        isQuick,
        quickMessageType
      });

      // Get ride details to find driver
      const ride = await Ride.findById(rideId).select('driver');
      
      // Notify driver if online
      if (ride && ride.driver) {
        const driverSocketId = this.onlineCaptains[ride.driver.toString()];
        if (driverSocketId) {
          this.io.to(driverSocketId).emit('chatMessage', {
            messageId: message._id,
            rideId: message.rideId,
            text: message.text,
            senderId: message.senderId,
            senderType: message.senderType,
            isQuick: message.isQuick,
            timestamp: message.createdAt,
            tempId: message.tempId,
            messageStatus: message.messageStatus
          });

          this.logger.debug(`[Chat] Message sent from customer ${customerId} to driver ${ride.driver} for ride ${rideId}`);
        }
      }

      // Send response back to customer
      if (callback) {
        callback({
          success: true,
          message: {
            messageId: message._id,
            rideId: message.rideId,
            text: message.text,
            senderId: message.senderId,
            senderType: message.senderType,
            isQuick: message.isQuick,
            timestamp: message.createdAt,
            tempId: message.tempId,
            messageStatus: message.messageStatus
          }
        });
      }

    } catch (error) {
      this.logger.error(`[Chat] Error sending message from customer ${customerId}:`, error);
      if (callback) {
        callback({
          success: false,
          message: error.message || "Failed to send message"
        });
      }
    }
  }

  /**
   * Handle getting chat history
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - Request data
   * @param {Function} callback - Response callback
   */
  async handleGetChatHistory(socket, customerId, data, callback) {
    try {
      const { rideId, limit = 50, skip = 0 } = data;

      if (!rideId) {
        if (callback) callback({ 
          success: false, 
          message: "rideId is required" 
        });
        return;
      }

      // Verify customer is part of this ride
      const ride = await Ride.findById(rideId).select('passenger');
      if (!ride || ride.passenger.toString() !== customerId) {
        if (callback) callback({ 
          success: false, 
          message: "Unauthorized access to chat history" 
        });
        return;
      }

      // Get chat history
      const messages = await this.chatService.getChatHistory(rideId, limit, skip);
      const unreadCount = await this.chatService.getUnreadCount(rideId, 'customer');

      if (callback) {
        callback({
          success: true,
          messages: messages,
          unreadCount: unreadCount
        });
      }

    } catch (error) {
      this.logger.error(`[Chat] Error getting chat history for customer ${customerId}:`, error);
      if (callback) {
        callback({
          success: false,
          message: error.message || "Failed to get chat history"
        });
      }
    }
  }

  /**
   * Handle marking messages as read
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - Request data
   */
  async handleMarkMessagesAsRead(socket, customerId, data) {
    try {
      const { rideId, messageIds } = data;

      if (!rideId || !messageIds || !Array.isArray(messageIds)) {
        this.logger.warn(`[Chat] Invalid data for marking messages as read from customer ${customerId}`);
        return;
      }

      // Verify customer is part of this ride
      const ride = await Ride.findById(rideId).select('passenger driver');
      if (!ride || ride.passenger.toString() !== customerId) {
        this.logger.warn(`[Chat] Unauthorized attempt to mark messages as read by customer ${customerId} for ride ${rideId}`);
        return;
      }

      // Mark messages as read
      const result = await this.chatService.markMessagesAsRead(rideId, messageIds, 'customer');

      // Notify driver if online
      if (ride.driver) {
        const driverSocketId = this.onlineCaptains[ride.driver.toString()];
        if (driverSocketId) {
          this.io.to(driverSocketId).emit('messageRead', {
            rideId: rideId,
            messageIds: messageIds,
            readBy: 'customer',
            readAt: new Date()
          });
        }
      }

      this.logger.debug(`[Chat] Customer ${customerId} marked ${result.modifiedCount} messages as read for ride ${rideId}`);

    } catch (error) {
      this.logger.error(`[Chat] Error marking messages as read for customer ${customerId}:`, error);
    }
  }

  /**
   * Handle typing indicator
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - Typing data
   */
  async handleTypingIndicator(socket, customerId, data) {
    try {
      const { rideId, isTyping } = data;

      if (!rideId || typeof isTyping !== 'boolean') {
        this.logger.warn(`[Chat] Invalid typing indicator data from customer ${customerId}`);
        return;
      }

      // Verify customer is part of this ride
      const ride = await Ride.findById(rideId).select('passenger driver');
      if (!ride || ride.passenger.toString() !== customerId) {
        this.logger.warn(`[Chat] Unauthorized typing indicator from customer ${customerId} for ride ${rideId}`);
        return;
      }

      // Update typing indicator
      await this.chatService.updateTypingIndicator({
        rideId,
        userId: customerId,
        userType: 'customer',
        isTyping
      });

      // Notify driver if online
      if (ride.driver) {
        const driverSocketId = this.onlineCaptains[ride.driver.toString()];
        if (driverSocketId) {
          this.io.to(driverSocketId).emit('typingIndicator', {
            rideId: rideId,
            senderType: 'customer',
            isTyping: isTyping
          });
        }
      }

      this.logger.debug(`[Chat] Customer ${customerId} ${isTyping ? 'started' : 'stopped'} typing for ride ${rideId}`);

    } catch (error) {
      this.logger.error(`[Chat] Error handling typing indicator for customer ${customerId}:`, error);
    }
  }

  // ===============================
  // End Chat System Methods
  // ===============================

  // ===============================
  // State Management Methods
  // ===============================

  /**
   * Handle save ride state request
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - State data to save
   */
  async handleSaveRideState(socket, customerId, data) {
    try {
      this.logger.info(`[StateManagement] Customer ${customerId} requesting to save ride state`);

      // Extract state information
      const stateData = {
        type: data.type || 'trip_planning_backup',
        state: data.state || {},
        sessionInfo: {
          socketId: socket.id,
          userAgent: socket.handshake.headers['user-agent'],
          ipAddress: socket.handshake.address,
          lastActivity: new Date()
        }
      };

      // Validate required fields based on type
      if (stateData.type === 'ride_state_backup') {
        if (!stateData.state.rideId) {
          throw new Error('Ride state backup requires rideId');
        }
      } else if (stateData.type === 'trip_planning_backup') {
        if (!stateData.state.origin || !stateData.state.destination) {
          throw new Error('Trip planning backup requires origin and destination');
        }
      }

      // Save state using state management service
      const result = await this.stateManagementService.saveUserState(customerId, stateData);

      // Emit result back to customer
      socket.emit("saveRideStateResult", result);

      this.logger.info(`[StateManagement] Save ride state result for customer ${customerId}: ${result.success ? 'success' : 'failed'}`);

    } catch (error) {
      this.logger.error(`[StateManagement] Error saving ride state for customer ${customerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle restore ride state request
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - Restore parameters
   */
  async handleRestoreRideState(socket, customerId, data) {
    try {
      this.logger.info(`[StateManagement] Customer ${customerId} requesting to restore ride state`);

      const type = data?.type || null; // Optional type filter

      // First check for active ride
      const activeRide = await this.stateManagementService.getActiveRide(customerId);
      
      if (activeRide) {
        this.logger.info(`[StateManagement] Found active ride ${activeRide._id} for customer ${customerId}`);
        
        // Emit active ride restoration
        socket.emit("restoreRideStateResult", {
          success: true,
          data: {
            type: 'active_ride',
            state: {
              rideId: activeRide._id,
              rideStatus: activeRide.status,
              origin: {
                latitude: activeRide.pickupLocation.coordinates[1],
                longitude: activeRide.pickupLocation.coordinates[0],
                locationName: activeRide.pickupLocation.locationName
              },
              destination: {
                latitude: activeRide.dropoffLocation.coordinates[1],
                longitude: activeRide.dropoffLocation.coordinates[0],
                locationName: activeRide.dropoffLocation.locationName
              },
              estimatedFare: {
                amount: activeRide.fare.amount,
                currency: activeRide.fare.currency
              },
              paymentMethod: activeRide.paymentMethod,
              distance: activeRide.distance,
              duration: activeRide.duration,
              ...(activeRide.driver && {
                captainInfo: {
                  id: activeRide.driver._id,
                  name: activeRide.driver.name,
                  phoneNumber: activeRide.driver.phoneNumber,
                  imageUrl: activeRide.driver.imageUrl,
                  vehicle: activeRide.driver.carDetails
                }
              })
            },
            timestamp: activeRide.createdAt,
            source: 'active_ride'
          }
        });
        return;
      }

      // If no active ride, check saved states
      const result = await this.stateManagementService.restoreUserState(customerId, type);
      
      // Emit result back to customer
      socket.emit("restoreRideStateResult", result);

      this.logger.info(`[StateManagement] Restore ride state result for customer ${customerId}: ${result.success ? 'success' : 'no saved state'}`);

    } catch (error) {
      this.logger.error(`[StateManagement] Error restoring ride state for customer ${customerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle clear saved state request
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - Clear parameters
   */
  async handleClearSavedState(socket, customerId, data) {
    try {
      this.logger.info(`[StateManagement] Customer ${customerId} requesting to clear saved state`);

      const type = data?.type || null; // Optional type filter

      // Clear saved state using state management service
      const result = await this.stateManagementService.clearUserSavedState(customerId, type);

      // Emit result back to customer
      socket.emit("clearSavedStateResult", result);

      this.logger.info(`[StateManagement] Clear saved state result for customer ${customerId}: cleared ${result.deletedCount || 0} state(s)`);

    } catch (error) {
      this.logger.error(`[StateManagement] Error clearing saved state for customer ${customerId}:`, error);
      throw error;
    }
  }

  /**
   * Handle validate promo code request
   * @param {Object} socket - Socket instance
   * @param {string} customerId - Customer ID
   * @param {Object} data - Promo code data
   * @param {Function} callback - Response callback
   */
  async handleValidatePromoCode(socket, customerId, data, callback) {
    try {
      this.logger.info(`[StateManagement] Customer ${customerId} validating promo code: ${data.promoCode}`);

      const promoData = {
        ...data,
        userId: customerId
      };

      // Validate promo code using state management service
      const result = await this.stateManagementService.validatePromoCode(promoData);

      // Send result via callback if provided, otherwise emit
      if (callback) {
        callback({
          success: result.isValid,
          ...(result.isValid ? {
            discount: result.discount,
            newFare: result.newFare,
            message: result.message
          } : {
            message: result.reason
          })
        });
      } else {
        socket.emit("promoCodeValidationResult", {
          success: result.isValid,
          ...(result.isValid ? {
            discount: result.discount,
            newFare: result.newFare,
            message: result.message
          } : {
            message: result.reason
          })
        });
      }

      this.logger.info(`[StateManagement] Promo code validation for customer ${customerId}: ${result.isValid ? 'valid' : 'invalid'}`);

    } catch (error) {
      this.logger.error(`[StateManagement] Error validating promo code for customer ${customerId}:`, error);
      throw error;
    }
  }

  // ===============================
  // End State Management Methods
  // ===============================
}

module.exports = CustomerSocketService;