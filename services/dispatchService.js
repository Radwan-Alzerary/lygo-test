const customer = require("../model/customer");
const Ride = require("../model/ride");
const RideSetting = require("../model/rideSetting");
const { findNearbyCaptains } = require("../utils/helpers");

/**
 * Enterprise-Grade Dispatch Service with Advanced Queue Management
 * Handles ride dispatching with captain queue system to prevent multiple simultaneous ride requests
 * 
 * @class DispatchService
 * @version 2.0.0
 * @author Senior Backend Team
 */
class DispatchService {
  constructor(logger, dependencies) {
    this.logger = logger;
    
    // Validate dependencies
    if (!dependencies) {
      throw new Error('Dependencies object is required');
    }
    
    if (!logger || typeof logger.info !== 'function') {
      throw new Error('Valid logger instance is required');
    }
    
    this.redisClient = dependencies.redisClient;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    
    // Validate required dependencies
    if (!this.onlineCaptains || typeof this.onlineCaptains !== 'object') {
      throw new Error('onlineCaptains dependency is required and must be an object');
    }
    
    if (!this.dispatchProcesses || typeof this.dispatchProcesses !== 'object') {
      throw new Error('dispatchProcesses dependency is required and must be an object');
    }
    
    // Service dependencies - injected after creation for circular dependency resolution
    this.captainSocketService = dependencies.captainSocketService || null;
    this.customerSocketService = dependencies.customerSocketService || null;

    // Configuration and settings
    this.rideSettings = null;
    this.backgroundIntervalId = null;
    this.healthCheckIntervalId = null;
    
    // Core tracking maps for ride notifications
    this.rideNotifications = new Map(); // rideId -> Set<captainId>
    this.currentRadiusNotifications = new Map(); // rideId -> Set<captainId>
    
    // 🚀 ADVANCED QUEUE SYSTEM - Captain Queue Management
    this.captainPendingRides = new Map(); // captainId -> { rideId, timestamp, timeoutId, attemptCount }
    this.captainRideQueues = new Map(); // captainId -> Array<rideData>
    this.queueProcessingTimeouts = new Map(); // captainId -> timeoutId
    this.captainResponseHistory = new Map(); // captainId -> Array<{ rideId, action, timestamp }>
    
    // 📊 ADVANCED ANALYTICS AND METRICS
    this.dispatchMetrics = {
      totalDispatches: 0,
      successfulDispatches: 0,
      failedDispatches: 0,
      timeoutDispatches: 0,
      averageDispatchTime: 0,
      lastDispatchTime: null,
      totalQueuedRides: 0,
      averageQueueWaitTime: 0,
      maxQueueLength: 0,
      queueTimeouts: 0,
      captainResponseRate: 0
    };
    
    // 🔧 PERFORMANCE MONITORING
    this.performanceCounters = {
      activeDispatchPeakCount: 0,
      notificationsSentToday: 0,
      lastResetDate: new Date().toDateString(),
      currentQueuedRides: 0,
      peakQueueLength: 0,
      memoryUsage: {
        dispatchProcesses: 0,
        notifications: 0,
        queues: 0,
        pending: 0
      }
    };
    
    // 🛡️ ERROR HANDLING AND RECOVERY
    this.errorRecovery = {
      consecutiveFailures: 0,
      lastFailureTime: null,
      maxRetryAttempts: 3,
      retryDelay: 5000,
      circuitBreakerOpen: false
    };
    
    // 🔄 HEALTH MONITORING
    this.healthStatus = {
      isHealthy: true,
      lastHealthCheck: new Date(),
      issues: [],
      warnings: []
    };

    // Initialize performance monitoring
    this.startPerformanceMonitoring();
    
    this.logger.info('[DispatchService] Advanced dispatch service initialized with queue management');
  }

  // ===========================================================================================
  // 🚀 CORE INITIALIZATION AND CONFIGURATION
  // ===========================================================================================

  /**
   * Initialize the dispatch service with settings and health monitoring
   */
  async initialize() {
    try {
      await this.loadRideSettings();
      this.startHealthMonitoring();
      this.logger.info('[DispatchService] Service initialized successfully with advanced features');
    } catch (error) {
      this.logger.error('[DispatchService] Failed to initialize service:', error);
      throw new Error(`DispatchService initialization failed: ${error.message}`);
    }
  }

  /**
   * Load and validate ride settings from database with fallback
   */
  async loadRideSettings() {
    try {
      this.rideSettings = await RideSetting.findOne({ name: "default" });
      
      if (!this.rideSettings) {
        this.rideSettings = await this.createDefaultSettings();
        this.logger.info('[DispatchService] Created default ride settings');
      }
      
      this.validateAndEnforceSettingsLimits();
      this.logCurrentSettings();
      
    } catch (err) {
      this.logger.error('[DispatchService] Error loading ride settings:', err);
      this.rideSettings = this.getFallbackSettings();
      this.logger.warn('[DispatchService] Using fallback settings due to database error');
    }
  }

  /**
   * Create default settings in database
   */
  async createDefaultSettings() {
    const defaultSettings = new RideSetting({
      name: "default",
      dispatch: {
        initialRadiusKm: 2,
        maxRadiusKm: 10,
        radiusIncrementKm: 1,
        notificationTimeout: 15,
        maxDispatchTime: 300,
        graceAfterMaxRadius: 30,
        // Queue-specific settings
        maxQueueLength: 10,
        queueProcessingDelay: 2000,
        queueTimeoutMultiplier: 1.5
      },
      captainRules: {
        maxTopUpLimit: 1000,
        minWalletBalance: 0,
        minRating: 3.5,
        maxActiveRides: 1,
        maxConcurrentNotifications: 1 // New: prevent multiple notifications
      }
    });
    
    return await defaultSettings.save();
  }

  /**
   * Get fallback settings when database is unavailable
   */
  getFallbackSettings() {
    return {
      dispatch: {
        initialRadiusKm: 2,
        maxRadiusKm: 10,
        radiusIncrementKm: 1,
        notificationTimeout: 15,
        maxDispatchTime: 300,
        graceAfterMaxRadius: 30,
        maxQueueLength: 10,
        queueProcessingDelay: 2000,
        queueTimeoutMultiplier: 1.5
      },
      captainRules: {
        maxTopUpLimit: 1000,
        minWalletBalance: 0,
        minRating: 3.5,
        maxActiveRides: 1,
        maxConcurrentNotifications: 1
      }
    };
  }

  /**
   * Validate settings and enforce reasonable limits
   */
  validateAndEnforceSettingsLimits() {
    if (!this.rideSettings || !this.rideSettings.dispatch) {
      this.logger.error('[DispatchService] Invalid ride settings structure');
      return;
    }
    
    const dispatch = this.rideSettings.dispatch;
    
    // Enforce minimum values with null safety
    dispatch.initialRadiusKm = Math.max(0.5, Math.min(dispatch.initialRadiusKm || 2, 5));
    dispatch.maxRadiusKm = Math.max(dispatch.initialRadiusKm, Math.min(dispatch.maxRadiusKm || 10, 50));
    dispatch.notificationTimeout = Math.max(5, Math.min(dispatch.notificationTimeout || 15, 60));
    dispatch.maxDispatchTime = Math.max(60, Math.min(dispatch.maxDispatchTime || 300, 1800));
    
    // Queue-specific limits
    dispatch.maxQueueLength = Math.max(1, Math.min(dispatch.maxQueueLength || 10, 20));
    dispatch.queueProcessingDelay = Math.max(1000, Math.min(dispatch.queueProcessingDelay || 2000, 10000));
    
    this.logger.debug('[DispatchService] Settings validated and limits enforced');
  }

  /**
   * Log current settings for monitoring
   */
  logCurrentSettings() {
    const dispatch = this.rideSettings.dispatch;
    this.logger.info(`[DispatchService] Active Configuration:
      🎯 Dispatch Settings:
        - Initial radius: ${dispatch.initialRadiusKm} km
        - Max radius: ${dispatch.maxRadiusKm} km  
        - Radius increment: ${dispatch.radiusIncrementKm} km
        - Notification timeout: ${dispatch.notificationTimeout} seconds
        - Max dispatch time: ${dispatch.maxDispatchTime} seconds
        - Grace after max radius: ${dispatch.graceAfterMaxRadius} seconds
      🚀 Queue Settings:
        - Max queue length: ${dispatch.maxQueueLength || 10}
        - Queue processing delay: ${(dispatch.queueProcessingDelay || 2000) / 1000}s
        - Queue timeout multiplier: ${dispatch.queueTimeoutMultiplier || 1.5}x`);
  }

