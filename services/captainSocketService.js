const jwt = require("jsonwebtoken");
const Ride = require("../model/ride");
const Captain = require("../model/Driver");
const RideSetting = require("../model/rideSetting");
const ChatService = require("./chatService"); // Chat service for messaging
const StateManagementService = require("./stateManagementService"); // State management service

/**
 * Enterprise-Grade Captain Socket Service with Seamless Queue Management
 * Handles all captain socket communications with transparent queue system
 * Client applications remain unaware of queue complexity
 * 
 * @class CaptainSocketService
 * @version 2.0.0
 * @author Senior Backend Team
 */
class CaptainSocketService {
  constructor(io, logger, dependencies) {
    this.io = io;
    this.logger = logger;
    
    // Core dependencies
    this.onlineCustomers = dependencies.onlineCustomers;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    this.rideSharingMap = dependencies.rideSharingMap;
    this.redisClient = dependencies.redisClient;
    this.calculateDistance = dependencies.calculateDistance;
    this.dispatchRide = dependencies.dispatchRide;
    this.customerSocketService = dependencies.customerSocketService;
    this.paymentService = dependencies.paymentService; // Add payment service
    this.stateManagementService = dependencies.stateManagementService; // Add state management service

    // Advanced queue integration
    this.dispatchService = dependencies.dispatchService || null;

    // Service state
    this.captainNamespace = null;
    this.rideSettings = null;
    
    // Initialize chat service
    this.chatService = new ChatService(logger, dependencies.redisClient);
    
    // Initialize financial account service
    const FinancialAccountService = require('./financialAccountService');
    this.financialAccountService = new FinancialAccountService(logger);
    
    // 📊 ADVANCED ANALYTICS
    this.connectionMetrics = {
      totalConnections: 0,
      activeConnections: 0,
      connectionErrors: 0,
      authenticatedConnections: 0,
      rejectedConnections: 0,
      lastConnectionTime: null
    };
    
    // 🎯 CAPTAIN RESPONSE ANALYTICS (Transparent to client)
    this.responseAnalytics = {
      acceptanceRate: 0,
      averageResponseTime: 0,
      totalNotifications: 0,
      totalAcceptances: 0,
      totalRejections: 0,
      timeoutCount: 0
    };
    
    // 🔄 CAPTAIN SESSION TRACKING
    this.captainSessions = new Map(); // captainId -> sessionData
    
    // 🛡️ SECURITY AND RATE LIMITING
    this.rateLimiting = new Map(); // socketId -> { requests: [], lastReset: timestamp }
    this.suspiciousActivity = new Map(); // captainId -> { violations: [], score: number }
    
    // 🚀 PERFORMANCE OPTIMIZATION
    this.performanceMetrics = {
      messagesSentToday: 0,
      messagesReceivedToday: 0,
      averageProcessingTime: 0,
      lastResetDate: new Date().toDateString(),
      peakConcurrentConnections: 0
    };
    
    // 🔧 ERROR HANDLING AND RECOVERY
    this.errorRecovery = {
      consecutiveErrors: 0,
      lastErrorTime: null,
      maxRetryAttempts: 3,
      circuitBreakerOpen: false
    };
    
    // 🔄 INTERVAL MANAGEMENT (for cleanup)
    this.intervals = {
      performanceMonitoring: null,
      healthMonitoring: null
    };
    
    // Start monitoring
    this.startPerformanceMonitoring();
    
    // Process pending transfers periodically (every 5 minutes)
    this.processPendingTransfersInterval = setInterval(async () => {
      await this.processPendingTransfersForAllCaptains();
    }, 5 * 60 * 1000);
    
    this.logger.info('[CaptainSocketService] Advanced captain service initialized with queue integration');
  }

  // ===========================================================================================
  // 🚀 CORE INITIALIZATION AND CONNECTION MANAGEMENT
  // ===========================================================================================

  /**
   * Initialize the captain socket service with advanced features
   */
  async initialize() {
    try {
      // Validate dependencies
      this.validateDependencies();
      
      await this.loadRideSettings();
      this.setupCaptainNamespace();
      this.startHealthMonitoring();
      this.logger.info('[CaptainSocketService] Service initialized successfully with enterprise features');
    } catch (error) {
      this.logger.error('[CaptainSocketService] Failed to initialize:', error);
      throw new Error(`CaptainSocketService initialization failed: ${error.message}`);
    }
  }

  /**
   * Validate that all required dependencies are properly injected
   */
  validateDependencies() {
    const requiredDependencies = [
      'onlineCustomers',
      'onlineCaptains', 
      'dispatchProcesses',
      'rideSharingMap',
      'calculateDistance'
    ];
    
    const missingDependencies = requiredDependencies.filter(dep => !this[dep]);
    
    if (missingDependencies.length > 0) {
      throw new Error(`Missing required dependencies: ${missingDependencies.join(', ')}`);
    }
    
    // Warn about optional dependencies
    const optionalDependencies = ['redisClient', 'dispatchService', 'customerSocketService'];
    const missingOptional = optionalDependencies.filter(dep => !this[dep]);
    
    if (missingOptional.length > 0) {
      this.logger.warn(`[CaptainSocketService] Missing optional dependencies: ${missingOptional.join(', ')}. Some features may be limited.`);
    }
    
    this.logger.info('[CaptainSocketService] Dependencies validated successfully');
  }

  /**
   * Setup captain namespace with advanced connection handling
   */
  setupCaptainNamespace() {
    this.captainNamespace = this.io.of("/captain");
    
    this.captainNamespace.on("connection", (socket) => {
      this.handleConnection(socket);
    });

    this.captainNamespace.on("connect_error", (error) => {
      this.logger.error('[CaptainSocketService] Namespace connection error:', error);
      this.connectionMetrics.connectionErrors++;
    });

    this.logger.info('[CaptainSocketService] Captain namespace configured with advanced handlers');
  }

  /**
   * Load and cache ride settings with validation
   */
  async loadRideSettings() {
    try {
      this.rideSettings = await RideSetting.findOne({ name: "default" });
      
      if (!this.rideSettings) {
        this.rideSettings = await this.createDefaultRideSettings();
        this.logger.info('[CaptainSocketService] Created default ride settings');
      }
      
      this.validateRideSettings();
      this.logger.info('[CaptainSocketService] Ride settings loaded and validated');
      
    } catch (err) {
      this.logger.error('[CaptainSocketService] Error loading ride settings:', err);
      this.rideSettings = this.getFallbackRideSettings();
      this.logger.warn('[CaptainSocketService] Using fallback ride settings');
    }
  }

  /**
   * Create default ride settings
   */
  async createDefaultRideSettings() {
    return new RideSetting({
      name: "default",
      dispatch: {
        initialRadiusKm: 2,
        maxRadiusKm: 10,
        radiusIncrementKm: 1,
        notificationTimeout: 15,
        maxDispatchTime: 300,
        graceAfterMaxRadius: 30,
        maxQueueLength: 10
      },
      captainRules: {
        maxTopUpLimit: 1000,
        minWalletBalance: 0,
        minRating: 3.5,
        maxActiveRides: 1,
        maxConcurrentNotifications: 1,
        responseTimeThreshold: 30
      },
      fare: {
        currency: "IQD",
        baseFare: 3000,
        pricePerKm: 500,
        minRidePrice: 2000,
        maxRidePrice: 7000
      }
    }).save();
  }

  /**
   * Get fallback settings when database is unavailable
   */
  getFallbackRideSettings() {
    return {
      dispatch: {
        initialRadiusKm: 2,
        maxRadiusKm: 10,
        radiusIncrementKm: 1,
        notificationTimeout: 15,
        maxDispatchTime: 300,
        graceAfterMaxRadius: 30,
        maxQueueLength: 10
      },
      captainRules: {
        maxTopUpLimit: 1000,
        minWalletBalance: 0,
        minRating: 3.5,
        maxActiveRides: 1,
        maxConcurrentNotifications: 1,
        responseTimeThreshold: 30
      },
      fare: {
        currency: "IQD",
        baseFare: 3000,
        pricePerKm: 500,
        minRidePrice: 2000,
        maxRidePrice: 7000
      },
      paymentMethods: ["cash", "card"],
      allowShared: false
    };
  }

  /**
   * Validate ride settings
   */
  validateRideSettings() {
    const settings = this.rideSettings;
    
    if (!settings.dispatch || !settings.captainRules || !settings.fare) {
      throw new Error('Invalid ride settings structure');
    }
    
    // Validate numeric values
    const dispatch = settings.dispatch;
    if (dispatch.notificationTimeout < 5 || dispatch.notificationTimeout > 60) {
      this.logger.warn('[CaptainSocketService] Notification timeout out of recommended range');
    }
    
    const rules = settings.captainRules;
    if (rules.minRating < 1 || rules.minRating > 5) {
      this.logger.warn('[CaptainSocketService] Minimum rating out of valid range');
    }
  }

  // ===========================================================================================
  // 🔐 CONNECTION HANDLING WITH ADVANCED SECURITY
  // ===========================================================================================

  /**
   * Handle new socket connection with comprehensive security
   */
  handleConnection(socket) {
    const connectionStartTime = Date.now();
    
    this.connectionMetrics.totalConnections++;
    this.connectionMetrics.activeConnections++;
    this.connectionMetrics.lastConnectionTime = new Date();
    
    // Update peak concurrent connections
    if (this.connectionMetrics.activeConnections > this.performanceMetrics.peakConcurrentConnections) {
      this.performanceMetrics.peakConcurrentConnections = this.connectionMetrics.activeConnections;
    }
    
    this.logger.info(`[Socket.IO Captain] 🔌 New connection attempt. Socket ID: ${socket.id}`);
    
    const token = socket.handshake.query.token;

    if (!token) {
      this.rejectConnection(socket, 'missing_token', 'No authentication token provided');
      return;
    }

    // Check rate limiting
    if (this.isRateLimited(socket)) {
      this.rejectConnection(socket, 'rate_limited', 'Too many connection attempts');
      return;
    }

    // Verify JWT token with enhanced error handling
    jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
      if (err) {
        this.rejectConnection(socket, 'invalid_token', `JWT verification failed: ${err.message}`);
      } else {
        await this.handleAuthenticated(socket, decoded, connectionStartTime);
      }
    });
  }

  /**
   * Reject connection with proper logging and metrics
   */
  rejectConnection(socket, reason, message) {
    this.connectionMetrics.rejectedConnections++;
    this.connectionMetrics.activeConnections--;
    
    this.logger.warn(`[Socket.IO Captain] ❌ Connection rejected: ${reason}. Socket ID: ${socket.id}. Message: ${message}`);
    
    socket.emit('connectionError', {
      reason: reason,
      message: message,
      timestamp: new Date()
    });
    
    socket.disconnect(true);
  }

  /**
   * Check if socket is rate limited
   */
  isRateLimited(socket) {
    const socketId = socket.id;
    const now = Date.now();
    const windowMs = 60000; // 1 minute window
    const maxRequests = 10; // Max 10 connection attempts per minute
    
    if (!this.rateLimiting.has(socketId)) {
      this.rateLimiting.set(socketId, {
        requests: [now],
        lastReset: now
      });
      return false;
    }
    
    const data = this.rateLimiting.get(socketId);
    
    // Reset if window expired
    if (now - data.lastReset > windowMs) {
      data.requests = [now];
      data.lastReset = now;
      return false;
    }
    
    // Add current request
    data.requests.push(now);
    
    // Filter requests within window
    data.requests = data.requests.filter(time => now - time <= windowMs);
    
    return data.requests.length > maxRequests;
  }

  /**
   * Handle authenticated connection with comprehensive setup
   */
  async handleAuthenticated(socket, decoded, connectionStartTime) {
    const captainId = decoded.id;

    try {
      // Validate captain eligibility
      const eligibilityResult = await this.validateCaptainEligibility(captainId);
      if (!eligibilityResult.eligible) {
        this.rejectConnection(socket, 'not_eligible', eligibilityResult.reason);
        return;
      }

      // Handle duplicate connections
      await this.handleDuplicateConnections(captainId, socket);

      // Setup captain session
      this.setupCaptainSession(captainId, socket, connectionStartTime);

      // Send initial data
      await this.sendInitialData(socket, captainId);

      // Restore captain state
      await this.restoreCaptainState(socket, captainId);

      // Setup event listeners
      this.setupEventListeners(socket, captainId);

      // Reset error recovery on successful authentication
      this.resetErrorRecovery();

      this.connectionMetrics.authenticatedConnections++;
      this.logger.info(`[Socket.IO Captain] ✅ Captain ${captainId} authenticated successfully. Socket ID: ${socket.id}`);

      // Log successful authentication for monitoring
      this.logSuccessfulAuthentication(captainId, socket.id);

    } catch (error) {
      this.logger.error(`[Socket.IO Captain] Error during authentication for captain ${captainId}:`, error);
      this.rejectConnection(socket, 'authentication_error', 'Internal authentication error');
    }
  }

  /**
   * Validate captain eligibility with comprehensive checks
   */
  async validateCaptainEligibility(captainId) {
    try {
      const captain = await Captain.findById(captainId)
        .select('rating walletBalance isActive isVerified lastActiveAt')
        .lean();
      
      if (!captain) {
        return { eligible: false, reason: "Captain not found in database" };
      }

      // if (!captain.isActive) {
      //   return { eligible: false, reason: "Captain account is deactivated" };
      // }

      // if (!captain.isVerified) {
      //   return { eligible: false, reason: "Captain account is not verified" };
      // }

      // Check minimum rating
      const minRating = this.rideSettings.captainRules.minRating;
      if (captain.rating < minRating) {
        return {
          eligible: false,
          reason: `Minimum rating required: ${minRating}. Current: ${captain.rating}`
        };
      }

      // Check minimum wallet balance
      const minBalance = this.rideSettings.captainRules.minWalletBalance;
      if (captain.walletBalance < minBalance) {
        return {
          eligible: false,
          reason: `Minimum wallet balance required: ${minBalance} ${this.rideSettings.fare.currency}`
        };
      }

      // Check for active rides
      const activeRides = await Ride.countDocuments({
        driver: captainId,
        status: { $in: ['accepted', 'arrived', 'onRide'] }
      });

      const maxActiveRides = this.rideSettings.captainRules.maxActiveRides;
      if (activeRides >= maxActiveRides) {
        return {
          eligible: false,
          reason: `Maximum active rides limit reached: ${maxActiveRides}`
        };
      }

      // Check if captain has been inactive for too long
      if (captain.lastActiveAt) {
        const inactiveDays = (Date.now() - new Date(captain.lastActiveAt).getTime()) / (1000 * 60 * 60 * 24);
        if (inactiveDays > 30) {
          this.logger.warn(`[CaptainSocketService] Captain ${captainId} has been inactive for ${Math.round(inactiveDays)} days`);
        }
      }

      return { eligible: true };
      
    } catch (err) {
      this.logger.error(`[CaptainSocketService] Error validating captain eligibility for ${captainId}:`, err);
      return { eligible: false, reason: "Eligibility validation error" };
    }
  }

  /**
   * Handle duplicate connections gracefully
   */
  async handleDuplicateConnections(captainId, newSocket) {
    const oldSocketId = this.onlineCaptains[captainId];

    if (oldSocketId && oldSocketId !== newSocket.id) {
      this.logger.warn(`[Socket.IO Captain] 🔄 Captain ${captainId} reconnecting. Disconnecting old socket ${oldSocketId}`);
      
      const oldSocket = this.captainNamespace.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.emit('connectionReplaced', {
          message: 'New connection established from another device',
          timestamp: new Date()
        });
        oldSocket.disconnect(true);
      }
      
      // Clean up old session
      this.cleanupCaptainSession(captainId);
    }

    this.onlineCaptains[captainId] = newSocket.id;
  }

  /**
   * Setup comprehensive captain session tracking
   */
  setupCaptainSession(captainId, socket, connectionStartTime) {
    const sessionData = {
      captainId: captainId,
      socketId: socket.id,
      connectedAt: new Date(connectionStartTime),
      lastActivity: new Date(),
      ipAddress: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
      connectionDuration: 0,
      messagesReceived: 0,
      messagesSent: 0,
      errors: 0,
      lastError: null,
      status: 'connected'
    };

    this.captainSessions.set(captainId, sessionData);
    this.logger.debug(`[Session] Created session for captain ${captainId}`);
  }

  /**
   * Send initial data to captain
   */
  async sendInitialData(socket, captainId) {
    try {
      // Send current settings
      socket.emit("rideSettings", {
        fare: this.rideSettings.fare,
        paymentMethods: this.rideSettings.paymentMethods || ["cash", "card"],
        allowShared: this.rideSettings.allowShared || false,
        dispatch: {
          notificationTimeout: this.rideSettings.dispatch.notificationTimeout,
          maxRadius: this.rideSettings.dispatch.maxRadiusKm
        }
      });

      // Send welcome message with session info
      socket.emit("connectionEstablished", {
        timestamp: new Date(),
        message: "Connection established successfully",
        sessionId: `${captainId}_${Date.now()}`
      });

      this.updateCaptainActivity(captainId, 'initial_data_sent');
      
    } catch (error) {
      this.logger.error(`[Socket.IO Captain] Error sending initial data to captain ${captainId}:`, error);
    }
  }

  // ===========================================================================================
  // 🔄 STATE RESTORATION WITH QUEUE AWARENESS
  // ===========================================================================================

  /**
   * Restore captain state with intelligent queue integration
   */
  async restoreCaptainState(socket, captainId) {
    try {
      this.logger.info(`[Socket.IO Captain] 🔄 Restoring state for captain ${captainId}`);

      // Check for ongoing rides first (highest priority)
      const ongoingRide = await this.findOngoingRide(captainId);
      if (ongoingRide) {
        await this.restoreOngoingRide(socket, captainId, ongoingRide);
        return; // Captain is busy with active ride
      }

      // Check if captain has pending ride in dispatch system
      if (this.dispatchService) {
        const pendingRide = this.dispatchService.getCaptainPendingRide(captainId);
        if (pendingRide) {
          await this.restorePendingRide(socket, captainId, pendingRide);
          return; // Captain has pending ride notification
        }
      }

      // Check for nearby pending rides and queue appropriately
      await this.checkForNearbyPendingRides(socket, captainId);
      
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error restoring state for captain ${captainId}:`, err);
    }
  }

  /**
   * Find ongoing ride for captain
   */
  async findOngoingRide(captainId) {
    return await Ride.findOne({
      driver: captainId,
      status: { $in: ['accepted', 'arrived', 'onRide'] },
    }).populate('passenger', 'name phoneNumber').lean();
  }

  /**
   * Restore ongoing ride state
   */
  async restoreOngoingRide(socket, captainId, ongoingRide) {
    this.logger.info(`[DB] 🚗 Found ongoing ride ${ongoingRide._id} (Status: ${ongoingRide.status}) for captain ${captainId}`);

    // Restore ride sharing map
    if (!this.rideSharingMap.has(captainId)) {
      this.rideSharingMap.set(captainId, ongoingRide.passenger._id);
      this.logger.info(`[State] Restored ride sharing for captain ${captainId} and customer ${ongoingRide.passenger._id}`);
    }

    // Send current ride details
    socket.emit("restoreRide", {
      rideId: ongoingRide._id,
      pickupLocation: ongoingRide.pickupLocation.coordinates,
      dropoffLocation: ongoingRide.dropoffLocation.coordinates,
      fare: ongoingRide.fare.amount,
      currency: this.rideSettings.fare.currency,
      distance: ongoingRide.distance,
      duration: ongoingRide.duration,
      status: ongoingRide.status,
      paymentMethod: ongoingRide.paymentMethod,
      pickupName: ongoingRide.pickupLocation.locationName,
      dropoffName: ongoingRide.dropoffLocation.locationName,
      passengerInfo: {
        id: ongoingRide.passenger._id,
        name: ongoingRide.passenger.name,
        phoneNumber: ongoingRide.passenger.phoneNumber
      }
    });

    this.updateCaptainActivity(captainId, 'ongoing_ride_restored');
  }

  /**
   * Restore pending ride from dispatch system
   */
  async restorePendingRide(socket, captainId, pendingRide) {
    try {
      this.logger.info(`[Queue] 🔄 Restoring pending ride ${pendingRide.rideId} for captain ${captainId}`);

      // Validate the pending ride still exists
      const ride = await Ride.findById(pendingRide.rideId).select('status').lean();
      if (!ride || ride.status !== 'requested') {
        this.logger.warn(`[Queue] Pending ride ${pendingRide.rideId} no longer valid, clearing and processing queue`);
        this.dispatchService.clearCaptainPendingRide(captainId);
        this.dispatchService.processNextRideInQueue(captainId);
        return;
      }

      // Calculate remaining time
      const elapsed = Date.now() - pendingRide.timestamp.getTime();
      const timeout = this.rideSettings.dispatch.notificationTimeout * 1000;
      const remaining = Math.max(0, timeout - elapsed);

      if (remaining > 0) {
        // Re-send the pending ride notification
        await this.resendPendingRideNotification(socket, pendingRide, remaining);
        this.updateCaptainActivity(captainId, 'pending_ride_restored');
      } else {
        // Pending ride has expired, process queue
        this.logger.info(`[Queue] Pending ride ${pendingRide.rideId} expired during reconnection, processing queue`);
        this.dispatchService.clearCaptainPendingRide(captainId);
        this.dispatchService.processNextRideInQueue(captainId);
      }
      
    } catch (error) {
      this.logger.error(`[Queue] Error restoring pending ride for captain ${captainId}:`, error);
      this.dispatchService?.clearCaptainPendingRide(captainId);
    }
  }

  /**
   * Re-send pending ride notification with adjusted timeout
   */
  async resendPendingRideNotification(socket, pendingRide, remainingTime) {
    try {
      // Get full ride details
      const ride = await Ride.findById(pendingRide.rideId)
        .populate('passenger', 'name phoneNumber')
        .lean();

      if (ride) {
        socket.emit("newRide", {
          rideId: ride._id,
          pickupLocation: ride.pickupLocation.coordinates,
          dropoffLocation: ride.dropoffLocation.coordinates,
          fare: ride.fare.amount,
          currency: this.rideSettings.fare.currency,
          distance: ride.distance,
          duration: ride.duration,
          paymentMethod: ride.paymentMethod,
          pickupName: ride.pickupLocation.locationName,
          dropoffName: ride.dropoffLocation.locationName,
          passengerInfo: {
            id: ride.passenger._id,
            name: ride.passenger.name,
            phoneNumber: ride.passenger.phoneNumber
          },
          // Client doesn't need to know this is a restored notification
          _metadata: {
            isRestored: true,
            remainingTime: Math.ceil(remainingTime / 1000),
            attemptCount: pendingRide.attemptCount || 1
          }
        });

        this.logger.info(`[Queue] Re-sent pending ride ${pendingRide.rideId} with ${Math.ceil(remainingTime / 1000)}s remaining`);
      }
    } catch (error) {
      this.logger.error(`[Queue] Error re-sending pending ride notification:`, error);
    }
  }

  /**
   * Check for nearby pending rides with intelligent queue management
   */
  async checkForNearbyPendingRides(socket, captainId) {
    try {
      const captainLocation = await this.getCaptainLocation(captainId);
      if (!captainLocation) {
        this.logger.warn(`[Redis] No location found for captain ${captainId}. Cannot check for pending rides.`);
        return;
      }

      const pendingRides = await this.findPendingRides();
      if (pendingRides.length === 0) {
        this.logger.debug(`[Socket.IO Captain] No pending rides found for captain ${captainId}`);
        return;
      }

      const notificationRadius = this.rideSettings.dispatch.initialRadiusKm;
      let processedRideCount = 0;

      for (const ride of pendingRides) {
        if (this.shouldProcessRideForCaptain(ride, captainLocation, notificationRadius)) {
          await this.processNearbyRide(captainId, ride);
          processedRideCount++;
        }
      }

      this.logger.info(`[Socket.IO Captain] Processed ${processedRideCount} nearby rides for captain ${captainId} within ${notificationRadius}km`);
      
    } catch (error) {
      this.logger.error(`[Socket.IO Captain] Error checking nearby rides for captain ${captainId}:`, error);
    }
  }

  /**
   * Get captain location from Redis
   */
  async getCaptainLocation(captainId) {
    try {
      if (!this.redisClient) {
        this.logger.warn(`[Redis] Redis client not available for captain ${captainId} location`);
        return null;
      }

      const location = await this.redisClient.geoPos("captains", captainId);
      if (location && location.length > 0 && location[0]) {
        const { longitude: lonStr, latitude: latStr } = location[0];
        const longitude = parseFloat(lonStr);
        const latitude = parseFloat(latStr);
        
        // Validate coordinates
        if (isNaN(longitude) || isNaN(latitude) || 
            longitude < -180 || longitude > 180 || 
            latitude < -90 || latitude > 90) {
          this.logger.warn(`[Redis] Invalid coordinates for captain ${captainId}: [${longitude}, ${latitude}]`);
          return null;
        }
        
        return { longitude, latitude };
      }
      return null;
    } catch (error) {
      this.logger.error(`[Redis] Error getting captain ${captainId} location:`, error);
      return null;
    }
  }

  /**
   * Find pending rides efficiently
   */
  async findPendingRides() {
    return await Ride.find({ 
      status: "requested",
      isDispatching: true // Only get rides currently being dispatched
    })
    .select('_id pickupLocation dropoffLocation fare distance duration paymentMethod createdAt')
    .sort({ createdAt: 1 }) // Oldest first for fairness
    .limit(50) // Limit for performance
    .lean();
  }

  /**
   * Check if ride should be processed for captain
   */
  shouldProcessRideForCaptain(ride, captainLocation, radius) {
    try {
      // Calculate distance with error handling
      const distance = this.calculateDistance(
        captainLocation,
        {
          latitude: ride.pickupLocation.coordinates[1],
          longitude: ride.pickupLocation.coordinates[0],
        }
      );

      // Validate distance calculation result
      if (typeof distance !== 'number' || isNaN(distance) || distance < 0) {
        this.logger.warn(`[Distance] Invalid distance calculation result: ${distance} for ride ${ride._id}`);
        return false;
      }

      if (distance > radius) return false;

      // Validate fare bounds
      if (!this.validateFareInBounds(ride.fare.amount)) return false;

      // Check ride age (don't process very old rides)
      const rideAge = (Date.now() - new Date(ride.createdAt).getTime()) / 1000;
      const maxAge = this.rideSettings.dispatch.maxDispatchTime || 300;
      if (rideAge > maxAge) return false;

      return true;
      
    } catch (error) {
      this.logger.error(`[Distance] Error processing ride ${ride._id} for captain:`, error);
      return false;
    }
  }

  /**
   * Process nearby ride with queue integration
   */
  async processNearbyRide(captainId, ride) {
    if (!this.dispatchService) {
      // Fallback to direct emission if DispatchService not available
      await this.sendDirectRideNotification(captainId, ride);
      return;
    }

    try {
      const rideData = this.prepareRideDataForQueue(ride);

      // Check if captain has pending ride
      if (this.dispatchService.hasPendingRide(captainId)) {
        // Add to queue (transparent to client)
        const queueResult = this.dispatchService.addRideToQueue(captainId, rideData);
        this.logger.info(`[Queue] Captain ${captainId} has pending ride. Queued nearby ride ${ride._id} at position ${queueResult.queuePosition}`);
      } else {
        // Send immediately
        const sent = this.dispatchService.sendRideNotificationToCaptain(captainId, rideData);
        if (sent) {
          this.logger.info(`[Queue] Sent nearby ride ${ride._id} immediately to captain ${captainId}`);
        }
      }
    } catch (error) {
      this.logger.error(`[Queue] Error processing nearby ride ${ride._id} for captain ${captainId}:`, error);
    }
  }

  /**
   * Prepare ride data for queue system
   */
  prepareRideDataForQueue(ride) {
    return {
      rideId: ride._id,
      pickupLocation: ride.pickupLocation.coordinates,
      dropoffLocation: ride.dropoffLocation.coordinates,
      fare: ride.fare.amount,
      currency: this.rideSettings.fare.currency,
      distance: ride.distance,
      duration: ride.duration,
      paymentMethod: ride.paymentMethod,
      pickupName: ride.pickupLocation.locationName,
      dropoffName: ride.dropoffLocation.locationName
    };
  }

  /**
   * Send direct ride notification (fallback)
   */
  async sendDirectRideNotification(captainId, ride) {
    try {
      const socket = this.getSocketForCaptain(captainId);
      if (!socket) return;

      socket.emit("newRide", {
        rideId: ride._id,
        pickupLocation: ride.pickupLocation.coordinates,
        dropoffLocation: ride.dropoffLocation.coordinates,
        fare: ride.fare.amount,
        currency: this.rideSettings.fare.currency,
        distance: ride.distance,
        duration: ride.duration,
        paymentMethod: ride.paymentMethod,
        pickupName: ride.pickupLocation.locationName,
        dropoffName: ride.dropoffLocation.locationName
      });

      this.updateCaptainActivity(captainId, 'direct_ride_notification');
      
    } catch (error) {
      this.logger.error(`[Socket.IO Captain] Error sending direct notification to captain ${captainId}:`, error);
    }
  }

  /**
   * Validate fare is within acceptable bounds
   */
  validateFareInBounds(fareAmount) {
    return fareAmount >= this.rideSettings.fare.minRidePrice &&
           fareAmount <= this.rideSettings.fare.maxRidePrice;
  }

  // ===========================================================================================
  // 🎧 EVENT LISTENERS WITH ADVANCED QUEUE INTEGRATION
  // ===========================================================================================

  /**
   * Setup comprehensive event listeners
   */
  setupEventListeners(socket, captainId) {
    // Core location updates
    socket.on("updateLocation", async (data) => {
      await this.handleLocationUpdate(socket, captainId, data);
    });

    // Ride lifecycle events with queue integration
    socket.on("acceptRide", async (data) => {
      await this.handleRideAcceptance(socket, captainId, data);
    });

    socket.on("rejectRide", async (data) => {
      await this.handleRideRejection(socket, captainId, data);
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

    // ===============================
    // Payment System Events - Captain
    // ===============================

    // Submit payment amount received from customer
    socket.on("submitPayment", async (data) => {
      await this.handlePaymentSubmission(socket, captainId, data);
    });

    // ===============================
    // Chat System Events - Captain
    // ===============================

    // Send chat message
    socket.on("sendChatMessage", async (data, callback) => {
      try {
        await this.handleSendChatMessage(socket, captainId, data, callback);
      } catch (error) {
        this.logger.error(`[Socket.IO Captain] Error handling send chat message for captain ${captainId}:`, error);
        if (callback) callback({ success: false, message: "Failed to send message" });
      }
    });

    // Get chat history
    socket.on("getChatHistory", async (data, callback) => {
      try {
        await this.handleGetChatHistory(socket, captainId, data, callback);
      } catch (error) {
        this.logger.error(`[Socket.IO Captain] Error getting chat history for captain ${captainId}:`, error);
        if (callback) callback({ success: false, message: "Failed to get chat history" });
      }
    });

    // Mark messages as read
    socket.on("markMessagesAsRead", async (data) => {
      try {
        await this.handleMarkMessagesAsRead(socket, captainId, data);
      } catch (error) {
        this.logger.error(`[Socket.IO Captain] Error marking messages as read for captain ${captainId}:`, error);
      }
    });

    // Typing indicator
    socket.on("typingIndicator", async (data) => {
      try {
        await this.handleTypingIndicator(socket, captainId, data);
      } catch (error) {
        this.logger.error(`[Socket.IO Captain] Error handling typing indicator for captain ${captainId}:`, error);
      }
    });

    // Get quick messages
    socket.on("getQuickMessages", (callback) => {
      try {
        const quickMessages = this.chatService.getQuickMessages('driver');
        if (callback) callback({ success: true, messages: quickMessages });
      } catch (error) {
        this.logger.error(`[Socket.IO Captain] Error getting quick messages for captain ${captainId}:`, error);
        if (callback) callback({ success: false, message: "Failed to get quick messages" });
      }
    });

    // ===============================
    // End Chat System Events
    // ===============================

    // System events
    socket.on("refreshSettings", async () => {
      await this.handleRefreshSettings(socket, captainId);
    });

    socket.on("ping", (data) => {
      this.handlePing(socket, captainId, data);
    });

    // Disconnect handling
    socket.on("disconnect", (reason) => {
      this.handleDisconnect(socket, captainId, reason);
    });

    // Error handling
    socket.on('error', (error) => {
      this.handleSocketError(socket, captainId, error);
    });

    this.logger.debug(`[Socket.IO Captain] Event listeners configured for captain ${captainId}`);
  }

  // ===========================================================================================
  // 🎯 RIDE LIFECYCLE HANDLERS WITH QUEUE TRANSPARENCY
  // ===========================================================================================

  /**
   * Handle ride rejection with seamless queue processing
   */
  async handleRideRejection(socket, captainId, data) {
    const startTime = Date.now();
    const rideId = typeof data === 'object' ? data.rideId : data;
    const rejectionReason = typeof data === 'object' ? data.reason : 'manual_rejection';
    
    if (!rideId) {
      this.sendError(socket, "Missing ride ID in rejection request");
      return;
    }

    this.logger.info(`[Socket.IO Captain] 🚫 Captain ${captainId} rejecting ride ${rideId}. Reason: ${rejectionReason}`);

    try {
      // Update metrics
      this.responseAnalytics.totalRejections++;
      this.updateResponseAnalytics(startTime);

      // Validate ride exists and captain was notified
      const validationResult = await this.validateRideRejection(rideId, captainId);
      if (!validationResult.isValid) {
        this.sendRejectionConfirmation(socket, rideId, validationResult.status, validationResult.message);
        return;
      }

      // Let DispatchService handle rejection and queue processing (transparent to client)
      let rejectionResult = null;
      if (this.dispatchService) {
        rejectionResult = this.dispatchService.handleCaptainRejection(rideId, captainId, rejectionReason);
        this.logger.info(`[Queue] DispatchService processed rejection and queue for captain ${captainId}`);
      }

      // Update captain session
      this.updateCaptainActivity(captainId, 'ride_rejected', { rideId, reason: rejectionReason });

      // Log rejection for analytics
      await this.logCaptainAction(captainId, rideId, 'rejected', { reason: rejectionReason });

      // Send simple confirmation to client (no queue details exposed)
      this.sendRejectionConfirmation(socket, rideId, 'received', 'Rejection processed successfully');

      this.logger.info(`[Socket.IO Captain] Captain ${captainId} rejection processed in ${Date.now() - startTime}ms`);

    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error handling rejection by captain ${captainId}:`, err);
      this.sendError(socket, "Failed to process rejection", rideId);
      this.recordError(captainId, err, 'ride_rejection');
    }
  }

  /**
   * Validate ride rejection request
   */
  async validateRideRejection(rideId, captainId) {
    try {
      const ride = await Ride.findById(rideId).select('status').lean();
      if (!ride) {
        return { isValid: false, status: 'ride_not_found', message: 'Ride not found' };
      }

      if (ride.status !== 'requested') {
        return { 
          isValid: false, 
          status: 'already_handled', 
          message: 'Ride is no longer available' 
        };
      }

      // Check if captain was actually notified
      const wasNotified = this.dispatchService ? 
        this.dispatchService.wasCaptainNotified(rideId, captainId) : true;

      if (!wasNotified) {
        return { 
          isValid: false, 
          status: 'not_notified', 
          message: 'You were not notified for this ride' 
        };
      }

      return { isValid: true };
    } catch (error) {
      this.logger.error(`[Socket.IO Captain] Error validating ride rejection:`, error);
      return { isValid: false, status: 'validation_error', message: 'Validation failed' };
    }
  }

  /**
   * Handle ride acceptance with comprehensive validation and queue clearing
   */
  async handleRideAcceptance(socket, captainId, data) {
    const startTime = Date.now();
    const rideId = typeof data === 'object' ? data.rideId : data;
    
    if (!rideId) {
      this.sendError(socket, "Missing ride ID in acceptance request");
      return;
    }

    this.logger.info(`[Socket.IO Captain] ✅ Captain ${captainId} accepting ride ${rideId}`);

    try {
      // Update metrics
      this.responseAnalytics.totalAcceptances++;
      this.updateResponseAnalytics(startTime);

      // Comprehensive validation
      const validationResult = await this.validateRideAcceptance(rideId, captainId);
      if (!validationResult.isValid) {
        this.sendError(socket, validationResult.message, rideId);
        return;
      }

      // Update ride in database
      const ride = await this.acceptRideInDatabase(rideId, captainId);
      if (!ride) {
        this.sendError(socket, "Ride already taken or cancelled", rideId);
        return;
      }

      // Let DispatchService handle acceptance and clear all queues (transparent)
      if (this.dispatchService) {
        await this.dispatchService.handleCaptainAcceptance(rideId, captainId);
        this.logger.info(`[Queue] DispatchService processed acceptance and cleared queues for captain ${captainId}`);
      }

      // Stop any active dispatch process
      this.cancelActiveDispatchProcess(rideId);

      // Setup ride sharing and notify customer
      await this.setupRideSharing(captainId, ride);

      // Send confirmation to captain
      await this.sendAcceptanceConfirmation(socket, ride);

      // Update captain session
      this.updateCaptainActivity(captainId, 'ride_accepted', { rideId });

      // Log acceptance
      await this.logCaptainAction(captainId, rideId, 'accepted');

      this.logger.info(`[Socket.IO Captain] Captain ${captainId} acceptance processed in ${Date.now() - startTime}ms`);

    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error handling acceptance by captain ${captainId}:`, err);
      this.sendError(socket, "Failed to accept ride", rideId);
      this.recordError(captainId, err, 'ride_acceptance');
    }
  }

  /**
   * Validate ride acceptance request
   */
  async validateRideAcceptance(rideId, captainId) {
    // Check captain eligibility
    const eligibilityCheck = await this.validateCaptainEligibility(captainId);
    if (!eligibilityCheck.eligible) {
      return { isValid: false, message: eligibilityCheck.reason };
    }

    // Check if this is captain's current pending ride (if using dispatch service)
    if (this.dispatchService) {
      const pendingRide = this.dispatchService.getCaptainPendingRide(captainId);
      if (pendingRide && pendingRide.rideId !== rideId) {
        return { 
          isValid: false, 
          message: "You can only accept your current pending ride" 
        };
      }

      // Check if captain was notified
      const wasNotified = this.dispatchService.wasCaptainNotified(rideId, captainId);
      if (!wasNotified) {
        return { 
          isValid: false, 
          message: "You were not notified for this ride" 
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Accept ride in database atomically with main vault deduction
   */
  async acceptRideInDatabase(rideId, captainId) {
    try {
      // First, get ride details to calculate deduction
      const ride = await Ride.findOne({ _id: rideId, status: "requested" }).lean();
      if (!ride) {
        this.logger.warn(`[acceptRideInDatabase] Ride ${rideId} not found or not in requested status`);
        return null;
      }

      // Process main vault deduction (20% of ride amount)
      if (this.paymentService && ride.totalFare) {
        try {
          const deductionResult = await this.paymentService.processRideDeduction(captainId, ride.totalFare);
          this.logger.info(`[acceptRideInDatabase] Main vault deduction processed: ${deductionResult.deductionAmount} IQD from captain ${captainId}`);
          
          // Notify captain about deduction
          const captainSocket = this.getCaptainSocket(captainId);
          if (captainSocket) {
            captainSocket.emit('vault_deduction', {
              type: 'ride_acceptance',
              deductionAmount: deductionResult.deductionAmount,
              remainingBalance: deductionResult.captainRemainingBalance,
              rideId: rideId,
              message: 'Main vault deduction (20%) applied for ride acceptance'
            });
          }

          // Update ride with deduction details before accepting
          await Ride.findOneAndUpdate(
            { _id: rideId, status: "requested" },
            {
              $set: {
                mainVaultDeductionAmount: deductionResult.deductionAmount
              }
            }
          );
          
        } catch (deductionError) {
          this.logger.error(`[acceptRideInDatabase] Main vault deduction failed for captain ${captainId}:`, deductionError);
          
          // If deduction fails, don't accept the ride
          throw new Error(`Cannot accept ride: ${deductionError.message}`);
        }
      }

      // Now accept the ride in database
      return await Ride.findOneAndUpdate(
        { _id: rideId, status: "requested" },
        {
          $set: {
            status: "accepted",
            driver: captainId,
            isDispatching: false,
            acceptedAt: new Date(),
            mainVaultDeducted: true,
            mainVaultDeductedAt: new Date()
          }
        },
        { new: true }
      ).populate('passenger', 'name phoneNumber').lean();
      
    } catch (error) {
      this.logger.error(`[acceptRideInDatabase] Error accepting ride ${rideId} for captain ${captainId}:`, error);
      throw error;
    }
  }

  /**
   * Cancel active dispatch process
   */
  cancelActiveDispatchProcess(rideId) {
    if (this.dispatchProcesses.has(rideId.toString())) {
      const cancelDispatch = this.dispatchProcesses.get(rideId.toString());
      cancelDispatch();
      this.dispatchProcesses.delete(rideId.toString());
      this.logger.info(`[Dispatch] Cancelled active dispatch process for ride ${rideId}`);
    }
  }

  /**
   * Setup ride sharing between captain and customer
   */
  async setupRideSharing(captainId, ride) {
    try {
      const customerId = ride.passenger._id;
      
      // Start location sharing
      this.rideSharingMap.set(captainId, customerId);
      this.logger.info(`[State] Started ride sharing for captain ${captainId} and customer ${customerId}`);

      // Get captain info and notify customer
      const captainInfo = await Captain.findById(captainId)
        .select('name carDetails phoneNumber rating profileImage')
        .lean();

      if (this.customerSocketService && captainInfo) {
        const sent = this.customerSocketService.emitToCustomer(customerId, "rideAccepted", {
          rideId: ride._id,
          driverId: captainId,
          driverInfo: {
            name: captainInfo.name,
            vehicle: captainInfo.carDetails,
            phoneNumber: captainInfo.phoneNumber,
            rating: captainInfo.rating,
            profileImage: captainInfo.profileImage
          },
          estimatedArrival: ride.estimatedArrival
        });

        if (!sent) {
          this.logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline for ride acceptance notification`);
        }
      }
    } catch (error) {
      this.logger.error(`[Socket.IO Captain] Error setting up ride sharing:`, error);
    }
  }

  /**
   * Send acceptance confirmation to captain
   */
  async sendAcceptanceConfirmation(socket, ride) {
    socket.emit('rideAcceptedConfirmation', {
      rideId: ride._id,
      status: ride.status,
      pickupLocation: ride.pickupLocation.coordinates,
      dropoffLocation: ride.dropoffLocation.coordinates,
      fare: ride.fare.amount,
      currency: this.rideSettings.fare.currency,
      paymentMethod: ride.paymentMethod,
      pickupName: ride.pickupLocation.locationName,
      dropoffName: ride.dropoffLocation.locationName,
      passengerInfo: {
        id: ride.passenger._id,
        name: ride.passenger.name,
        phoneNumber: ride.passenger.phoneNumber
      },
      message: "Ride accepted successfully"
    });
  }

  // ===========================================================================================
  // 🚀 RIDE LIFECYCLE CONTINUATION HANDLERS
  // ===========================================================================================

  /**
   * Handle captain cancellation with restart dispatch
   */
  async handleRideCancellation(socket, captainId, data) {
    const startTime = Date.now();
    const rideId = typeof data === 'object' ? data.rideId : data;
    
    if (!rideId) {
      this.sendError(socket, "Missing ride ID in cancellation request");
      return;
    }

    this.logger.info(`[Socket.IO Captain] 🚫 Captain ${captainId} cancelling ride ${rideId}`);

    try {
      const ride = await Ride.findOne({ _id: rideId, driver: captainId }).lean();

      if (!ride) {
        this.sendError(socket, "Cannot cancel ride. Ride not found or you are not assigned", rideId);
        return;
      }

      const cancellableStatuses = ['accepted', 'arrived'];
      if (!cancellableStatuses.includes(ride.status)) {
        this.sendError(socket, `Cannot cancel ride. Current status is '${ride.status}'`, rideId);
        return;
      }

      // Reset ride state for re-dispatch
      await this.resetRideForRedispatch(ride, captainId);

      // Clean up dispatch service tracking
      if (this.dispatchService) {
        await this.dispatchService.handleCaptainCancellation(rideId, captainId);
      }

      // Stop location sharing
      this.cleanupRideSharing(captainId);

      // Notify customer and restart dispatch
      await this.handleRideCancellationNotification(ride);

      // Send confirmation to captain
      socket.emit("rideCancelledConfirmation", { 
        rideId: ride._id, 
        message: "Ride successfully cancelled" 
      });

      // Update captain session and log
      this.updateCaptainActivity(captainId, 'ride_cancelled', { rideId });
      await this.logCaptainAction(captainId, rideId, 'cancelled');

      this.logger.info(`[Socket.IO Captain] Captain ${captainId} cancellation processed in ${Date.now() - startTime}ms`);

    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error handling cancellation by captain ${captainId}:`, err);
      this.sendError(socket, "Failed to cancel ride", rideId);
      this.recordError(captainId, err);
    }
  }

  /**
   * Reset ride for re-dispatch
   */
  async resetRideForRedispatch(ride, captainId) {
    await Ride.findByIdAndUpdate(ride._id, {
      $set: {
        status: "requested",
        driver: null,
        isDispatching: true,
        cancellationReason: `Cancelled by captain ${captainId} at status ${ride.status}`,
        cancelledAt: new Date()
      }
    });

    this.logger.info(`[DB] Reset ride ${ride._id} for re-dispatch after captain cancellation`);
  }

  /**
   * Handle ride cancellation notification and restart dispatch
   */
  async handleRideCancellationNotification(ride) {
    // Notify customer
    if (this.customerSocketService) {
      this.customerSocketService.emitToCustomer(ride.passenger, "rideCanceled", {
        rideId: ride._id,
        message: "The captain has canceled the ride. We are searching for another captain...",
        reason: "captain_canceled"
      });
    }

    // Restart dispatch process
    try {
      const originCoords = {
        latitude: ride.pickupLocation.coordinates[1],
        longitude: ride.pickupLocation.coordinates[0],
      };
      
      this.dispatchRide(ride, originCoords);
      this.logger.info(`[Dispatch] Restarted dispatch for cancelled ride ${ride._id}`);
    } catch (error) {
      this.logger.error(`[Dispatch] Error restarting dispatch for cancelled ride ${ride._id}:`, error);
    }
  }

  /**
   * Handle captain arrival
   */
  async handleCaptainArrived(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    
    if (!rideId) {
      this.sendError(socket, "Missing ride ID in arrival notification");
      return;
    }

    this.logger.info(`[Socket.IO Captain] 📍 Captain ${captainId} arrived for ride ${rideId}`);

    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: captainId, status: "accepted" },
        { $set: { status: "arrived", arrivedAt: new Date() } },
        { new: true }
      ).lean();

      if (ride) {
        // Notify customer
        if (this.customerSocketService) {
          this.customerSocketService.emitToCustomer(ride.passenger, "driverArrived", {
            rideId: ride._id,
            message: "Your captain has arrived at the pickup location",
          });
        }

        // Confirm to captain
        socket.emit("rideStatusUpdate", { rideId: ride._id, status: "arrived" });

        // Update session
        this.updateCaptainActivity(captainId, 'arrived_at_pickup', { rideId });
        await this.logCaptainAction(captainId, rideId, 'arrived');

      } else {
        const currentRide = await Ride.findById(rideId).select('status').lean();
        const errorMsg = currentRide ? 
          `Cannot mark as arrived. Current status is '${currentRide.status}'` : 
          "Ride not found or you are not assigned";
        this.sendError(socket, errorMsg, rideId);
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error handling arrival for captain ${captainId}:`, err);
      this.sendError(socket, "Failed to mark ride as arrived", rideId);
      this.recordError(captainId, err);
    }
  }

  /**
   * Handle ride start
   */
  async handleStartRide(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    
    if (!rideId) {
      this.sendError(socket, "Missing ride ID in start ride request");
      return;
    }

    this.logger.info(`[Socket.IO Captain] 🚀 Captain ${captainId} starting ride ${rideId}`);

    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: captainId, status: "arrived" },
        { $set: { status: "onRide", rideStartTime: new Date() } },
        { new: true }
      ).lean();

      if (ride) {
        // Notify customer
        if (this.customerSocketService) {
          this.customerSocketService.emitToCustomer(ride.passenger, "rideStarted", {
            rideId: ride._id,
            message: "Your ride has started",
          });
        }

        // Confirm to captain
        socket.emit("rideStartedConfirmation", { rideId: ride._id, status: "onRide" });

        // Update session
        this.updateCaptainActivity(captainId, 'ride_started', { rideId });
        await this.logCaptainAction(captainId, rideId, 'started');

      } else {
        const currentRide = await Ride.findById(rideId).select('status').lean();
        const errorMsg = currentRide ? 
          `Cannot start ride. Current status is '${currentRide.status}'` : 
          "Ride not found or you are not assigned";
        this.sendError(socket, errorMsg, rideId);
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error starting ride for captain ${captainId}:`, err);
      this.sendError(socket, "Failed to start ride", rideId);
      this.recordError(captainId, err);
    }
  }

  /**
   * Handle ride completion
   */
  async handleEndRide(socket, captainId, data) {
    const rideId = typeof data === 'object' ? data.rideId : data;
    
    if (!rideId) {
      this.sendError(socket, "Missing ride ID in end ride request");
      return;
    }

    this.logger.info(`[Socket.IO Captain] 🏁 Captain ${captainId} ending ride ${rideId}`);

    try {
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, driver: captainId, status: "onRide" },
        {
          $set: {
            status: "awaiting_payment", // تغيير الحالة لانتظار الدفع
            rideEndTime: new Date(),
            isDispatching: false
          }
        },
        { new: true }
      ).lean();

      if (ride) {
        // Calculate ride duration
        const actualDuration = ride.rideEndTime - ride.rideStartTime;
        
        // Clean up dispatch service tracking
        if (this.dispatchService) {
          this.dispatchService.cleanupRideNotifications(rideId);
        }

        // Clean up location sharing
        this.cleanupRideSharing(captainId);

        // إرسال طلب الدفع للكابتن بدلاً من إنهاء الرحلة مباشرة
        socket.emit("paymentRequired", {
          rideId: ride._id,
          status: "awaiting_payment",
          message: "الرحلة اكتملت. يرجى إدخال المبلغ المستلم من الزبون",
          expectedAmount: ride.fare.amount,
          currency: this.rideSettings.fare.currency,
          duration: Math.round(actualDuration / (1000 * 60)),
          passenger: {
            name: ride.passenger?.name || 'الزبون',
            phoneNumber: ride.passenger?.phoneNumber
          }
        });

        // Notify customer that ride ended but payment pending
        if (this.customerSocketService) {
          this.customerSocketService.emitToCustomer(ride.passenger, "rideAwaitingPayment", {
            rideId: ride._id,
            message: "الرحلة اكتملت وفي انتظار تأكيد الدفع من السائق",
            fare: ride.fare.amount,
            currency: this.rideSettings.fare.currency,
            duration: Math.round(actualDuration / (1000 * 60))
          });
        }

        // Update session
        this.updateCaptainActivity(captainId, 'ride_ended', { rideId, duration: actualDuration });
        await this.logCaptainAction(captainId, rideId, 'ride_ended_awaiting_payment');

      } else {
        const currentRide = await Ride.findById(rideId).select('status').lean();
        const errorMsg = currentRide ? 
          `Cannot end ride. Current status is '${currentRide.status}'` : 
          "Ride not found or you are not assigned";
        this.sendError(socket, errorMsg, rideId);
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error ending ride for captain ${captainId}:`, err);
      this.sendError(socket, "Failed to end ride", rideId);
      this.recordError(captainId, err);
    }
  }

  /**
   * Handle payment submission from captain
   */
  async handlePaymentSubmission(socket, captainId, data) {
    const { rideId, receivedAmount, notes } = data;
    
    if (!rideId || receivedAmount === undefined || receivedAmount === null) {
      this.sendError(socket, "معرف الرحلة والمبلغ المستلم مطلوبان", rideId);
      return;
    }

    this.logger.info(`[Socket.IO Captain] 💰 Captain ${captainId} submitting payment for ride ${rideId}: ${receivedAmount}`);

    try {
      // التحقق من الرحلة والحصول على تفاصيلها
      const ride = await Ride.findOne({
        _id: rideId, 
        driver: captainId, 
        status: "awaiting_payment"
      }).populate('passenger');

      if (!ride) {
        this.sendError(socket, "الرحلة غير موجودة أو ليست في حالة انتظار الدفع", rideId);
        return;
      }

      const expectedAmount = ride.fare.amount;
      const receivedAmountNum = parseFloat(receivedAmount);
      
      // التحقق من صحة المبلغ
      if (receivedAmountNum < 0) {
        this.sendError(socket, "المبلغ المستلم لا يمكن أن يكون أقل من صفر", rideId);
        return;
      }

      // تحديد حالة الدفع
      let paymentStatus = 'full';
      if (receivedAmountNum < expectedAmount) {
        paymentStatus = 'partial';
      }

      // معالجة الدفع من خلال PaymentService
      if (this.paymentService) {
        const paymentResult = await this.paymentService.processPayment({
          rideId,
          captainId,
          receivedAmount: receivedAmountNum,
          expectedAmount,
          currency: ride.fare.currency || 'IQD',
          paymentStatus,
          paymentMethod: 'cash',
          reason: paymentStatus === 'partial' ? `مبلغ ناقص: ${expectedAmount - receivedAmountNum}` : null,
          timestamp: new Date(),
          notes
        });

        if (paymentResult) {
          // معالجة المبلغ الإضافي - تحويل من محفظة الكابتن للزبون
          let extraAmountStatus = 'transferred';
          if (receivedAmountNum > expectedAmount) {
            const extraAmount = receivedAmountNum - expectedAmount;
            const transferResult = await this.processExtraAmount(captainId, ride.passenger._id, extraAmount);
            if (transferResult === 'pending') {
              extraAmountStatus = 'pending';
            } else if (!transferResult) {
              extraAmountStatus = 'failed';
            }
          }

          // تحديث حالة الرحلة لتكون مكتملة
          await Ride.findByIdAndUpdate(rideId, {
            status: "completed",
            paymentStatus: paymentStatus,
            'paymentDetails.receivedAmount': receivedAmountNum,
            'paymentDetails.expectedAmount': expectedAmount,
            'paymentDetails.paymentTimestamp': new Date(),
            'paymentDetails.paymentId': paymentResult.payment._id
          });

          // إشعار الكابتن بنجاح الدفع
          socket.emit("paymentProcessed", {
            rideId,
            status: "completed",
            message: "تم تسجيل الدفع بنجاح وإكمال الرحلة",
            paymentId: paymentResult.payment._id,
            receivedAmount: receivedAmountNum,
            expectedAmount,
            captainEarnings: paymentResult.earnings.captainEarnings,
            commission: paymentResult.earnings.companyCommission,
            extraAmountTransferred: receivedAmountNum > expectedAmount ? receivedAmountNum - expectedAmount : 0,
            extraAmountStatus: extraAmountStatus
          });

          // تحديد رسالة المبلغ الإضافي
          let extraAmountMessage = '';
          if (receivedAmountNum > expectedAmount) {
            const extraAmount = receivedAmountNum - expectedAmount;
            switch (extraAmountStatus) {
              case 'transferred':
                extraAmountMessage = ` تم تحويل ${extraAmount} دينار إضافي لحسابك.`;
                break;
              case 'pending':
                extraAmountMessage = ` ${extraAmount} دينار إضافي في انتظار التحويل (رصيد السائق غير كافي).`;
                break;
              case 'failed':
                extraAmountMessage = ` فشل في تحويل ${extraAmount} دينار إضافي.`;
                break;
            }
          }

          // إشعار الزبون بإكمال الرحلة والدفع
          if (this.customerSocketService) {
            this.customerSocketService.emitToCustomer(ride.passenger._id, "rideCompleted", {
              rideId: ride._id,
              message: `تم إكمال الرحلة وتسجيل الدفع بنجاح. شكراً لاستخدام خدمتنا!${extraAmountMessage}`,
              fare: expectedAmount,
              receivedAmount: receivedAmountNum,
              currency: ride.fare.currency,
              refundAmount: receivedAmountNum > expectedAmount ? receivedAmountNum - expectedAmount : 0
            });
          }

          this.logger.info(`[Socket.IO Captain] ✅ Payment processed successfully for ride ${rideId}: ${receivedAmountNum}/${expectedAmount}`);
          
          // Update session and log
          this.updateCaptainActivity(captainId, 'payment_submitted', { 
            rideId, 
            amount: receivedAmountNum,
            earnings: paymentResult.earnings.captainEarnings 
          });
          await this.logCaptainAction(captainId, rideId, 'payment_completed');

        } else {
          this.sendError(socket, "فشل في معالجة الدفع", rideId);
        }
      } else {
        this.sendError(socket, "خدمة الدفع غير متوفرة", rideId);
      }

    } catch (err) {
      this.logger.error(`[Socket.IO Captain] Error processing payment for captain ${captainId}:`, err);
      this.sendError(socket, "خطأ في معالجة الدفع", rideId);
      this.recordError(captainId, err);
    }
  }

  /**
   * Process extra amount transfer from captain to customer using Financial Account Service
   */
  async processExtraAmount(captainId, customerId, extraAmount) {
    try {
      const Driver = require('../model/Driver');
      const Customer = require('../model/customer');

      // Get captain and customer with their financial accounts
      const captain = await Driver.findById(captainId).populate('financialAccount');
      const customer = await Customer.findById(customerId).populate('financialAccount');

      if (!captain || !customer || !captain.financialAccount || !customer.financialAccount) {
        this.logger.error('[Payment] Captain, customer, or their financial accounts not found');
        return false;
      }

      // Try to transfer using FinancialAccountService
      const transferResult = await this.financialAccountService.transferMoney({
        fromAccountId: captain.financialAccount._id,
        toAccountId: customer.financialAccount._id,
        amount: extraAmount,
        transferType: "dtc", // Driver to Customer
        fromRole: "Driver",
        toRole: "Customer",
        description: `مبلغ إضافي من رحلة: ${extraAmount} دينار`,
        checkBalance: true
      });

      if (transferResult.success) {
        // Update customer wallet balance field to sync with financial account
        await Customer.findByIdAndUpdate(customerId, {
          walletBalance: transferResult.toBalance
        });

        // Update captain balance field to sync with financial account
        await Driver.findByIdAndUpdate(captainId, {
          balance: transferResult.fromBalance
        });

        this.logger.info(`[Payment] Extra amount transferred successfully: ${extraAmount} from captain ${captainId} to customer ${customerId}`);
        return true;

      } else if (transferResult.reason === 'insufficient_funds') {
        // Create pending transfer
        const pendingResult = await this.financialAccountService.createPendingTransfer({
          fromAccountId: captain.financialAccount._id,
          toAccountId: customer.financialAccount._id,
          amount: extraAmount,
          transferType: "dtc",
          fromRole: "Driver", 
          toRole: "Customer",
          description: `مبلغ إضافي مؤجل من رحلة: ${extraAmount} دينار`
        });

        if (pendingResult.success) {
          this.logger.info(`[Payment] Pending extra amount transfer created: ${extraAmount} from captain ${captainId} to customer ${customerId}`);
          return 'pending';
        } else {
          this.logger.error('[Payment] Failed to create pending transfer:', pendingResult.error);
          return false;
        }
      } else {
        this.logger.error('[Payment] Transfer failed:', transferResult.error);
        return false;
      }

    } catch (error) {
      this.logger.error('[Payment] Error processing extra amount transfer:', error);
      return false;
    }
  }

  // ===========================================================================================
  // 🌍 LOCATION AND SYSTEM HANDLERS
  // ===========================================================================================

  /**
   * Handle location updates with enhanced validation
   */
  async handleLocationUpdate(socket, captainId, data) {
    // Validate location data
    if (!this.isValidLocationData(data)) {
      this.logger.warn(`[Socket.IO Captain] Invalid location data from captain ${captainId}`);
      return;
    }

    this.logger.debug(`[Socket.IO Captain] 📍 Location update from captain ${captainId}: (${data.longitude}, ${data.latitude})`);

    try {
      // Update location in Redis
      await this.redisClient.geoAdd("captains", {
        longitude: data.longitude,
        latitude: data.latitude,
        member: captainId,
      });

      // Share location with customer if on active ride
      await this.shareLocationWithCustomer(captainId, data);

      // Update captain activity
      this.updateCaptainActivity(captainId, 'location_updated');

    } catch (err) {
      this.logger.error(`[Redis] Error updating location for captain ${captainId}:`, err);
      socket.emit("locationError", { message: "Location update failed" });
      this.recordError(captainId, err);
    }
  }

  /**
   * Validate location data
   */
  isValidLocationData(data) {
    return data && 
           typeof data.latitude === 'number' && 
           typeof data.longitude === 'number' &&
           data.latitude >= -90 && data.latitude <= 90 &&
           data.longitude >= -180 && data.longitude <= 180;
  }

  /**
   * Share location with customer during active ride
   */
  async shareLocationWithCustomer(captainId, locationData) {
    if (this.rideSharingMap.has(captainId)) {
      const customerId = this.rideSharingMap.get(captainId);
      
      if (this.customerSocketService) {
        const sent = this.customerSocketService.emitToCustomer(customerId, "driverLocationUpdate", {
          latitude: locationData.latitude,
          longitude: locationData.longitude,
          timestamp: new Date()
        });

        if (sent) {
          this.logger.debug(`[Location Sharing] Shared location with customer ${customerId}`);
        } else {
          this.logger.warn(`[Location Sharing] Customer ${customerId} is offline`);
        }
      }
    }
  }

  /**
   * Handle settings refresh
   */
  async handleRefreshSettings(socket, captainId) {
    try {
      await this.loadRideSettings();
      
      socket.emit("rideSettings", {
        fare: this.rideSettings.fare,
        paymentMethods: this.rideSettings.paymentMethods || ["cash", "card"],
        allowShared: this.rideSettings.allowShared || false,
        dispatch: {
          notificationTimeout: this.rideSettings.dispatch.notificationTimeout,
          maxRadius: this.rideSettings.dispatch.maxRadiusKm
        }
      });

      this.updateCaptainActivity(captainId, 'settings_refreshed');
      this.logger.info(`[Socket.IO Captain] Settings refreshed for captain ${captainId}`);
      
    } catch (error) {
      this.logger.error(`[Socket.IO Captain] Error refreshing settings for captain ${captainId}:`, error);
      socket.emit("settingsError", { message: "Failed to refresh settings" });
    }
  }

  /**
   * Handle ping for connection health
   */
  handlePing(socket, captainId, data) {
    const timestamp = data?.timestamp || Date.now();
    const latency = Date.now() - timestamp;
    
    socket.emit("pong", { 
      timestamp: Date.now(),
      latency: latency,
      status: "connected"
    });

    this.updateCaptainActivity(captainId, 'ping_received', { latency });
  }

  /**
   * Handle socket errors with enhanced recovery
   */
  handleSocketError(socket, captainId, error) {
    this.logger.error(`[Socket.IO Captain] Socket error for captain ${captainId}:`, error);
    this.recordError(captainId, error);
    
    // Update error recovery metrics
    this.errorRecovery.consecutiveErrors++;
    this.errorRecovery.lastErrorTime = new Date();
    
    // Circuit breaker logic
    if (this.errorRecovery.consecutiveErrors > this.errorRecovery.maxRetryAttempts) {
      this.logger.warn(`[Socket.IO Captain] Circuit breaker activated for captain ${captainId} due to consecutive errors`);
      this.errorRecovery.circuitBreakerOpen = true;
      
      // Force disconnect to prevent cascade failures
      if (socket.connected) {
        socket.disconnect(true);
      }
      return;
    }
    
    // Emit error to client if socket is still connected
    if (socket.connected) {
      socket.emit("socketError", { 
        message: "Socket error occurred",
        timestamp: new Date(),
        retryIn: 5000 // Suggest retry in 5 seconds
      });
    }
  }

  // ===========================================================================================
  // 🔌 DISCONNECTION AND CLEANUP
  // ===========================================================================================

  /**
   * Handle captain disconnection with comprehensive cleanup
   */
  handleDisconnect(socket, captainId, reason) {
    const startTime = Date.now();
    
    this.logger.info(`[Socket.IO Captain] 👋 Captain ${captainId} disconnected. Socket ID: ${socket.id}. Reason: ${reason}`);

    // Update connection metrics
    this.connectionMetrics.activeConnections--;

    // Clean up captain queues and pending rides (transparent to client)
    this.cleanupCaptainQueues(captainId, reason);

    // Clean up online captains
    this.cleanupOnlineCaptains(socket.id);

    // Clean up ride sharing
    this.cleanupRideSharing(captainId);

    // Update session data
    this.updateCaptainSession(captainId, 'disconnected', { reason, duration: Date.now() - startTime });

    // Clean up session after delay (in case of quick reconnection)
    setTimeout(() => {
      this.cleanupCaptainSession(captainId);
    }, 30000); // 30 seconds grace period

    this.logger.debug(`[Socket.IO Captain] Cleanup completed for captain ${captainId} in ${Date.now() - startTime}ms`);
  }

  /**
   * Clean up captain queues on disconnection
   */
  cleanupCaptainQueues(captainId, reason) {
    if (this.dispatchService) {
      try {
        const queueStatus = this.dispatchService.getCaptainQueueStatus(captainId);
        if (queueStatus.hasPendingRide || queueStatus.queueLength > 0) {
          this.logger.info(`[Queue] Cleaning up ${queueStatus.queueLength} queued rides and pending ride for disconnected captain ${captainId}`);
          this.dispatchService.clearCaptainQueue(captainId, `disconnect_${reason}`);
          this.dispatchService.clearCaptainPendingRide(captainId);
        }
      } catch (error) {
        this.logger.error(`[Queue] Error cleaning up queues for captain ${captainId}:`, error);
      }
    }
  }

  /**
   * Clean up online captains mapping
   */
  cleanupOnlineCaptains(socketId) {
    for (let id in this.onlineCaptains) {
      if (this.onlineCaptains[id] === socketId) {
        delete this.onlineCaptains[id];
        this.logger.debug(`[State] Removed captain ${id} from online captains`);
        break;
      }
    }
  }

  /**
   * Clean up ride sharing
   */
  cleanupRideSharing(captainId) {
    if (this.rideSharingMap.has(captainId)) {
      const customerId = this.rideSharingMap.get(captainId);
      this.rideSharingMap.delete(captainId);
      this.logger.info(`[State] Stopped ride sharing for captain ${captainId} and customer ${customerId}`);
    }
  }

  /**
   * Clean up captain session with proper timeout management
   */
  cleanupCaptainSession(captainId) {
    if (this.captainSessions.has(captainId)) {
      const session = this.captainSessions.get(captainId);
      session.status = 'disconnected';
      session.connectionDuration = Date.now() - session.connectedAt.getTime();
      
      // Clear any existing cleanup timeout
      if (session.cleanupTimeout) {
        clearTimeout(session.cleanupTimeout);
      }
      
      // Keep session for analytics for 1 hour
      session.cleanupTimeout = setTimeout(() => {
        this.captainSessions.delete(captainId);
        this.logger.debug(`[Session] Removed session data for captain ${captainId}`);
      }, 3600000);
    }
  }

  // ===========================================================================================
  // 📊 ANALYTICS AND MONITORING
  // ===========================================================================================

  /**
   * Update captain activity
   */
  updateCaptainActivity(captainId, action, metadata = {}) {
    try {
      const session = this.captainSessions.get(captainId);
      if (session) {
        session.lastActivity = new Date();
        session.messagesReceived++;
        
        // Log activity for analytics
        this.logger.debug(`[Activity] Captain ${captainId}: ${action}`, metadata);
      }
    } catch (error) {
      this.logger.error(`[Activity] Error updating activity for captain ${captainId}:`, error);
    }
  }

  /**
   * Update captain session
   */
  updateCaptainSession(captainId, status, metadata = {}) {
    try {
      const session = this.captainSessions.get(captainId);
      if (session) {
        session.status = status;
        session.lastActivity = new Date();
        Object.assign(session, metadata);
      }
    } catch (error) {
      this.logger.error(`[Session] Error updating session for captain ${captainId}:`, error);
    }
  }

  /**
   * Update response analytics
   */
  updateResponseAnalytics(startTime) {
    const responseTime = Date.now() - startTime;
    
    this.responseAnalytics.totalNotifications++;
    
    // Update average response time
    const totalResponses = this.responseAnalytics.totalAcceptances + this.responseAnalytics.totalRejections;
    if (totalResponses === 1) {
      this.responseAnalytics.averageResponseTime = responseTime;
    } else {
      this.responseAnalytics.averageResponseTime = 
        ((this.responseAnalytics.averageResponseTime * (totalResponses - 1)) + responseTime) / totalResponses;
    }
    
    // Update acceptance rate
    this.responseAnalytics.acceptanceRate = 
      (this.responseAnalytics.totalAcceptances / this.responseAnalytics.totalNotifications) * 100;
  }

  /**
   * Record error for captain with enhanced tracking and context
   */
  recordError(captainId, error, context = null) {
    try {
      const session = this.captainSessions.get(captainId);
      if (session) {
        session.errors++;
        session.lastError = {
          message: error.message,
          stack: error.stack,
          context: context,
          timestamp: new Date()
        };
      }
      
      this.errorRecovery.consecutiveErrors++;
      this.errorRecovery.lastErrorTime = new Date();
      
      // Enhanced logging with context
      const errorContext = context ? ` (Context: ${context})` : '';
      this.logger.error(`[Error Tracking] Captain ${captainId} error #${this.errorRecovery.consecutiveErrors}${errorContext}: ${error.message}`);
      
      // Warn if error rate is getting high
      if (this.errorRecovery.consecutiveErrors > 5) {
        this.logger.warn(`[Error Tracking] High error rate detected: ${this.errorRecovery.consecutiveErrors} consecutive errors. Circuit breaker may activate soon.`);
      }
      
    } catch (err) {
      this.logger.error(`[Error Recording] Failed to record error for captain ${captainId}:`, err);
    }
  }

  /**
   * Log successful authentication for monitoring
   */
  logSuccessfulAuthentication(captainId, socketId) {
    try {
      const session = this.captainSessions.get(captainId);
      if (session) {
        session.lastSuccessfulAuth = new Date();
        session.authCount = (session.authCount || 0) + 1;
      }
      
      // Log for monitoring and analytics
      this.logger.debug(`[Auth Success] Captain ${captainId} authenticated (Socket: ${socketId}) - Total auths: ${session?.authCount || 1}`);
    } catch (error) {
      this.logger.warn(`[Auth Success] Failed to log authentication for captain ${captainId}:`, error);
    }
  }

  /**
   * Reset error recovery state when operations are successful
   */
  resetErrorRecovery() {
    if (this.errorRecovery.consecutiveErrors > 0 || this.errorRecovery.circuitBreakerOpen) {
      const previousErrors = this.errorRecovery.consecutiveErrors;
      const wasCircuitOpen = this.errorRecovery.circuitBreakerOpen;
      
      this.errorRecovery.consecutiveErrors = 0;
      this.errorRecovery.lastErrorTime = null;
      this.errorRecovery.circuitBreakerOpen = false;
      
      this.logger.info(`[CaptainSocketService] ✅ Error recovery reset - System healthy (cleared ${previousErrors} errors, circuit breaker was ${wasCircuitOpen ? 'open' : 'closed'})`);
    }
  }

  /**
   * Get circuit breaker status for monitoring
   */
  getCircuitBreakerStatus() {
    const status = {
      consecutiveErrors: this.errorRecovery.consecutiveErrors,
      lastErrorTime: this.errorRecovery.lastErrorTime,
      circuitBreakerOpen: this.errorRecovery.circuitBreakerOpen,
      isHealthy: this.errorRecovery.consecutiveErrors < 10 && !this.errorRecovery.circuitBreakerOpen,
      activeSessions: this.captainSessions.size,
      timestamp: new Date()
    };
    
    return status;
  }

  /**
   * Log system health status for monitoring
   */
  logSystemHealth() {
    try {
      const status = this.getCircuitBreakerStatus();
      const healthStatus = status.isHealthy ? 'Healthy' : 'Degraded';
      this.logger.info(`[System Health] Captain Service: ${healthStatus} | Active Sessions: ${status.activeSessions} | Error Count: ${status.consecutiveErrors} | Circuit Breaker: ${status.circuitBreakerOpen ? 'Open' : 'Closed'}`);
    } catch (err) {
      this.logger.error('[System Health] Failed to log system health:', err);
    }
  }

  /**
   * Log captain action for analytics
   */
  async logCaptainAction(captainId, rideId, action, metadata = {}) {
    try {
      // This could be extended to write to analytics database
      this.logger.info(`[Analytics] Captain ${captainId} action: ${action} for ride ${rideId}`, metadata);
    } catch (error) {
      this.logger.error(`[Analytics] Error logging captain action:`, error);
    }
  }

  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    if (this.intervals.performanceMonitoring) {
      clearInterval(this.intervals.performanceMonitoring);
    }
    this.intervals.performanceMonitoring = setInterval(() => {
      this.updatePerformanceMetrics();
    }, 60000); // Every minute
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    const today = new Date().toDateString();
    
    // Reset daily counters if new day
    if (this.performanceMetrics.lastResetDate !== today) {
      this.performanceMetrics.messagesSentToday = 0;
      this.performanceMetrics.messagesReceivedToday = 0;
      this.performanceMetrics.lastResetDate = today;
    }
    
    // Update current metrics
    this.performanceMetrics.messagesReceivedToday += this.getTotalMessagesReceived();
  }

  /**
   * Get total messages received from all sessions
   */
  getTotalMessagesReceived() {
    let total = 0;
    this.captainSessions.forEach(session => {
      total += session.messagesReceived;
    });
    return total;
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    if (this.intervals.healthMonitoring) {
      clearInterval(this.intervals.healthMonitoring);
    }
    this.intervals.healthMonitoring = setInterval(() => {
      this.performHealthCheck();
    }, 300000); // Every 5 minutes
  }

  /**
   * Perform health check with enhanced monitoring
   */
  performHealthCheck() {
    try {
      const activeSessions = this.captainSessions.size;
      const onlineCaptains = Object.keys(this.onlineCaptains).length;
      const memoryUsage = process.memoryUsage();
      
      // Log detailed system health
      this.logSystemHealth();
      
      this.logger.info(`[Health Check] Active sessions: ${activeSessions}, Online captains: ${onlineCaptains}, Memory: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`);
      
      // Check for memory leaks
      if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
        this.logger.warn('[Health] High memory usage detected - potential memory leak');
      }
      
      // Check error rate and circuit breaker status
      const circuitStatus = this.getCircuitBreakerStatus();
      if (circuitStatus.consecutiveErrors > 10) {
        this.logger.warn(`[Health] High error rate detected: ${circuitStatus.consecutiveErrors} consecutive errors`);
      }
      
      if (circuitStatus.circuitBreakerOpen) {
        this.logger.error('[Health] Circuit breaker is open - service degraded');
      }
      
      // Check session health
      let healthySessions = 0;
      let unhealthySessions = 0;
      
      for (const [captainId, session] of this.captainSessions) {
        if (session.errors > 10) {
          unhealthySessions++;
        } else {
          healthySessions++;
        }
      }
      
      if (unhealthySessions > 0) {
        this.logger.warn(`[Health] ${unhealthySessions} captain sessions have high error counts`);
      }
      
    } catch (error) {
      this.logger.error('[Health] Error during health check:', error);
    }
  }

  // ===========================================================================================
  // 🛠️ UTILITY AND HELPER METHODS
  // ===========================================================================================

  /**
   * Get socket for captain
   */
  getSocketForCaptain(captainId) {
    const socketId = this.onlineCaptains[captainId];
    if (socketId) {
      return this.captainNamespace.sockets.get(socketId);
    }
    return null;
  }

  /**
   * Send error to captain
   */
  sendError(socket, message, rideId = null) {
    socket.emit("rideError", { 
      message: message, 
      rideId: rideId,
      timestamp: new Date()
    });
  }

  /**
   * Send rejection confirmation
   */
  sendRejectionConfirmation(socket, rideId, status, message) {
    socket.emit('rejectRideConfirmation', { 
      rideId: rideId, 
      status: status,
      message: message,
      timestamp: new Date()
    });
  }

  /**
   * Emit to specific captain
   */
  emitToCaptain(captainId, event, data) {
    const captainSocketId = this.onlineCaptains[captainId];
    if (captainSocketId) {
      try {
        this.captainNamespace.to(captainSocketId).emit(event, data);
        
        // Update session metrics
        const session = this.captainSessions.get(captainId);
        if (session) {
          session.messagesSent++;
        }
        
        this.performanceMetrics.messagesSentToday++;
        return true;
      } catch (error) {
        this.logger.error(`[Socket.IO Captain] Error emitting to captain ${captainId}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Emit to multiple captains
   */
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

  /**
   * Check if captain is online
   */
  isCaptainOnline(captainId) {
    return this.onlineCaptains.hasOwnProperty(captainId);
  }

  // ===========================================================================================
  // 📊 PUBLIC API AND STATISTICS
  // ===========================================================================================

  /**
   * Get comprehensive service statistics
   */
  getServiceStatistics() {
    return {
      connections: this.connectionMetrics,
      responses: this.responseAnalytics,
      performance: this.performanceMetrics,
      errorRecovery: this.errorRecovery,
      activeSessions: this.captainSessions.size,
      onlineCaptains: Object.keys(this.onlineCaptains).length,
      activeRideSharing: this.rideSharingMap.size,
      timestamp: new Date()
    };
  }

  /**
   * Get captain session details
   */
  getCaptainSessionDetails(captainId) {
    const session = this.captainSessions.get(captainId);
    if (!session) {
      return null;
    }

    return {
      captainId: session.captainId,
      socketId: session.socketId,
      connectedAt: session.connectedAt,
      lastActivity: session.lastActivity,
      connectionDuration: Date.now() - session.connectedAt.getTime(),
      messagesReceived: session.messagesReceived,
      messagesSent: session.messagesSent,
      errors: session.errors,
      lastError: session.lastError,
      status: session.status,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      isOnline: this.isCaptainOnline(captainId),
      hasActiveRide: this.rideSharingMap.has(captainId),
      queueStatus: this.dispatchService ? 
        this.dispatchService.getCaptainQueueStatus(captainId) : null
    };
  }

  /**
   * Get all active sessions
   */
  getAllActiveSessions() {
    const sessions = [];
    this.captainSessions.forEach((session, captainId) => {
      if (session.status === 'connected') {
        sessions.push(this.getCaptainSessionDetails(captainId));
      }
    });
    return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
  }

  /**
   * Get queue statistics (transparent to client)
   */
  getQueueStatistics() {
    if (!this.dispatchService) {
      return {
        error: "DispatchService not available",
        timestamp: new Date()
      };
    }

    const overallStats = this.dispatchService.getDispatchStats();
    return {
      queues: overallStats.queues,
      performance: {
        currentQueuedRides: overallStats.performance.currentQueuedRides,
        peakQueueLength: overallStats.performance.peakQueueLength,
        pendingRides: overallStats.performance.pendingRidesMemoryUsage
      },
      metrics: {
        totalQueuedRides: overallStats.metrics.totalQueuedRides,
        averageQueueWaitTimeSeconds: overallStats.metrics.averageQueueWaitTimeSeconds,
        maxQueueLength: overallStats.metrics.maxQueueLength
      },
      transparency: {
        note: "Queue system is transparent to clients",
        clientAwareness: "Clients receive seamless ride notifications"
      },
      timestamp: new Date()
    };
  }

  // ===========================================================================================
  // 🔧 SERVICE MANAGEMENT AND CONFIGURATION
  // ===========================================================================================

  /**
   * Set dispatch service reference for queue integration
   */
  setDispatchService(dispatchService) {
    this.dispatchService = dispatchService;
    this.logger.info('[CaptainSocketService] DispatchService reference injected for seamless queue integration');
  }

  /**
   * Set customer socket service reference
   */
  setCustomerSocketService(customerSocketService) {
    this.customerSocketService = customerSocketService;
    this.logger.info('[CaptainSocketService] CustomerSocketService reference injected');
  }

  /**
   * Get current settings
   */
  getCurrentSettings() {
    return this.rideSettings;
  }

  /**
   * Update settings (can be called externally)
   */
  async updateSettings(newSettings) {
    try {
      if (newSettings) {
        // Merge with current settings
        this.rideSettings = { ...this.rideSettings, ...newSettings };
        this.validateRideSettings();
        
        // Broadcast updated settings to all connected captains
        this.broadcastSettingsUpdate();
        
        this.logger.info('[CaptainSocketService] Settings updated and broadcast to all captains');
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error('[CaptainSocketService] Error updating settings:', error);
      return false;
    }
  }

  /**
   * Broadcast settings update to all connected captains
   */
  broadcastSettingsUpdate() {
    const settingsData = {
      fare: this.rideSettings.fare,
      paymentMethods: this.rideSettings.paymentMethods || ["cash", "card"],
      allowShared: this.rideSettings.allowShared || false,
      dispatch: {
        notificationTimeout: this.rideSettings.dispatch.notificationTimeout,
        maxRadius: this.rideSettings.dispatch.maxRadiusKm
      },
      updateTimestamp: new Date()
    };

    let broadcastCount = 0;
    Object.keys(this.onlineCaptains).forEach(captainId => {
      if (this.emitToCaptain(captainId, "settingsUpdated", settingsData)) {
        broadcastCount++;
      }
    });

    this.logger.info(`[CaptainSocketService] Settings broadcast to ${broadcastCount} online captains`);
  }

  /**
   * Get service health status
   */
  getHealthStatus() {
    const memoryUsage = process.memoryUsage();
    const uptime = process.uptime();
    
    return {
      status: this.errorRecovery.circuitBreakerOpen ? 'degraded' : 'healthy',
      uptime: uptime,
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      },
      connections: {
        total: this.connectionMetrics.totalConnections,
        active: this.connectionMetrics.activeConnections,
        authenticated: this.connectionMetrics.authenticatedConnections,
        rejected: this.connectionMetrics.rejectedConnections,
        peak: this.performanceMetrics.peakConcurrentConnections
      },
      errors: {
        consecutive: this.errorRecovery.consecutiveErrors,
        circuitBreakerOpen: this.errorRecovery.circuitBreakerOpen,
        lastErrorTime: this.errorRecovery.lastErrorTime
      },
      performance: {
        averageResponseTime: Math.round(this.responseAnalytics.averageResponseTime),
        acceptanceRate: Math.round(this.responseAnalytics.acceptanceRate * 100) / 100,
        messagesSentToday: this.performanceMetrics.messagesSentToday,
        messagesReceivedToday: this.performanceMetrics.messagesReceivedToday
      },
      queue: this.dispatchService ? {
        integrated: true,
        transparentToClients: true,
        status: 'operational'
      } : {
        integrated: false,
        status: 'not_available'
      },
      timestamp: new Date()
    };
  }

  // Removed duplicate resetErrorRecovery method - using the more intelligent version above

  /**
   * Reset performance metrics
   */
  resetPerformanceMetrics() {
    this.performanceMetrics.messagesSentToday = 0;
    this.performanceMetrics.messagesReceivedToday = 0;
    this.performanceMetrics.lastResetDate = new Date().toDateString();
    this.performanceMetrics.peakConcurrentConnections = this.connectionMetrics.activeConnections;
    
    this.responseAnalytics.totalNotifications = 0;
    this.responseAnalytics.totalAcceptances = 0;
    this.responseAnalytics.totalRejections = 0;
    this.responseAnalytics.timeoutCount = 0;
    this.responseAnalytics.averageResponseTime = 0;
    this.responseAnalytics.acceptanceRate = 0;
    
    this.logger.info('[CaptainSocketService] Performance metrics reset');
  }

  /**
   * Force disconnect captain
   */
  forceDisconnectCaptain(captainId, reason = 'admin_action') {
    try {
      const socket = this.getSocketForCaptain(captainId);
      if (socket) {
        socket.emit('forcedDisconnection', {
          reason: reason,
          message: 'You have been disconnected by administrator',
          timestamp: new Date()
        });
        
        socket.disconnect(true);
        
        this.logger.warn(`[CaptainSocketService] Forcefully disconnected captain ${captainId}. Reason: ${reason}`);
        return true;
      }
      return false;
    } catch (error) {
      this.logger.error(`[CaptainSocketService] Error force disconnecting captain ${captainId}:`, error);
      return false;
    }
  }

  /**
   * Broadcast system message to all captains
   */
  broadcastSystemMessage(message, type = 'info', targetCaptains = null) {
    try {
      const messageData = {
        type: type,
        message: message,
        timestamp: new Date(),
        source: 'system'
      };

      let sentCount = 0;
      const targets = targetCaptains || Object.keys(this.onlineCaptains);
      
      targets.forEach(captainId => {
        if (this.emitToCaptain(captainId, 'systemMessage', messageData)) {
          sentCount++;
        }
      });

      this.logger.info(`[CaptainSocketService] System message broadcast to ${sentCount} captains: ${message}`);
      return sentCount;
    } catch (error) {
      this.logger.error('[CaptainSocketService] Error broadcasting system message:', error);
      return 0;
    }
  }

  /**
   * Get captain statistics for admin dashboard
   */
  getCaptainStatistics(captainId = null) {
    if (captainId) {
      // Individual captain stats
      const session = this.getCaptainSessionDetails(captainId);
      if (!session) {
        return null;
      }

      return {
        captain: session,
        timestamp: new Date()
      };
    } else {
      // Overall captain statistics
      const activeSessions = Array.from(this.captainSessions.values())
        .filter(session => session.status === 'connected');

      return {
        overview: {
          totalCaptains: this.captainSessions.size,
          onlineCaptains: this.connectionMetrics.activeConnections,
          totalConnections: this.connectionMetrics.totalConnections,
          rejectedConnections: this.connectionMetrics.rejectedConnections
        },
        activity: {
          totalMessagesReceived: this.getTotalMessagesReceived(),
          totalMessagesSent: this.performanceMetrics.messagesSentToday,
          averageResponseTime: this.responseAnalytics.averageResponseTime,
          acceptanceRate: this.responseAnalytics.acceptanceRate
        },
        performance: {
          peakConcurrentConnections: this.performanceMetrics.peakConcurrentConnections,
          currentMemoryUsage: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          errorRate: this.errorRecovery.consecutiveErrors
        },
        queue: this.getQueueStatistics(),
        activeSessions: activeSessions.slice(0, 10), // Top 10 most active
        timestamp: new Date()
      };
    }
  }

  // ===========================================================================================
  // 🛠️ MAINTENANCE AND CLEANUP OPERATIONS
  // ===========================================================================================

  /**
   * Perform maintenance cleanup
   */
  performMaintenance() {
    this.logger.info('[CaptainSocketService] Starting maintenance cleanup...');
    
    let cleanedSessions = 0;
    let cleanedRateLimit = 0;
    let cleanedSuspicious = 0;

    try {
      // Clean up old disconnected sessions
      const cutoffTime = Date.now() - (2 * 60 * 60 * 1000); // 2 hours ago
      
      this.captainSessions.forEach((session, captainId) => {
        if (session.status === 'disconnected' && 
            session.lastActivity.getTime() < cutoffTime) {
          this.captainSessions.delete(captainId);
          cleanedSessions++;
        }
      });

      // Clean up old rate limiting data
      const rateLimitCutoff = Date.now() - (60 * 60 * 1000); // 1 hour ago
      
      this.rateLimiting.forEach((data, socketId) => {
        if (data.lastReset < rateLimitCutoff) {
          this.rateLimiting.delete(socketId);
          cleanedRateLimit++;
        }
      });

      // Clean up old suspicious activity data
      this.suspiciousActivity.forEach((data, captainId) => {
        if (data.violations.length === 0 || 
            data.violations[data.violations.length - 1].timestamp < cutoffTime) {
          this.suspiciousActivity.delete(captainId);
          cleanedSuspicious++;
        }
      });

      this.logger.info(`[CaptainSocketService] Maintenance completed: ${cleanedSessions} sessions, ${cleanedRateLimit} rate limits, ${cleanedSuspicious} suspicious activity records cleaned`);
      
      return {
        success: true,
        cleaned: {
          sessions: cleanedSessions,
          rateLimits: cleanedRateLimit,
          suspiciousActivity: cleanedSuspicious
        },
        timestamp: new Date()
      };
      
    } catch (error) {
      this.logger.error('[CaptainSocketService] Error during maintenance:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Emergency shutdown with graceful cleanup
   */
  async emergencyShutdown() {
    this.logger.warn('[CaptainSocketService] 🚨 Emergency shutdown initiated...');
    
    try {
      // Notify all connected captains
      const shutdownMessage = {
        type: 'emergency',
        message: 'Service is shutting down. Please reconnect in a few minutes.',
        timestamp: new Date()
      };

      let notifiedCount = 0;
      Object.keys(this.onlineCaptains).forEach(captainId => {
        if (this.emitToCaptain(captainId, 'serviceShutdown', shutdownMessage)) {
          notifiedCount++;
        }
      });

      this.logger.info(`[Emergency Shutdown] Notified ${notifiedCount} captains`);

      // Give captains time to receive the message
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Force disconnect all captains
      Object.keys(this.onlineCaptains).forEach(captainId => {
        this.forceDisconnectCaptain(captainId, 'emergency_shutdown');
      });

      // Clear all data structures
      this.onlineCaptains = {};
      this.captainSessions.clear();
      this.rideSharingMap.clear();
      this.rateLimiting.clear();
      this.suspiciousActivity.clear();

      this.logger.info('[CaptainSocketService] ✅ Emergency shutdown completed');
      
      return {
        success: true,
        notifiedCaptains: notifiedCount,
        timestamp: new Date()
      };
      
    } catch (error) {
      this.logger.error('[CaptainSocketService] Error during emergency shutdown:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown() {
    this.logger.info('[CaptainSocketService] 🔄 Starting graceful shutdown...');
    
    try {
      // Stop accepting new connections
      if (this.captainNamespace) {
        this.captainNamespace.removeAllListeners('connection');
      }

      // Notify all captains about planned shutdown
      this.broadcastSystemMessage(
        'Service will restart in 30 seconds. Please save your work and reconnect after restart.',
        'warning'
      );

      // Wait 30 seconds for captains to complete current operations
      await new Promise(resolve => setTimeout(resolve, 30000));

      // Perform maintenance cleanup before shutdown
      this.performMaintenance();

      // Gracefully disconnect all captains
      let disconnectedCount = 0;
      Object.keys(this.onlineCaptains).forEach(captainId => {
        const socket = this.getSocketForCaptain(captainId);
        if (socket) {
          socket.emit('gracefulShutdown', {
            message: 'Service is restarting. Please reconnect in a moment.',
            timestamp: new Date()
          });
          socket.disconnect(false); // Graceful disconnect
          disconnectedCount++;
        }
      });

      this.logger.info(`[CaptainSocketService] ✅ Graceful shutdown completed. ${disconnectedCount} captains disconnected gracefully`);
      
      return {
        success: true,
        disconnectedCaptains: disconnectedCount,
        timestamp: new Date()
      };
      
    } catch (error) {
      this.logger.error('[CaptainSocketService] Error during graceful shutdown:', error);
      return await this.emergencyShutdown(); // Fallback to emergency shutdown
    }
  }

  // ===========================================================================================
  // 🎯 FINAL SERVICE SUMMARY AND VALIDATION
  // ===========================================================================================

  /**
   * Validate service integrity
   */
  validateServiceIntegrity() {
    const issues = [];
    const warnings = [];

    try {
      // Check critical dependencies
      if (!this.dispatchService) {
        warnings.push('DispatchService not integrated - queue system will not function');
      }

      if (!this.customerSocketService) {
        warnings.push('CustomerSocketService not integrated - customer notifications may fail');
      }

      // Check namespace
      if (!this.captainNamespace) {
        issues.push('Captain namespace not initialized');
      }

      // Check settings
      if (!this.rideSettings) {
        issues.push('Ride settings not loaded');
      }

      // Check memory usage
      const memUsage = process.memoryUsage();
      if (memUsage.heapUsed > 1024 * 1024 * 1024) { // 1GB
        warnings.push(`High memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
      }

      // Check session consistency
      const sessionCount = this.captainSessions.size;
      const onlineCount = Object.keys(this.onlineCaptains).length;
      if (Math.abs(sessionCount - onlineCount) > 5) {
        warnings.push(`Session count mismatch: ${sessionCount} sessions vs ${onlineCount} online`);
      }

      // Check error rate
      if (this.errorRecovery.consecutiveErrors > 20) {
        issues.push(`High error rate: ${this.errorRecovery.consecutiveErrors} consecutive errors`);
      }

      return {
        isHealthy: issues.length === 0,
        issues,
        warnings,
        summary: {
          activeSessions: sessionCount,
          onlineCaptains: onlineCount,
          memoryUsageMB: Math.round(memUsage.heapUsed / 1024 / 1024),
          dispatchIntegrated: !!this.dispatchService,
          customerServiceIntegrated: !!this.customerSocketService
        },
        timestamp: new Date()
      };

    } catch (error) {
      issues.push(`Validation error: ${error.message}`);
      return {
        isHealthy: false,
        issues,
        warnings,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get complete service summary for monitoring
   */
  getCompleteSummary() {
    return {
      service: {
        name: 'CaptainSocketService',
        version: '2.0.0',
        status: this.errorRecovery.circuitBreakerOpen ? 'degraded' : 'operational',
        uptime: process.uptime(),
        startTime: new Date(Date.now() - process.uptime() * 1000)
      },
      features: {
        queueIntegration: {
          enabled: !!this.dispatchService,
          transparentToClients: true,
          description: 'Seamless queue management without client complexity'
        },
        realTimeLocation: true,
        rideLifecycleManagement: true,
        advancedAnalytics: true,
        errorRecovery: true,
        rateLimiting: true,
        sessionTracking: true,
        performanceMonitoring: true
      },
      statistics: this.getServiceStatistics(),
      health: this.getHealthStatus(),
      integrity: this.validateServiceIntegrity(),
      timestamp: new Date()
    };
  }

  /**
   * Graceful shutdown of the service
   */
  async gracefulShutdown() {
    this.logger.info('[CaptainSocketService] 🔄 Starting graceful shutdown...');
    
    try {
      // Clear intervals
      if (this.intervals.performanceMonitoring) {
        clearInterval(this.intervals.performanceMonitoring);
        this.intervals.performanceMonitoring = null;
      }
      
      if (this.intervals.healthMonitoring) {
        clearInterval(this.intervals.healthMonitoring);
        this.intervals.healthMonitoring = null;
      }
      
      // Notify all connected captains
      if (this.captainNamespace) {
        this.captainNamespace.emit('serverShutdown', {
          message: 'Server is shutting down. Please reconnect in a moment.',
          timestamp: new Date()
        });
      }
      
      // Clean up sessions with timeouts
      for (const [captainId, session] of this.captainSessions.entries()) {
        if (session.cleanupTimeout) {
          clearTimeout(session.cleanupTimeout);
        }
        this.captainSessions.delete(captainId);
      }
      
      // Clear rate limiting map
      this.rateLimiting.clear();
      this.suspiciousActivity.clear();
      
      this.logger.info('[CaptainSocketService] ✅ Graceful shutdown completed');
      
    } catch (error) {
      this.logger.error('[CaptainSocketService] ❌ Error during graceful shutdown:', error);
    }
  }

  /**
   * Emergency shutdown for critical situations
   */
  emergencyShutdown() {
    this.logger.warn('[CaptainSocketService] 🚨 Emergency shutdown initiated...');
    
    try {
      // Force clear all intervals
      if (this.intervals.performanceMonitoring) clearInterval(this.intervals.performanceMonitoring);
      if (this.intervals.healthMonitoring) clearInterval(this.intervals.healthMonitoring);
      
      // Force disconnect all captains
      if (this.captainNamespace) {
        this.captainNamespace.disconnectSockets(true);
      }
      
      // Force clear all maps
      this.captainSessions.clear();
      this.rateLimiting.clear();
      this.suspiciousActivity.clear();
      
      this.logger.warn('[CaptainSocketService] ⚠️ Emergency shutdown completed');
      
    } catch (error) {
      this.logger.error('[CaptainSocketService] ❌ Error during emergency shutdown:', error);
    }
  }

  // ===============================
  // Chat System Handler Methods
  // ===============================

  /**
   * Handle sending chat message from captain
   * @param {Object} socket - Socket instance
   * @param {string} captainId - Captain ID
   * @param {Object} data - Message data
   * @param {Function} callback - Response callback
   */
  async handleSendChatMessage(socket, captainId, data, callback) {
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
        senderId: captainId,
        senderType: 'driver',
        text,
        tempId,
        isQuick,
        quickMessageType
      });

      // Get ride details to find customer
      const ride = await Ride.findById(rideId).select('passenger');
      
      // Notify customer if online
      if (ride && ride.passenger) {
        const customerSocketId = this.onlineCustomers[ride.passenger.toString()];
        if (customerSocketId) {
          this.io.to(customerSocketId).emit('chatMessage', {
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

          this.logger.debug(`[Chat] Message sent from captain ${captainId} to customer ${ride.passenger} for ride ${rideId}`);
        }
      }

      // Send response back to captain
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
      this.logger.error(`[Chat] Error sending message from captain ${captainId}:`, error);
      if (callback) {
        callback({
          success: false,
          message: error.message || "Failed to send message"
        });
      }
    }
  }

  /**
   * Handle getting chat history for captain
   * @param {Object} socket - Socket instance
   * @param {string} captainId - Captain ID
   * @param {Object} data - Request data
   * @param {Function} callback - Response callback
   */
  async handleGetChatHistory(socket, captainId, data, callback) {
    try {
      const { rideId, limit = 50, skip = 0 } = data;

      if (!rideId) {
        if (callback) callback({ 
          success: false, 
          message: "rideId is required" 
        });
        return;
      }

      // Verify captain is part of this ride
      const ride = await Ride.findById(rideId).select('driver');
      if (!ride || !ride.driver || ride.driver.toString() !== captainId) {
        if (callback) callback({ 
          success: false, 
          message: "Unauthorized access to chat history" 
        });
        return;
      }

      // Get chat history
      const messages = await this.chatService.getChatHistory(rideId, limit, skip);
      const unreadCount = await this.chatService.getUnreadCount(rideId, 'driver');

      if (callback) {
        callback({
          success: true,
          messages: messages,
          unreadCount: unreadCount
        });
      }

    } catch (error) {
      this.logger.error(`[Chat] Error getting chat history for captain ${captainId}:`, error);
      if (callback) {
        callback({
          success: false,
          message: error.message || "Failed to get chat history"
        });
      }
    }
  }

  /**
   * Handle marking messages as read by captain
   * @param {Object} socket - Socket instance
   * @param {string} captainId - Captain ID
   * @param {Object} data - Request data
   */
  async handleMarkMessagesAsRead(socket, captainId, data) {
    try {
      const { rideId, messageIds } = data;

      if (!rideId || !messageIds || !Array.isArray(messageIds)) {
        this.logger.warn(`[Chat] Invalid data for marking messages as read from captain ${captainId}`);
        return;
      }

      // Verify captain is part of this ride
      const ride = await Ride.findById(rideId).select('passenger driver');
      if (!ride || !ride.driver || ride.driver.toString() !== captainId) {
        this.logger.warn(`[Chat] Unauthorized attempt to mark messages as read by captain ${captainId} for ride ${rideId}`);
        return;
      }

      // Mark messages as read
      const result = await this.chatService.markMessagesAsRead(rideId, messageIds, 'driver');

      // Notify customer if online
      if (ride.passenger) {
        const customerSocketId = this.onlineCustomers[ride.passenger.toString()];
        if (customerSocketId) {
          this.io.to(customerSocketId).emit('messageRead', {
            rideId: rideId,
            messageIds: messageIds,
            readBy: 'driver',
            readAt: new Date()
          });
        }
      }

      this.logger.debug(`[Chat] Captain ${captainId} marked ${result.modifiedCount} messages as read for ride ${rideId}`);

    } catch (error) {
      this.logger.error(`[Chat] Error marking messages as read for captain ${captainId}:`, error);
    }
  }

  /**
   * Handle typing indicator from captain
   * @param {Object} socket - Socket instance
   * @param {string} captainId - Captain ID
   * @param {Object} data - Typing data
   */
  async handleTypingIndicator(socket, captainId, data) {
    try {
      const { rideId, isTyping } = data;

      if (!rideId || typeof isTyping !== 'boolean') {
        this.logger.warn(`[Chat] Invalid typing indicator data from captain ${captainId}`);
        return;
      }

      // Verify captain is part of this ride
      const ride = await Ride.findById(rideId).select('passenger driver');
      if (!ride || !ride.driver || ride.driver.toString() !== captainId) {
        this.logger.warn(`[Chat] Unauthorized typing indicator from captain ${captainId} for ride ${rideId}`);
        return;
      }

      // Update typing indicator
      await this.chatService.updateTypingIndicator({
        rideId,
        userId: captainId,
        userType: 'driver',
        isTyping
      });

      // Notify customer if online
      if (ride.passenger) {
        const customerSocketId = this.onlineCustomers[ride.passenger.toString()];
        if (customerSocketId) {
          this.io.to(customerSocketId).emit('typingIndicator', {
            rideId: rideId,
            senderType: 'driver',
            isTyping: isTyping
          });
        }
      }

      this.logger.debug(`[Chat] Captain ${captainId} ${isTyping ? 'started' : 'stopped'} typing for ride ${rideId}`);

    } catch (error) {
      this.logger.error(`[Chat] Error handling typing indicator for captain ${captainId}:`, error);
    }
  }

  // ===============================
  // End Chat System Methods
  // ===============================

  // ===========================================================================================
  // 💰 FINANCIAL ACCOUNT MANAGEMENT
  // ===========================================================================================

  /**
   * Process pending transfers for all captains
   * Called periodically to handle cases where captain balance becomes available
   */
  async processPendingTransfersForAllCaptains() {
    try {
      this.logger.info('[CaptainSocketService] Processing pending transfers for all captains...');
      
      if (!this.financialAccountService) {
        this.logger.warn('[CaptainSocketService] FinancialAccountService not available');
        return;
      }

      // Get all captains with pending transfers
      const result = await this.financialAccountService.processPendingTransfers();
      
      if (result.processedCount > 0) {
        this.logger.info(`[CaptainSocketService] Processed ${result.processedCount} pending transfers successfully`);
        
        // Notify affected captains about balance updates if they're online
        for (const transfer of result.processedTransfers) {
          const captainId = transfer.from;
          const captainSocket = this.getCaptainSocket(captainId);
          
          if (captainSocket) {
            captainSocket.emit('balance_updated', {
              type: 'pending_transfer_processed',
              transferId: transfer._id,
              amount: transfer.amount,
              description: transfer.description,
              timestamp: new Date()
            });
          }
        }
      }
    } catch (error) {
      this.logger.error('[CaptainSocketService] Error processing pending transfers:', error);
    }
  }

  /**
   * Get captain socket by ID
   */
  getCaptainSocket(captainId) {
    const socketId = this.onlineCaptains[captainId];
    if (socketId && this.captainNamespace) {
      return this.captainNamespace.sockets.get(socketId);
    }
    return null;
  }

  /**
   * Process pending transfers for a specific captain
   */
  async processPendingTransfersForCaptain(captainId) {
    try {
      if (!this.financialAccountService) {
        this.logger.warn('[CaptainSocketService] FinancialAccountService not available');
        return;
      }

      const result = await this.financialAccountService.processPendingTransfersForUser(captainId);
      
      if (result.processedCount > 0) {
        this.logger.info(`[CaptainSocketService] Processed ${result.processedCount} pending transfers for captain ${captainId}`);
        
        // Notify captain if online
        const captainSocket = this.getCaptainSocket(captainId);
        if (captainSocket) {
          captainSocket.emit('balance_updated', {
            type: 'pending_transfers_processed',
            count: result.processedCount,
            timestamp: new Date()
          });
        }
      }
    } catch (error) {
      this.logger.error(`[CaptainSocketService] Error processing pending transfers for captain ${captainId}:`, error);
    }
  }

  /**
   * Cleanup interval on service shutdown
   */
  cleanup() {
    if (this.processPendingTransfersInterval) {
      clearInterval(this.processPendingTransfersInterval);
      this.processPendingTransfersInterval = null;
    }
    
    // Cleanup other intervals
    Object.values(this.intervals).forEach(interval => {
      if (interval) clearInterval(interval);
    });
    
    this.logger.info('[CaptainSocketService] Cleanup completed');
  }
}

module.exports = CaptainSocketService;