  /**
   * Validate dispatch settings for readiness
   */
  validateDispatchSettings() {
    try {
      if (!this.rideSettings) {
        this.logger.error('[DispatchService] No ride settings loaded');
        return false;
      }

      if (!this.rideSettings.dispatch) {
        this.logger.error('[DispatchService] No dispatch settings found');
        return false;
      }

      const dispatch = this.rideSettings.dispatch;
      
      // Check critical settings
      if (!dispatch.initialRadiusKm || dispatch.initialRadiusKm <= 0) {
        this.logger.error('[DispatchService] Invalid initial radius');
        return false;
      }

      if (!dispatch.maxRadiusKm || dispatch.maxRadiusKm <= 0) {
        this.logger.error('[DispatchService] Invalid max radius');
        return false;
      }

      if (!dispatch.notificationTimeout || dispatch.notificationTimeout <= 0) {
        this.logger.error('[DispatchService] Invalid notification timeout');
        return false;
      }

      // Check dependencies
      if (!this.redisClient) {
        this.logger.error('[DispatchService] Redis client not available');
        return false;
      }

      if (!this.onlineCaptains) {
        this.logger.error('[DispatchService] Online captains reference not available');
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('[DispatchService] Error validating dispatch settings:', error);
      return false;
    }
  }

  // ===========================================================================================
  // 🎯 ADVANCED QUEUE MANAGEMENT SYSTEM
  // ===========================================================================================

  /**
   * Check if captain has a pending ride notification
   */
  hasPendingRide(captainId) {
    const pending = this.captainPendingRides.has(captainId);
    this.logger.debug(`[Queue] Captain ${captainId} pending check: ${pending}`);
    return pending;
  }

  /**
   * Get captain's current pending ride information
   */
  getCaptainPendingRide(captainId) {
    const pendingRide = this.captainPendingRides.get(captainId);
    if (pendingRide) {
      const elapsed = Date.now() - pendingRide.timestamp.getTime();
      return {
        ...pendingRide,
        elapsedSeconds: Math.floor(elapsed / 1000),
        isExpired: elapsed > (this.rideSettings.dispatch.notificationTimeout * 1000)
      };
    }
    return null;
  }

  /**
   * Add ride to captain's queue with advanced metadata
   */
  addRideToQueue(captainId, rideData) {
    if (!captainId) {
      this.logger.error('[Queue] No captain ID provided for adding to queue');
      return null;
    }
    
    if (!rideData || !rideData.rideId) {
      this.logger.error(`[Queue] Invalid ride data for captain ${captainId}`);
      return null;
    }
    
    if (!this.captainRideQueues.has(captainId)) {
      this.captainRideQueues.set(captainId, []);
    }
    
    const queue = this.captainRideQueues.get(captainId);
    const maxQueueLength = this.rideSettings?.dispatch?.maxQueueLength || 10;
    
    // Check queue length limit
    if (queue.length >= maxQueueLength) {
      this.logger.warn(`[Queue] Captain ${captainId} queue is full (${queue.length}/${maxQueueLength}). Removing oldest ride.`);
      const removedRide = queue.shift();
      if (removedRide) {
        this.performanceCounters.currentQueuedRides--;
        this.logger.info(`[Queue] Removed ride ${removedRide.rideId} from captain ${captainId} queue (queue full)`);
      }
    }
    
    // Add enhanced metadata
    const enhancedRideData = {
      ...rideData,
      queuedAt: new Date(),
      queuePosition: queue.length + 1,
      queueId: `${captainId}_${Date.now()}`,
      priority: this.calculateRidePriority(rideData),
      estimatedWaitTime: this.estimateQueueWaitTime(captainId, queue.length)
    };
    
    queue.push(enhancedRideData);
    
    // Update metrics
    this.dispatchMetrics.totalQueuedRides++;
    this.performanceCounters.currentQueuedRides++;
    
    // Track max queue length
    if (queue.length > this.dispatchMetrics.maxQueueLength) {
      this.dispatchMetrics.maxQueueLength = queue.length;
    }
    if (queue.length > this.performanceCounters.peakQueueLength) {
      this.performanceCounters.peakQueueLength = queue.length;
    }
    
    this.logger.info(`[Queue] Added ride ${rideData.rideId} to captain ${captainId} queue. Position: ${queue.length}, Priority: ${enhancedRideData.priority}`);
    
    return {
      queueLength: queue.length,
      queuePosition: queue.length,
      estimatedWaitTime: enhancedRideData.estimatedWaitTime,
      queueId: enhancedRideData.queueId
    };
  }

  /**
   * Calculate ride priority based on various factors
   */
  calculateRidePriority(rideData) {
    let priority = 100; // Base priority
    
    // Higher fare = higher priority
    if (rideData.fare > 5000) priority += 20;
    else if (rideData.fare > 3000) priority += 10;
    
    // Shorter distance = higher priority for quick turnaround
    if (rideData.distance < 2) priority += 15;
    else if (rideData.distance > 10) priority -= 10;
    
    // Time-based priority (older requests get slight boost)
    const age = Date.now() - new Date(rideData.queuedAt || Date.now()).getTime();
    priority += Math.floor(age / 60000); // +1 per minute waiting
    
    return Math.max(1, Math.min(priority, 200)); // Clamp between 1-200
  }

  /**
   * Estimate wait time for queue position
   */
  estimateQueueWaitTime(captainId, queuePosition) {
    const avgResponseTime = this.getCaptainAverageResponseTime(captainId);
    const baseTimeout = this.rideSettings.dispatch.notificationTimeout;
    
    return Math.ceil((queuePosition * (avgResponseTime || baseTimeout)) * 1.2); // 20% buffer
  }

  /**
   * Get captain's average response time from history
   */
  getCaptainAverageResponseTime(captainId) {
    const history = this.captainResponseHistory.get(captainId);
    if (!history || history.length === 0) return null;
    
    const recentResponses = history.slice(-10); // Last 10 responses
    const responseTimes = recentResponses
      .filter(h => h.responseTime)
      .map(h => h.responseTime);
    
    if (responseTimes.length === 0) return null;
    
    return responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
  }

  /**
   * Process next ride in captain's queue with error handling
   */
  async processNextRideInQueue(captainId) {
    try {
      if (!captainId) {
        this.logger.error('[Queue] No captain ID provided for queue processing');
        return false;
      }
      
      const queue = this.captainRideQueues.get(captainId);
      if (!queue || queue.length === 0) {
        this.logger.debug(`[Queue] No rides in queue for captain ${captainId}`);
        return false;
      }

      // Check if captain already has pending ride
      if (this.hasPendingRide(captainId)) {
        this.logger.debug(`[Queue] Captain ${captainId} still has pending ride, deferring queue processing`);
        return false;
      }

      // Check if captain is still online
      if (!this.onlineCaptains[captainId]) {
        this.logger.warn(`[Queue] Captain ${captainId} is offline. Clearing queue.`);
        this.clearCaptainQueue(captainId, 'captain_offline');
        return false;
      }

      // Get next ride (sort by priority first)
      queue.sort((a, b) => (b.priority || 100) - (a.priority || 100));
      const nextRideData = queue.shift();
      
      if (!nextRideData) {
        this.logger.warn(`[Queue] No ride data found in queue for captain ${captainId}`);
        return false;
      }
      
      this.performanceCounters.currentQueuedRides--;
      
      // Calculate queue wait time for metrics
      let queueWaitTime = 0;
      if (nextRideData.queuedAt) {
        queueWaitTime = Date.now() - new Date(nextRideData.queuedAt).getTime();
        this.updateAverageQueueWaitTime(queueWaitTime);
      }
      
      this.logger.info(`[Queue] Processing ride ${nextRideData.rideId} for captain ${captainId}. Waited ${Math.floor(queueWaitTime / 1000)}s. Queue remaining: ${queue.length}`);

      // Add processing delay to prevent overwhelming captain
      const delay = this.rideSettings?.dispatch?.queueProcessingDelay || 2000;
      
      setTimeout(async () => {
        await this.validateAndSendQueuedRide(captainId, nextRideData);
      }, delay);
      
      return true;
    } catch (error) {
      this.logger.error(`[Queue] Error processing queue for captain ${captainId}:`, error);
      this.handleQueueProcessingError(captainId, error);
      return false;
    }
  }

  /**
   * Validate and send queued ride with comprehensive checks
   */
  async validateAndSendQueuedRide(captainId, rideData) {
    try {
      // Multi-layer validation
      const validationResult = await this.validateQueuedRide(rideData);
      if (!validationResult.isValid) {
        this.logger.info(`[Queue] Ride ${rideData.rideId} validation failed: ${validationResult.reason}. Processing next in queue.`);
        setTimeout(() => this.processNextRideInQueue(captainId), 1000);
        return;
      }

      // Final captain online check
      if (!this.onlineCaptains[captainId]) {
        this.logger.warn(`[Queue] Captain ${captainId} went offline during queue processing. Clearing queue.`);
        this.clearCaptainQueue(captainId);
        return;
      }

      // Send the ride notification
      const sent = await this.sendRideNotificationToCaptain(captainId, rideData);
      if (sent) {
        this.logger.info(`[Queue] Successfully sent queued ride ${rideData.rideId} to captain ${captainId}`);
        this.recordCaptainNotification(captainId, rideData.rideId, 'queued_notification');
      } else {
        this.logger.warn(`[Queue] Failed to send queued ride ${rideData.rideId} to captain ${captainId}. Processing next.`);
        setTimeout(() => this.processNextRideInQueue(captainId), 1000);
      }
    } catch (error) {
      this.logger.error(`[Queue] Error validating/sending queued ride ${rideData.rideId} for captain ${captainId}:`, error);
      setTimeout(() => this.processNextRideInQueue(captainId), 2000);
    }
  }

  /**
   * Comprehensive validation for queued rides
   */
  async validateQueuedRide(rideData) {
    try {
      // Check if ride still exists and is available
      const ride = await Ride.findById(rideData.rideId).select('status driver passenger');
      if (!ride) {
        return { isValid: false, reason: 'ride_not_found' };
      }

      if (ride.status !== 'requested') {
        return { isValid: false, reason: `ride_status_changed_to_${ride.status}` };
      }

      if (ride.driver) {
        return { isValid: false, reason: 'ride_already_assigned' };
      }

      // Check ride age (don't send very old rides)
      const maxAge = (this.rideSettings.dispatch.maxDispatchTime + this.rideSettings.dispatch.graceAfterMaxRadius) * 1000;
      const rideAge = Date.now() - new Date(ride.createdAt).getTime();
      if (rideAge > maxAge) {
        return { isValid: false, reason: 'ride_too_old' };
      }

      // Check if passenger is still online (optional)
      if (this.customerSocketService && ride.passenger && typeof this.customerSocketService.isCustomerOnline === 'function') {
        const isCustomerOnline = this.customerSocketService.isCustomerOnline(ride.passenger);
        if (!isCustomerOnline) {
          this.logger.warn(`[Queue] Customer ${ride.passenger} is offline for ride ${rideData.rideId}`);
          // Don't fail validation, just log warning
        }
      }

      return { isValid: true, reason: 'valid' };
    } catch (error) {
      this.logger.error(`[Queue] Error validating ride ${rideData.rideId}:`, error);
      return { isValid: false, reason: 'validation_error' };
    }
  }

  /**
   * Send ride notification to captain and track as pending
   */
  async sendRideNotificationToCaptain(captainId, rideData) {
    if (!this.captainSocketService) {
      this.logger.error(`[Queue] CaptainSocketService not available for captain ${captainId}`);
      return false;
    }
    
    if (!captainId) {
      this.logger.error('[Queue] No captain ID provided for notification');
      return false;
    }
    
    if (!rideData || !rideData.rideId) {
      this.logger.error(`[Queue] Invalid ride data for captain ${captainId}`);
      return false;
    }

    try {
      const sent = this.captainSocketService.emitToCaptain(captainId, "newRide", {
        rideId: rideData.rideId,
        pickupLocation: rideData.pickupLocation,
        dropoffLocation: rideData.dropoffLocation,
        fare: rideData.fare,
        currency: rideData.currency || 'IQD',
        distance: rideData.distance || 0,
        duration: rideData.duration || 0,
        paymentMethod: rideData.paymentMethod || 'cash',
        pickupName: rideData.pickupName || 'Unknown pickup',
        dropoffName: rideData.dropoffName || 'Unknown destination',
        passengerInfo: rideData.passengerInfo || {},
        // Metadata (not exposed to client)
        _queueMetadata: {
          wasQueued: !!rideData.queuedAt,
          queueWaitTime: rideData.queuedAt ? Date.now() - new Date(rideData.queuedAt).getTime() : 0,
          priority: rideData.priority || 100
        }
      });

      if (sent) {
        // Track as pending ride with enhanced metadata
        this.setCaptainPendingRide(captainId, rideData.rideId, rideData);
        
        // Track in ride notifications
        if (!this.rideNotifications.has(rideData.rideId)) {
          this.rideNotifications.set(rideData.rideId, new Set());
        }
        this.rideNotifications.get(rideData.rideId).add(captainId);
        
        // Update performance counters
        this.performanceCounters.notificationsSentToday++;
        this.updateMemoryUsage();
      }

      return sent;
    } catch (error) {
      this.logger.error(`[Queue] Error sending notification to captain ${captainId}:`, error);
      return false;
    }
  }

  /**
   * Set captain pending ride with comprehensive timeout management
   */
  setCaptainPendingRide(captainId, rideId, rideData = null) {
    // Clear any existing pending ride
    this.clearCaptainPendingRide(captainId);

    const baseTimeout = this.rideSettings.dispatch.notificationTimeout * 1000;
    const queueMultiplier = this.rideSettings.dispatch.queueTimeoutMultiplier || 1.5;
    
    // Adjust timeout based on queue wait time
    let adjustedTimeout = baseTimeout;
    if (rideData?.queuedAt) {
      const queueWaitTime = Date.now() - new Date(rideData.queuedAt).getTime();
      if (queueWaitTime > 30000) { // If waited more than 30s in queue
        adjustedTimeout = Math.min(baseTimeout * queueMultiplier, baseTimeout * 2);
      }
    }
    
    // Set timeout to automatically clear pending and process queue
    const timeoutId = setTimeout(() => {
      this.logger.info(`[Queue] Pending ride ${rideId} timed out for captain ${captainId}. Processing next in queue.`);
      this.handlePendingRideTimeout(captainId, rideId);
    }, adjustedTimeout);

    // Store comprehensive pending ride info
    this.captainPendingRides.set(captainId, {
      rideId: rideId,
      timestamp: new Date(),
      timeoutId: timeoutId,
      attemptCount: (rideData?.attemptCount || 0) + 1,
      adjustedTimeout: adjustedTimeout,
      originalData: rideData
    });

    this.logger.debug(`[Queue] Set pending ride ${rideId} for captain ${captainId} with ${adjustedTimeout / 1000}s timeout`);
  }

  /**
   * Handle pending ride timeout with queue processing
   */
  handlePendingRideTimeout(captainId, rideId) {
    try {
      if (!captainId || !rideId) {
        this.logger.error('[Queue] Invalid parameters for pending ride timeout handling');
        return;
      }
      
      // Record timeout in captain history
      this.recordCaptainResponse(captainId, rideId, 'timeout', Date.now());
      
      // Clear the pending ride
      this.clearCaptainPendingRide(captainId);
      
      // Update timeout metrics
      this.dispatchMetrics.queueTimeouts++;
      
      // Process next ride in queue after small delay
      setTimeout(() => {
        this.processNextRideInQueue(captainId);
      }, 1000);
      
    } catch (error) {
      this.logger.error(`[Queue] Error handling timeout for captain ${captainId}, ride ${rideId}:`, error);
    }
  }

  /**
   * Clear captain pending ride with cleanup
   */
  clearCaptainPendingRide(captainId) {
    const pendingRide = this.captainPendingRides.get(captainId);
    if (pendingRide) {
      // Clear timeout to prevent memory leaks
      if (pendingRide.timeoutId) {
        clearTimeout(pendingRide.timeoutId);
      }
      
      // Remove from pending
      this.captainPendingRides.delete(captainId);
      
      this.logger.debug(`[Queue] Cleared pending ride ${pendingRide.rideId} for captain ${captainId}`);
      return pendingRide;
    }
    return null;
  }

  /**
   * Clear captain's entire queue with proper cleanup
   */
  clearCaptainQueue(captainId, reason = 'manual_clear') {
    const queue = this.captainRideQueues.get(captainId);
    const pending = this.clearCaptainPendingRide(captainId);
    
    let clearedCount = 0;
    if (queue && queue.length > 0) {
      clearedCount = queue.length;
      this.performanceCounters.currentQueuedRides -= queue.length;
      this.logger.info(`[Queue] Cleared ${queue.length} rides from captain ${captainId} queue (reason: ${reason})`);
    }
    
    this.captainRideQueues.delete(captainId);
    
    // Clear any queue processing timeout to prevent memory leaks
    const queueTimeout = this.queueProcessingTimeouts.get(captainId);
    if (queueTimeout) {
      clearTimeout(queueTimeout);
      this.queueProcessingTimeouts.delete(captainId);
    }
    
    this.updateMemoryUsage();
    
    return {
      clearedQueue: clearedCount,
      clearedPending: !!pending,
      totalCleared: clearedCount + (pending ? 1 : 0)
    };
  }

  // ===========================================================================================
  // 🎯 CAPTAIN RESPONSE HANDLING - ADVANCED METHODS
  // ===========================================================================================

  /**
   * Enhanced captain rejection handler with queue processing
   */
  handleCaptainRejection(rideId, captainId, reason = 'manual_rejection') {
    const rideIdStr = rideId.toString();
    const startTime = Date.now();
    
    try {
      // Clear pending ride and get info
      const clearedPending = this.clearCaptainPendingRide(captainId);
      const hadPendingRide = !!clearedPending;
      
      // Record response in history
      this.recordCaptainResponse(captainId, rideIdStr, 'rejected', startTime, reason);
      
      // Remove from notifications tracking
      let wasTracked = false;
      if (this.rideNotifications.has(rideIdStr)) {
        wasTracked = this.rideNotifications.get(rideIdStr).has(captainId);
        this.rideNotifications.get(rideIdStr).delete(captainId);
      }
      
      if (this.currentRadiusNotifications.has(rideIdStr)) {
        this.currentRadiusNotifications.get(rideIdStr).delete(captainId);
      }
      
      // Process next ride in queue with delay to prevent rapid succession
      const queueProcessingDelay = this.rideSettings.dispatch.queueProcessingDelay || 2000;
      setTimeout(() => {
        this.processNextRideInQueue(captainId);
      }, queueProcessingDelay);
      
      const remainingNotifiedCaptains = this.rideNotifications.get(rideIdStr)?.size || 0;
      
      this.logger.info(`[Dispatch] Captain ${captainId} rejected ride ${rideIdStr} (reason: ${reason}). ${hadPendingRide ? 'Cleared pending, ' : ''}processing next in queue. Remaining: ${remainingNotifiedCaptains}`);
      
      return {
        rideId: rideIdStr,
        captainId: captainId,
        timestamp: new Date(),
        wasTracked: wasTracked,
        hadPendingRide: hadPendingRide,
        remainingNotifiedCaptains: remainingNotifiedCaptains,
        queueProcessed: true,
        reason: reason,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      this.logger.error(`[Dispatch] Error handling rejection for captain ${captainId}, ride ${rideIdStr}:`, error);
      return {
        rideId: rideIdStr,
        captainId: captainId,
        timestamp: new Date(),
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Enhanced captain acceptance handler with queue clearing
   */
  async handleCaptainAcceptance(rideId, captainId) {
    const rideIdStr = rideId.toString();
    const startTime = Date.now();
    
    try {
      this.logger.info(`[Dispatch] Processing captain ${captainId} acceptance of ride ${rideIdStr}`);
      
      // Clear pending ride
      const clearedPending = this.clearCaptainPendingRide(captainId);
      
      // Record response in history
      this.recordCaptainResponse(captainId, rideIdStr, 'accepted', startTime);
      
      // Clear captain's entire queue since they're now busy
      const queueClearResult = this.clearCaptainQueue(captainId, 'ride_accepted');
      
      // Hide ride from all other captains IMMEDIATELY
      this.notifyCaptainsToHideRide(rideId, captainId, 'ride_taken');
      
      // Clean up all related tracking immediately
      this.cleanupRideNotifications(rideIdStr);
      
      // Cancel dispatch process for this ride
      await this.cancelDispatchProcess(rideIdStr);
      
      // Update success metrics
      this.dispatchMetrics.successfulDispatches++;
      this.updateCaptainResponseRate();
      
      this.logger.info(`[Dispatch] Captain ${captainId} acceptance processed successfully. Cleared ${queueClearResult.totalCleared} items from queue.`);
      
      return {
        rideId: rideIdStr,
        captainId: captainId,
        timestamp: new Date(),
        action: 'accepted',
        dispatchStopped: true,
        queueCleared: queueClearResult.totalCleared,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      this.logger.error(`[Dispatch] Error handling acceptance for captain ${captainId}, ride ${rideIdStr}:`, error);
      return {
        rideId: rideIdStr,
        captainId: captainId,
        timestamp: new Date(),
        action: 'accepted',
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Enhanced captain cancellation handler with complete cleanup
   */
  async handleCaptainCancellation(rideId, captainId) {
    const rideIdStr = rideId.toString();
    const startTime = Date.now();
    
    try {
      this.logger.info(`[Dispatch] 🚫 Processing captain ${captainId} PERMANENT cancellation of ride ${rideIdStr}`);
      
      // Record cancellation in history
      this.recordCaptainResponse(captainId, rideIdStr, 'cancelled_permanently', startTime);
      
      // Clean up all tracking for this ride completely
      this.cleanupRideNotifications(rideIdStr);
      
      // Cancel dispatch process if still active
      await this.cancelDispatchProcess(rideIdStr);
      
      // Update metrics
      this.dispatchMetrics.failedDispatches++;
      
      this.logger.info(`[Dispatch] ✅ Captain ${captainId} permanent cancellation processed. Ride ${rideIdStr} completely removed from system.`);
      
      return {
        rideId: rideIdStr,
        captainId: captainId,
        timestamp: new Date(),
        action: 'cancelled_permanently',
        cleanupCompleted: true,
        processingTime: Date.now() - startTime
      };
      
    } catch (error) {
      this.logger.error(`[Dispatch] Error handling permanent cancellation for captain ${captainId}, ride ${rideIdStr}:`, error);
      return {
        rideId: rideIdStr,
        captainId: captainId,
        timestamp: new Date(),
        action: 'cancelled_permanently',
        error: error.message,
        processingTime: Date.now() - startTime
      };
    }
  }

  /**
   * Cancel dispatch process safely
   */
  async cancelDispatchProcess(rideIdStr) {
    if (this.dispatchProcesses.has(rideIdStr)) {
      try {
        const cancelFunc = this.dispatchProcesses.get(rideIdStr);
        cancelFunc();
        this.dispatchProcesses.delete(rideIdStr);
        this.logger.info(`[Dispatch] Successfully stopped dispatch process for ride ${rideIdStr}`);
        return true;
      } catch (error) {
        this.logger.error(`[Dispatch] Error stopping dispatch process for ride ${rideIdStr}:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Record captain response in history for analytics
   */
  recordCaptainResponse(captainId, rideId, action, timestamp, metadata = {}) {
    try {
      if (!this.captainResponseHistory.has(captainId)) {
        this.captainResponseHistory.set(captainId, []);
      }
      
      const history = this.captainResponseHistory.get(captainId);
      const responseTime = Date.now() - timestamp;
      
      const responseRecord = {
        rideId: rideId,
        action: action,
        timestamp: new Date(timestamp),
        responseTime: responseTime,
        metadata: metadata
      };
      
      history.push(responseRecord);
      
      // Keep only last 100 responses per captain
      if (history.length > 100) {
        history.splice(0, history.length - 100);
      }
      
      this.logger.debug(`[Analytics] Recorded ${action} response for captain ${captainId}: ${responseTime}ms`);
      
    } catch (error) {
      this.logger.error(`[Analytics] Error recording captain response:`, error);
    }
  }

  /**
   * Record captain notification for tracking
   */
  recordCaptainNotification(captainId, rideId, type = 'direct_notification') {
    try {
      this.recordCaptainResponse(captainId, rideId, 'notified', Date.now(), { type });
    } catch (error) {
      this.logger.error(`[Analytics] Error recording captain notification:`, error);
    }
  }

  // ===========================================================================================
  // 🚀 ENHANCED DISPATCH ALGORITHM WITH QUEUE INTEGRATION
  // ===========================================================================================

  /**
   * Main dispatch method with advanced queue management
   */
  async dispatchRide(ride, origin) {
    const startTime = Date.now();
    
    // Ensure settings are loaded
    if (!this.rideSettings) {
      await this.loadRideSettings();
    }

    // Validate settings and check circuit breaker
    if (!this.validateDispatchSettings() || this.errorRecovery.circuitBreakerOpen) {
      this.logger.error(`[Dispatch] Cannot dispatch ride ${ride._id} - invalid settings or circuit breaker open`);
      return;
    }

    const rideId = ride._id.toString();
    const dispatch = this.rideSettings.dispatch;

    // Initialize tracking
    this.initializeRideTracking(rideId);
    this.updateDispatchMetrics(startTime);

    this.logger.info(`[Dispatch] 🚀 Starting enhanced dispatch for ride ${rideId}. Origin: (${origin.longitude}, ${origin.latitude})`);

    const dispatchConfig = {
      rideId,
      dispatch,
      startTime,
      maxDispatchTime: dispatch.maxDispatchTime * 1000,
      notificationTimeout: dispatch.notificationTimeout * 1000,
      graceAfterMaxRadius: dispatch.graceAfterMaxRadius * 1000
    };

    let radius = dispatch.initialRadiusKm;
    let cancelDispatch = false;
    let accepted = false;

    // Get passenger info
    const passenger = await this.getPassengerInfo(ride.passenger);

    // Setup cancellation function
    const cancelFunc = () => {
      this.logger.warn(`[Dispatch] Cancellation requested for ride ${rideId}`);
      cancelDispatch = true;
    };
    this.dispatchProcesses.set(rideId, cancelFunc);

    try {
      const globalNotifiedCaptains = new Set();

      while (!cancelDispatch && !accepted && radius <= dispatch.maxRadiusKm) {
        // Check timeouts and ride state
        if (await this.shouldStopDispatch(rideId, startTime, dispatchConfig.maxDispatchTime)) {
          cancelDispatch = true;
          break;
        }

        this.logger.info(`[Dispatch] 🎯 Ride ${rideId}: Searching radius ${radius}km (${radius}/${dispatch.maxRadiusKm})`);
        
        // Clear current radius tracking
        this.currentRadiusNotifications.set(rideId, new Set());
        
        // Find nearby captains
        const nearbyCaptainIds = await findNearbyCaptains(this.redisClient, this.logger, origin, radius);

        if (nearbyCaptainIds.length > 0) {
          const result = await this.processRadius(rideId, nearbyCaptainIds, globalNotifiedCaptains, ride, passenger, dispatchConfig);
          
          if (result.accepted) {
            accepted = true;
            break;
          }
          
          if (result.shouldStop) {
            cancelDispatch = true;
            break;
          }
        } else {
          this.logger.info(`[Dispatch] 📍 Ride ${rideId}: No captains found within radius ${radius}km`);
        }

        // Expand radius
        if (!accepted && !cancelDispatch) {
          radius += dispatch.radiusIncrementKm;
          this.logger.info(`[Dispatch] 📈 Ride ${rideId}: Expanding search radius to ${radius}km`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Prevent system overload
        }
      }

      // Handle dispatch outcome
      await this.handleDispatchOutcome(rideId, accepted, cancelDispatch, startTime, dispatch, ride);

    } catch (err) {
      await this.handleDispatchError(rideId, err, ride);
    } finally {
      this.cleanupDispatchProcess(rideId, accepted);
    }
  }

  /**
   * Process captains in current radius with queue management
   */
  async processRadius(rideId, nearbyCaptainIds, globalNotifiedCaptains, ride, passenger, config) {
    const newOnlineCaptains = nearbyCaptainIds.filter(captainId =>
      this.onlineCaptains[captainId] && !globalNotifiedCaptains.has(captainId)
    );

    if (newOnlineCaptains.length === 0) {
      this.logger.info(`[Dispatch] 👥 Ride ${rideId}: All nearby captains already notified or offline`);
      return { accepted: false, shouldStop: false };
    }

    this.logger.info(`[Dispatch] 👥 Ride ${rideId}: Found ${newOnlineCaptains.length} new online captains`);

    const rideData = this.prepareRideData(ride, passenger);
    const notifications = await this.sendNotificationsWithQueue(rideId, newOnlineCaptains, globalNotifiedCaptains, rideData);

    this.logger.info(`[Dispatch] 📤 Ride ${rideId}: Processed ${notifications.sent} immediate + ${notifications.queued} queued notifications`);

    // Wait for responses if any notifications were sent immediately
    if (notifications.sent > 0) {
      this.logger.debug(`[Dispatch] ⏳ Ride ${rideId}: Waiting ${config.dispatch.notificationTimeout}s for responses`);
      await new Promise(resolve => setTimeout(resolve, config.notificationTimeout));

      // Check if ride was accepted
      const updatedRide = await Ride.findById(rideId).select('status driver');
      if (updatedRide && updatedRide.status === "accepted") {
        this.logger.info(`[Dispatch] ✅ Ride ${rideId} was accepted by captain ${updatedRide.driver}`);
        this.notifyCaptainsToHideRide(rideId, updatedRide.driver);
        return { accepted: true, shouldStop: false };
      }

      // Hide from current radius captains if expanding radius
      this.notifyCurrentRadiusCaptainsToHide(rideId, `timeout_radius_${config.dispatch.initialRadiusKm + (nearbyCaptainIds.length * config.dispatch.radiusIncrementKm)}km`);
    }

    return { accepted: false, shouldStop: false };
  }

  /**
   * Send notifications with intelligent queue management
   */
  async sendNotificationsWithQueue(rideId, captainIds, globalNotifiedCaptains, rideData) {
    let sentImmediately = 0;
    let queuedCount = 0;

    const notificationPromises = captainIds.map(async (captainId) => {
      try {
        globalNotifiedCaptains.add(captainId);
        this.currentRadiusNotifications.get(rideId).add(captainId);

        // Check if captain has pending ride
        if (this.hasPendingRide(captainId)) {
          // Add to queue
          const queueResult = this.addRideToQueue(captainId, { ...rideData, rideId });
          this.logger.info(`[Dispatch] 📋 Captain ${captainId} has pending ride. Queued ride ${rideId} at position ${queueResult.queuePosition}`);
          queuedCount++;
          return { type: 'queued', captainId, queuePosition: queueResult.queuePosition };
        } else {
          // Send immediately
          const sent = await this.sendRideNotificationToCaptain(captainId, { ...rideData, rideId });
          if (sent) {
            sentImmediately++;
            this.recordCaptainNotification(captainId, rideId, 'immediate_notification');
            this.logger.info(`[Dispatch] 📱 Immediately notified captain ${captainId} for ride ${rideId}`);
            return { type: 'sent', captainId };
          } else {
            this.logger.warn(`[Dispatch] ❌ Failed to notify captain ${captainId} for ride ${rideId}`);
            this.removeFromTracking(rideId, captainId);
            return { type: 'failed', captainId };
          }
        }
      } catch (error) {
        this.logger.error(`[Dispatch] Error notifying captain ${captainId}:`, error);
        this.removeFromTracking(rideId, captainId);
        return { type: 'error', captainId, error: error.message };
      }
    });

    await Promise.all(notificationPromises);

    return {
      sent: sentImmediately,
      queued: queuedCount,
      total: captainIds.length
    };
  }

  /**
   * Remove captain from all tracking
   */
  removeFromTracking(rideId, captainId) {
    if (this.rideNotifications.has(rideId)) {
      this.rideNotifications.get(rideId).delete(captainId);
    }
    if (this.currentRadiusNotifications.has(rideId)) {
      this.currentRadiusNotifications.get(rideId).delete(captainId);
    }
  }

  /**
   * Prepare comprehensive ride data
   */
  prepareRideData(ride, passenger) {
    // Validate input data
    if (!ride) {
      this.logger.error('[DispatchService] Cannot prepare ride data - ride is null/undefined');
      return null;
    }
    
    if (!ride.pickupLocation || !ride.pickupLocation.coordinates) {
      this.logger.error('[DispatchService] Cannot prepare ride data - invalid pickup location');
      return null;
    }
    
    if (!ride.dropoffLocation || !ride.dropoffLocation.coordinates) {
      this.logger.error('[DispatchService] Cannot prepare ride data - invalid dropoff location');
      return null;
    }
    
    if (!ride.fare || typeof ride.fare.amount !== 'number') {
      this.logger.error('[DispatchService] Cannot prepare ride data - invalid fare');
      return null;
    }
    
    return {
      rideId: ride._id?.toString() || ride.id?.toString(),
      pickupLocation: ride.pickupLocation.coordinates,
      dropoffLocation: ride.dropoffLocation.coordinates,
      fare: ride.fare.amount,
      currency: ride.fare.currency || 'IQD',
      distance: ride.distance || 0,
      duration: ride.duration || 0,
      paymentMethod: ride.paymentMethod || 'cash',
      pickupName: ride.pickupLocation.locationName || 'Unknown pickup',
      dropoffName: ride.dropoffLocation.locationName || 'Unknown destination',
      passengerInfo: {
        id: passenger?._id,
        name: passenger?.name || 'Unknown passenger',
        phoneNumber: passenger?.phoneNumber,
      },
      metadata: {
        createdAt: ride.createdAt,
        urgency: this.calculateRideUrgency(ride),
        estimatedEarnings: this.calculateEstimatedEarnings(ride)
      }
    };
  }

  /**
   * Calculate ride urgency for prioritization
   */
  calculateRideUrgency(ride) {
    let urgency = 'normal';
    
    // Validate ride data
    if (!ride || !ride.fare || typeof ride.fare.amount !== 'number' || typeof ride.distance !== 'number') {
      this.logger.warn('[DispatchService] Invalid ride data for urgency calculation');
      return urgency;
    }
    
    if (ride.fare.amount > 10000) urgency = 'high';
    else if (ride.distance < 2) urgency = 'high'; // Short rides for quick turnaround
    else if (ride.fare.amount < 3000) urgency = 'low';
    
    return urgency;
  }

  /**
   * Calculate estimated earnings for captain
   */
  calculateEstimatedEarnings(ride) {
    // Validate ride data
    if (!ride || !ride.fare || typeof ride.fare.amount !== 'number') {
      this.logger.warn('[DispatchService] Invalid ride data for earnings calculation');
      return 0;
    }
    
    // This would include platform commission calculations
    const platformCommission = ride.fare.amount * 0.15; // 15% commission
    return Math.round(ride.fare.amount - platformCommission);
  }

  // ===========================================================================================
  // 🔧 UTILITY AND HELPER METHODS
  // ===========================================================================================

  /**
   * Check if dispatch should stop due to timeout or ride state change
   */
  async shouldStopDispatch(rideId, startTime, maxDispatchTime) {
    if (!rideId || !startTime || !maxDispatchTime) {
      this.logger.error('[Dispatch] Invalid parameters for shouldStopDispatch check');
      return true;
    }
    
    // Check overall timeout
    const elapsedTime = Date.now() - startTime;
    if (elapsedTime >= maxDispatchTime) {
      this.logger.warn(`[Dispatch] ⏱️ Max dispatch time exceeded for ride ${rideId}: ${elapsedTime / 1000}s`);
      return true;
    }

    try {
      // Check ride state
      const currentRideState = await Ride.findById(rideId).select('status');
      if (!currentRideState || currentRideState.status !== 'requested') {
        this.logger.warn(`[Dispatch] 🔄 Ride ${rideId} state changed: ${currentRideState?.status || 'not found'}`);
        return true;
      }
    } catch (error) {
      this.logger.error(`[Dispatch] Error checking ride state for ${rideId}:`, error);
      return true; // Stop dispatch on database errors
    }

    return false;
  }

  /**
   * Get passenger information safely
   */
  async getPassengerInfo(passengerId) {
    try {
      if (!passengerId) {
        this.logger.warn('[DispatchService] No passenger ID provided');
        return null;
      }
      
      return await customer.findById(passengerId)
        .select("name phoneNumber")
        .lean();
    } catch (error) {
      this.logger.error(`[Dispatch] Error fetching passenger ${passengerId}:`, error);
      return null;
    }
  }

  /**
   * Initialize ride tracking
   */
  initializeRideTracking(rideId) {
    this.rideNotifications.set(rideId, new Set());
    this.currentRadiusNotifications.set(rideId, new Set());
  }

  /**
   * Update dispatch metrics
   */
  updateDispatchMetrics(startTime) {
    this.dispatchMetrics.totalDispatches++;
    this.dispatchMetrics.lastDispatchTime = new Date(startTime);
    this.updatePerformanceCounters();
  }

  /**
   * Handle dispatch completion outcome
   */
  async handleDispatchOutcome(rideId, accepted, cancelDispatch, startTime, dispatch, ride) {
    const dispatchDuration = Date.now() - startTime;
    const finalRideState = await Ride.findById(rideId);

    if (accepted) {
      this.dispatchMetrics.successfulDispatches++;
      this.updateAverageDispatchTime(dispatchDuration);
      this.logger.info(`[Dispatch] ✅ Ride ${rideId} successfully dispatched in ${dispatchDuration / 1000}s`);
    } else if (cancelDispatch) {
      await this.handleDispatchTimeout(rideId, finalRideState, startTime, dispatch.maxRadiusKm);
    } else {
      await this.handleMaxRadiusReached(rideId, finalRideState, startTime, dispatch);
    }
  }

  /**
   * Handle dispatch timeout
   */
  async handleDispatchTimeout(rideId, rideState, startTime, maxRadius) {
    if (rideState && rideState.status === 'requested') {
      await this.updateRideToNotApprove(rideState, `Dispatch timeout after ${(Date.now() - startTime) / 1000}s`);
      this.notifyCaptainsToHideRide(rideId, null, 'dispatch_timeout');
      this.notifyCustomerRideNotApproved(rideState, startTime, maxRadius);
    }
    this.dispatchMetrics.timeoutDispatches++;
  }

  /**
   * Handle max radius reached
   */
  async handleMaxRadiusReached(rideId, rideState, startTime, dispatch) {
    this.logger.warn(`[Dispatch] 🎯 Ride ${rideId}: Max radius ${dispatch.maxRadiusKm}km reached. Starting grace period.`);
    
    const graceResult = await this.handleGracePeriod(rideId, dispatch.graceAfterMaxRadius * 1000);
    
    if (!graceResult.accepted && rideState && rideState.status === 'requested') {
      await this.updateRideToNotApprove(rideState, `No captain found within ${dispatch.maxRadiusKm}km radius`);
      this.notifyCaptainsToHideRide(rideId, null, 'max_radius_reached');
      this.notifyCustomerRideNotApproved(rideState, startTime, dispatch.maxRadiusKm);
      this.dispatchMetrics.failedDispatches++;
    }
  }

  /**
   * Handle grace period after max radius
   */
  async handleGracePeriod(rideId, gracePeriod) {
    const pollInterval = 5000;
    const endTime = Date.now() + gracePeriod;

    while (Date.now() < endTime) {
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      
      const ride = await Ride.findById(rideId).select('status driver');
      if (ride?.status === 'accepted') {
        this.logger.info(`[Dispatch] ✅ Ride ${rideId} accepted during grace period by captain ${ride.driver}`);
        this.notifyCaptainsToHideRide(rideId, ride.driver);
        return { accepted: true, driver: ride.driver };
      }
    }

    return { accepted: false };
  }

  /**
   * Update ride to not approved status
   */
  async updateRideToNotApprove(ride, reason) {
    ride.status = 'notApprove';
    ride.isDispatching = false;
    ride.dispatchEndTime = new Date();
    ride.cancellationReason = reason;
    await ride.save();
    this.logger.info(`[DB] 📝 Ride ${ride._id} updated to 'notApprove': ${reason}`);
  }

  /**
   * Notify customer of ride not approved
   */
  notifyCustomerRideNotApproved(ride, startTime, maxRadius) {
    if (this.customerSocketService && typeof this.customerSocketService.emitToCustomer === 'function') {
      this.customerSocketService.emitToCustomer(ride.passenger, 'rideNotApproved', {
        rideId: ride._id,
        message: "We couldn't find a nearby captain in time. Please try requesting again.",
        searchDuration: Math.round((Date.now() - startTime) / 1000),
        maxRadius: maxRadius
      });
    }
  }

  /**
   * Handle dispatch errors
   */
  async handleDispatchError(rideId, error, ride) {
    this.logger.error(`[Dispatch] ❌ Error during dispatch process for ride ${rideId}:`, error);
    this.dispatchMetrics.failedDispatches++;
    this.errorRecovery.consecutiveFailures++;
    this.errorRecovery.lastFailureTime = new Date();

    // Check if circuit breaker should open
    if (this.errorRecovery.consecutiveFailures >= 5) {
      this.errorRecovery.circuitBreakerOpen = true;
      this.logger.error('[Dispatch] 🚨 Circuit breaker opened due to consecutive failures');
      
      // Auto-close circuit breaker after 5 minutes
      setTimeout(() => {
        this.errorRecovery.circuitBreakerOpen = false;
        this.errorRecovery.consecutiveFailures = 0;
        this.logger.info('[Dispatch] 🔓 Circuit breaker closed - service restored');
      }, 300000);
    }

    try {
      const rideToUpdate = await Ride.findById(rideId);
      if (rideToUpdate && rideToUpdate.status === 'requested') {
        await this.updateRideToNotApprove(rideToUpdate, `Dispatch error: ${error.message}`);
        this.notifyCaptainsToHideRide(rideId, null, 'dispatch_error');
        
        if (this.customerSocketService && typeof this.customerSocketService.emitToCustomer === 'function') {
          this.customerSocketService.emitToCustomer(rideToUpdate.passenger, 'rideError', {
            rideId: rideToUpdate._id,
            message: 'An error occurred while searching for captains. Please try again.',
          });
        }
      }
    } catch (saveErr) {
      this.logger.error(`[Dispatch] Failed to update ride ${rideId} after error:`, saveErr);
    }
  }

  /**
   * Cleanup dispatch process
   */
  cleanupDispatchProcess(rideId, accepted) {
    // Remove from dispatch processes
    if (this.dispatchProcesses.has(rideId)) {
      this.dispatchProcesses.delete(rideId);
      this.logger.debug(`[Dispatch] 🧹 Cleaned up dispatch process for ride ${rideId}`);
    }
    
    // Clean up notifications if ride was not accepted
    if (!accepted) {
      this.cleanupRideNotifications(rideId);
    }
    
    this.updateMemoryUsage();
  }

  // ===========================================================================================
  // 📊 ANALYTICS, MONITORING, AND PERFORMANCE METHODS  
  // ===========================================================================================

  /**
   * Start performance monitoring
   */
  startPerformanceMonitoring() {
    setInterval(() => {
      this.updateMemoryUsage();
      this.updatePerformanceCounters();
    }, 30000); // Every 30 seconds
  }

  /**
   * Start health monitoring
   */
  startHealthMonitoring() {
    this.healthCheckIntervalId = setInterval(async () => {
      await this.performHealthCheck();
    }, 60000); // Every minute
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    try {
      const healthResult = this.validateSystemState();
      this.healthStatus = {
        isHealthy: healthResult.isHealthy,
        lastHealthCheck: new Date(),
        issues: healthResult.issues,
        warnings: healthResult.warnings,
        metrics: this.getQuickMetrics()
      };

      if (!healthResult.isHealthy) {
        this.logger.warn('[Health] System health issues detected:', healthResult.issues);
      }

      // Reset daily counters if new day
      const today = new Date().toDateString();
      if (this.performanceCounters.lastResetDate !== today) {
        this.resetDailyCounters();
      }

    } catch (error) {
      this.logger.error('[Health] Error during health check:', error);
      this.healthStatus.isHealthy = false;
      this.healthStatus.issues.push(`Health check error: ${error.message}`);
    }
  }

  /**
   * Get quick metrics for health monitoring
   */
  getQuickMetrics() {
    return {
      activeDispatches: this.dispatchProcesses.size,
      pendingRides: this.captainPendingRides.size,
      queuedRides: this.performanceCounters.currentQueuedRides,
      memoryHealth: this.checkMemoryHealth()
    };
  }

  /**
   * Check memory health
   */
  checkMemoryHealth() {
    const usage = this.performanceCounters.memoryUsage;
    const total = usage.dispatchProcesses + usage.notifications + usage.queues + usage.pending;
    
    if (total > 10000) return 'high';
    if (total > 5000) return 'medium';
    return 'low';
  }

  /**
   * Reset daily performance counters
   */
  resetDailyCounters() {
    this.performanceCounters.notificationsSentToday = 0;
    this.performanceCounters.lastResetDate = new Date().toDateString();
    this.logger.info('[Performance] Daily counters reset');
  }

  /**
   * Update memory usage tracking
   */
  updateMemoryUsage() {
    this.performanceCounters.memoryUsage = {
      dispatchProcesses: this.dispatchProcesses.size,
      notifications: this.rideNotifications.size,
      queues: this.captainRideQueues.size,
      pending: this.captainPendingRides.size
    };
  }

  /**
   * Update performance counters
   */
  updatePerformanceCounters() {
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
      this.dispatchMetrics.averageDispatchTime = 
        ((currentAverage * (totalSuccessful - 1)) + newDispatchTime) / totalSuccessful;
    }
  }

  /**
   * Update average queue wait time
   */
  updateAverageQueueWaitTime(newWaitTime) {
    if (typeof newWaitTime !== 'number' || newWaitTime < 0) {
      this.logger.warn('[DispatchService] Invalid wait time for metrics update');
      return;
    }
    
    const currentAverage = this.dispatchMetrics.averageQueueWaitTime;
    const totalQueued = this.dispatchMetrics.totalQueuedRides;
    
    if (totalQueued === 1) {
      this.dispatchMetrics.averageQueueWaitTime = newWaitTime;
    } else {
      this.dispatchMetrics.averageQueueWaitTime = 
        ((currentAverage * (totalQueued - 1)) + newWaitTime) / totalQueued;
    }
  }

  /**
   * Update captain response rate
   */
  updateCaptainResponseRate() {
    let totalNotifications = 0;
    let totalResponses = 0;

    this.captainResponseHistory.forEach((history) => {
      const notifications = history.filter(h => h.action === 'notified').length;
      const responses = history.filter(h => ['accepted', 'rejected'].includes(h.action)).length;
      
      totalNotifications += notifications;
      totalResponses += responses;
    });

    this.dispatchMetrics.captainResponseRate = totalNotifications > 0 ? 
      (totalResponses / totalNotifications) * 100 : 0;
  }

  // ===========================================================================================
  // 🔧 NOTIFICATION AND CLEANUP METHODS
  // ===========================================================================================

  /**
   * Check if captain was notified for a specific ride
   */
  wasCaptainNotified(rideId, captainId) {
    const rideIdStr = rideId.toString();
    const wasNotified = this.rideNotifications.has(rideIdStr) && 
                       this.rideNotifications.get(rideIdStr).has(captainId);
    
    this.logger.debug(`[Dispatch] Captain ${captainId} notification check for ride ${rideIdStr}: ${wasNotified ? 'YES' : 'NO'}`);
    return wasNotified;
  }

  /**
   * Clean up ride notifications
   */
  cleanupRideNotifications(rideId) {
    const rideIdStr = rideId.toString();
    
    if (this.rideNotifications.has(rideIdStr)) {
      const notifiedCount = this.rideNotifications.get(rideIdStr).size;
      this.rideNotifications.delete(rideIdStr);
      this.logger.debug(`[Dispatch] Cleaned up notification tracking for ride ${rideIdStr}. ${notifiedCount} captains were notified.`);
    }
    
    if (this.currentRadiusNotifications.has(rideIdStr)) {
      this.currentRadiusNotifications.delete(rideIdStr);
    }
  }

  /**
   * Notify current radius captains to hide ride
   */
  notifyCurrentRadiusCaptainsToHide(rideId, reason = 'timeout') {
    const rideIdStr = rideId.toString();
    const currentRadiusCaptains = this.currentRadiusNotifications.get(rideIdStr);
    
    if (!currentRadiusCaptains || currentRadiusCaptains.size === 0) {
      return;
    }

    let notifiedCount = 0;
    currentRadiusCaptains.forEach(captainId => {
      if (this.captainSocketService && typeof this.captainSocketService.emitToCaptain === 'function') {
        if (this.captainSocketService.emitToCaptain(captainId, "hideRide", {
          rideId: rideId,
          reason: reason,
          message: this.getHideMessage(reason)
        })) {
          notifiedCount++;
        }
      }
    });

    this.logger.debug(`[Dispatch] Notified ${notifiedCount} current radius captains to hide ride ${rideIdStr}`);
    this.currentRadiusNotifications.set(rideIdStr, new Set());
  }

  /**
   * Notify captains to hide ride with immediate effect
   */
  notifyCaptainsToHideRide(rideId, excludeCaptainId = null, reason = 'ride_taken') {
    const rideIdStr = rideId.toString();
    const notifiedCaptains = this.rideNotifications.get(rideIdStr);
    
    if (!notifiedCaptains || notifiedCaptains.size === 0) {
      this.logger.debug(`[Dispatch] No captains to notify for ride ${rideIdStr} hide`);
      return;
    }

    let notifiedCount = 0;
    const hideMessage = this.getHideMessage(reason);
    
    notifiedCaptains.forEach(captainId => {
      if (captainId !== excludeCaptainId) {
        if (this.captainSocketService && typeof this.captainSocketService.emitToCaptain === 'function') {
          if (this.captainSocketService.emitToCaptain(captainId, "hideRide", {
            rideId: rideId,
            reason: reason,
            message: hideMessage,
            timestamp: new Date().toISOString()
          })) {
            notifiedCount++;
            // Also clear captain's pending ride if this was it
            const pendingRide = this.getCaptainPendingRide(captainId);
            if (pendingRide && pendingRide.rideId.toString() === rideIdStr) {
              this.clearCaptainPendingRide(captainId);
              this.logger.debug(`[Dispatch] Cleared pending ride for captain ${captainId} due to hide`);
            }
          }
        }
      }
    });

    this.logger.info(`[Dispatch] 🙈 Notified ${notifiedCount} captains to hide ride ${rideIdStr} (${reason})`);
    
    // Clean up immediately after hiding
    this.cleanupRideNotifications(rideIdStr);
  }

  /**
   * Get hide message based on reason
   */
  getHideMessage(reason) {
    const messages = {
      'ride_taken': 'This ride has been taken by another captain.',
      'dispatch_timeout': 'This ride request has timed out.',
      'max_radius_reached': 'No captain found for this ride.',
      'dispatch_error': 'An error occurred with this ride request.',
      'emergency_stop': 'Dispatch service was stopped.',
      'timeout': 'Searching for captains in a wider area.',
      'captain_cancelled_permanently': 'This ride has been permanently cancelled by another captain.'
    };
    
    if (reason.includes('timeout_radius_')) {
      return 'Searching for captains in a wider area.';
    }
    
    return messages[reason] || 'This ride is no longer available.';
  }

  // ===========================================================================================
  // 📊 PUBLIC API AND STATISTICS METHODS
  // ===========================================================================================

  /**
   * Get comprehensive dispatch statistics
   */
  getDispatchStats() {
    const queueStats = this.getDetailedQueueStats();
    
    return {
      // Core dispatch info
      activeDispatches: this.dispatchProcesses.size,
      activeRideIds: Array.from(this.dispatchProcesses.keys()),
      
      // Queue statistics
      queues: queueStats,
      
      // Performance metrics
      metrics: {
        ...this.dispatchMetrics,
        averageDispatchTimeSeconds: Math.round(this.dispatchMetrics.averageDispatchTime / 1000),
        averageQueueWaitTimeSeconds: Math.round(this.dispatchMetrics.averageQueueWaitTime / 1000),
        successRate: this.dispatchMetrics.totalDispatches > 0 ? 
          (this.dispatchMetrics.successfulDispatches / this.dispatchMetrics.totalDispatches) * 100 : 0,
        responseRate: this.dispatchMetrics.captainResponseRate
      },
      
      // Performance counters
      performance: {
        ...this.performanceCounters,
        memoryUsage: this.performanceCounters.memoryUsage
      },
      
      // Health status
      health: this.healthStatus,
      
      // Settings
      settings: {
        initialRadiusKm: this.rideSettings?.dispatch?.initialRadiusKm,
        maxRadiusKm: this.rideSettings?.dispatch?.maxRadiusKm,
        radiusIncrementKm: this.rideSettings?.dispatch?.radiusIncrementKm,
        notificationTimeoutSeconds: this.rideSettings?.dispatch?.notificationTimeout,
        maxDispatchTimeSeconds: this.rideSettings?.dispatch?.maxDispatchTime,
        graceAfterMaxRadiusSeconds: this.rideSettings?.dispatch?.graceAfterMaxRadius,
        maxQueueLength: this.rideSettings?.dispatch?.maxQueueLength
      }
    };
  }

  /**
   * Get detailed queue statistics
   */
  getDetailedQueueStats() {
    let totalCaptainsWithQueues = 0;
    let totalQueuedRides = 0;
    const queueLengthBreakdown = {};
    const captainQueueDetails = [];

    this.captainRideQueues.forEach((queue, captainId) => {
      if (queue.length > 0) {
        totalCaptainsWithQueues++;
        totalQueuedRides += queue.length;
        
        const length = queue.length;
        queueLengthBreakdown[length] = (queueLengthBreakdown[length] || 0) + 1;
        
        captainQueueDetails.push({
          captainId,
          queueLength: queue.length,
          oldestRideWaitTime: queue.length > 0 ? 
            Date.now() - new Date(queue[0].queuedAt).getTime() : 0
        });
      }
    });

    return {
      totalCaptainsWithQueues,
      totalQueuedRides,
      totalPendingRides: this.captainPendingRides.size,
      averageQueueLength: totalCaptainsWithQueues > 0 ? totalQueuedRides / totalCaptainsWithQueues : 0,
      queueLengthBreakdown,
      maxQueueLength: this.dispatchMetrics.maxQueueLength,
      peakQueueLength: this.performanceCounters.peakQueueLength,
      captainQueueDetails: captainQueueDetails.slice(0, 10) // Top 10 for performance
    };
  }

  /**
   * Get captain's queue status
   */
  getCaptainQueueStatus(captainId) {
    const pendingRide = this.getCaptainPendingRide(captainId);
    const queue = this.captainRideQueues.get(captainId) || [];
    const responseHistory = this.captainResponseHistory.get(captainId) || [];

    return {
      captainId,
      hasPendingRide: !!pendingRide,
      pendingRide: pendingRide ? {
        rideId: pendingRide.rideId,
        timestamp: pendingRide.timestamp,
        elapsedSeconds: pendingRide.elapsedSeconds,
        isExpired: pendingRide.isExpired,
        attemptCount: pendingRide.attemptCount
      } : null,
      queueLength: queue.length,
      queuedRides: queue.map(ride => ({
        rideId: ride.rideId,
        queuedAt: ride.queuedAt,
        queuePosition: ride.queuePosition,
        priority: ride.priority,
        estimatedWaitTime: ride.estimatedWaitTime
      })),
      responseHistory: {
        totalResponses: responseHistory.length,
        recentResponses: responseHistory.slice(-5),
        averageResponseTime: this.getCaptainAverageResponseTime(captainId)
      }
    };
  }

  /**
   * Validate system state and report issues
   */
  validateSystemState() {
    const issues = [];
    const warnings = [];
    
    try {
      // Check for orphaned dispatch processes
      this.dispatchProcesses.forEach((cancelFunc, rideId) => {
        if (!this.rideNotifications.has(rideId)) {
          issues.push(`Ride ${rideId} has dispatch process but no notification tracking`);
        }
      });
      
      // Check for notification tracking without dispatch process
      this.rideNotifications.forEach((captainSet, rideId) => {
        if (!this.dispatchProcesses.has(rideId) && captainSet.size > 0) {
          warnings.push(`Ride ${rideId} has notification tracking but no dispatch process`);
        }
      });
      
      // Check pending rides without valid timeouts
      this.captainPendingRides.forEach((pendingRide, captainId) => {
        if (!pendingRide.timeoutId) {
          issues.push(`Captain ${captainId} has pending ride without timeout`);
        }
      });
      
      // Check queue consistency
      this.captainRideQueues.forEach((queue, captainId) => {
        if (queue.length > (this.rideSettings?.dispatch?.maxQueueLength || 10)) {
          warnings.push(`Captain ${captainId} queue exceeds max length: ${queue.length}`);
        }
      });

      // Check memory usage
      const memUsage = this.performanceCounters.memoryUsage;
      const totalMemory = memUsage.dispatchProcesses + memUsage.notifications + memUsage.queues + memUsage.pending;
      if (totalMemory > 10000) {
        warnings.push(`High memory usage detected: ${totalMemory} total objects`);
      }

    } catch (error) {
      issues.push(`System validation error: ${error.message}`);
    }
    
    return {
      isHealthy: issues.length === 0,
      issues,
      warnings,
      checkedAt: new Date(),
      summary: {
        dispatchProcesses: this.dispatchProcesses.size,
        notificationTracking: this.rideNotifications.size,
        currentRadiusTracking: this.currentRadiusNotifications.size,
        pendingRides: this.captainPendingRides.size,
        queuedRides: this.performanceCounters.currentQueuedRides
      }
    };
  }

  // ===========================================================================================
  // 🛠️ SERVICE MANAGEMENT METHODS
  // ===========================================================================================

  /**
   * Set socket services references
   */
  setSocketServices(captainSocketService, customerSocketService) {
    this.captainSocketService = captainSocketService;
    this.customerSocketService = customerSocketService;
    this.logger.info('[DispatchService] Socket services injected successfully');
  }

  /**
   * Refresh settings from database
   */
  async refreshSettings() {
    this.logger.info('[DispatchService] Refreshing ride settings...');
    await this.loadRideSettings();
    this.startBackgroundDispatcher();
  }

  /**
   * Get current settings
   */
  getCurrentSettings() {
    return this.rideSettings;
  }

  /**
   * Start background dispatcher
   */
  startBackgroundDispatcher() {
    const dispatchCheckInterval = Math.max(30000, 
      (this.rideSettings?.dispatch?.notificationTimeout || 15) * 2 * 1000);

    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
    }

    this.backgroundIntervalId = setInterval(async () => {
      await this.checkForDispatchableRides();
    }, dispatchCheckInterval);

    this.logger.info(`[DispatchService] Background dispatcher started (${dispatchCheckInterval / 1000}s interval)`);
  }

  /**
   * Check for rides that need dispatching
   */
  async checkForDispatchableRides() {
    try {
      const ridesToDispatch = await Ride.find({
        status: 'requested',
        isDispatching: { $ne: true },
        _id: { $nin: Array.from(this.dispatchProcesses.keys()) }
      });

      for (const ride of ridesToDispatch) {
        const rideAge = (Date.now() - new Date(ride.createdAt)) / 1000;
        const maxAge = (this.rideSettings?.dispatch?.maxDispatchTime || 300) + 
                      (this.rideSettings?.dispatch?.graceAfterMaxRadius || 30);

        if (rideAge > maxAge) {
          await this.handleExpiredRide(ride, rideAge);
          continue;
        }

        await this.initiateBackgroundDispatch(ride, rideAge);
      }
    } catch (err) {
      this.logger.error("[Background Dispatch] Error checking for dispatchable rides:", err);
    }
  }

  /**
   * Handle expired ride
   */
  async handleExpiredRide(ride, rideAge) {
    this.logger.warn(`[Background Dispatch] Ride ${ride._id} expired (${rideAge}s old)`);
    ride.status = 'notApprove';
    ride.isDispatching = false;
    ride.cancellationReason = `Ride expired - too old (${Math.round(rideAge)}s)`;
    await ride.save();

    if (this.customerSocketService && typeof this.customerSocketService.emitToCustomer === 'function') {
      this.customerSocketService.emitToCustomer(ride.passenger, 'rideNotApproved', {
        rideId: ride._id,
        message: 'Your ride request has expired. Please try requesting again.',
      });
    }
  }

  /**
   * Initiate background dispatch
   */
  async initiateBackgroundDispatch(ride, rideAge) {
    this.logger.info(`[Background Dispatch] Initiating dispatch for ride ${ride._id} (age: ${Math.round(rideAge)}s)`);

    ride.isDispatching = true;
    await ride.save();

    const originCoords = {
      latitude: ride.pickupLocation.coordinates[1],
      longitude: ride.pickupLocation.coordinates[0],
    };

    this.dispatchRide(ride, originCoords);
  }

  /**
   * Stop background dispatcher
   */
  stopBackgroundDispatcher() {
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = null;
      this.logger.info('[DispatchService] Background dispatcher stopped');
    }
  }

  /**
   * Emergency stop all dispatches
   */
  emergencyStopAllDispatches() {
    this.logger.warn('[DispatchService] 🚨 Emergency stop requested for all dispatch processes');

    // Stop all active dispatches
    for (const [rideId, cancelFunc] of this.dispatchProcesses.entries()) {
      try {
        this.notifyCaptainsToHideRide(rideId, null, 'emergency_stop');
        cancelFunc();
      } catch (error) {
        this.logger.error(`[Emergency Stop] Error stopping dispatch for ride ${rideId}:`, error);
      }
    }

    // Clear all state
    const clearedData = {
      dispatches: this.dispatchProcesses.size,
      notifications: this.rideNotifications.size,
      pending: this.captainPendingRides.size,
      queues: this.captainRideQueues.size
    };

    this.dispatchProcesses.clear();
    this.rideNotifications.clear();
    this.currentRadiusNotifications.clear();
    
    // Clear all pending ride timeouts
    this.captainPendingRides.forEach((pendingRide) => {
      clearTimeout(pendingRide.timeoutId);
    });
    this.captainPendingRides.clear();
    
    // Clear all queue processing timeouts
    this.queueProcessingTimeouts.forEach((timeoutId) => {
      clearTimeout(timeoutId);
    });
    this.queueProcessingTimeouts.clear();
    this.captainRideQueues.clear();
    
    this.updateMemoryUsage();
    
    this.logger.info(`[Emergency Stop] Cleared: ${clearedData.dispatches} dispatches, ${clearedData.notifications} notifications, ${clearedData.pending} pending, ${clearedData.queues} queues`);
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown() {
    this.logger.info('[DispatchService] 🔄 Starting graceful shutdown...');
    
    this.stopBackgroundDispatcher();
    
    if (this.healthCheckIntervalId) {
      clearInterval(this.healthCheckIntervalId);
    }
    
    // Allow current dispatches to complete
    const activeDispatches = this.dispatchProcesses.size;
    if (activeDispatches > 0) {
      this.logger.info(`[Shutdown] Waiting for ${activeDispatches} active dispatches to complete...`);
      await new Promise(resolve => setTimeout(resolve, 10000)); // Wait 10 seconds
    }
    
    this.emergencyStopAllDispatches();
    this.logger.info('[DispatchService] ✅ Graceful shutdown completed');
  }

  /**
   * Handle queue processing errors
   */
  handleQueueProcessingError(captainId, error) {
    this.logger.error(`[Queue Error] Processing error for captain ${captainId}:`, error);
    
    // Clear captain's problematic queue
    this.clearCaptainQueue(captainId, 'processing_error');
    
    // Add to error recovery
    this.errorRecovery.consecutiveFailures++;
  }
}

module.exports = DispatchService;