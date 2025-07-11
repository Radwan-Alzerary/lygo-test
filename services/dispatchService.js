const customer = require("../model/customer");
const Ride = require("../model/ride");
const RideSetting = require("../model/rideSetting");
const { findNearbyCaptains } = require("../utils/helpers");

// Constants for better maintainability
const DISPATCH_STATES = {
  PENDING: 'pending',
  ACTIVE: 'active',
  COMPLETED: 'completed',
  FAILED: 'failed'
};

const RIDE_HIDE_REASONS = {
  RIDE_TAKEN: 'ride_taken',
  DISPATCH_TIMEOUT: 'dispatch_timeout',
  MAX_RADIUS_REACHED: 'max_radius_reached',
  DISPATCH_ERROR: 'dispatch_error',
  EMERGENCY_STOP: 'emergency_stop',
  RADIUS_TIMEOUT: 'timeout'
};

class DispatchService {
  constructor(logger, dependencies) {
    this.logger = logger;
    this.redisClient = dependencies.redisClient;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    this.captainSocketService = dependencies.captainSocketService || null;
    this.customerSocketService = dependencies.customerSocketService || null;

    // Use LRU-like cache with size limit
    this.rideSettings = null;
    this.settingsLastLoaded = 0;
    this.settingsCacheDuration = 60000; // 1 minute cache

    // Optimized tracking with automatic cleanup
    this.rideNotifications = new Map();
    this.currentRadiusNotifications = new Map();
    this.notificationCleanupInterval = null;

    // Performance optimization: batch notifications
    this.notificationQueue = [];
    this.batchNotificationInterval = null;
    
    // Background dispatcher
    this.backgroundIntervalId = null;
  }

  setSocketServices(captainSocketService, customerSocketService) {
    this.captainSocketService = captainSocketService;
    this.customerSocketService = customerSocketService;
    this.logger.info('[DispatchService] Socket services injected.');
  }

  async initialize() {
    await this.loadRideSettings();
    this.startNotificationCleanup();
    this.startBatchNotificationProcessor();
    this.logger.info('[DispatchService] Dispatch service initialized.');
  }

  // Optimized settings loading with caching
  async loadRideSettings(forceReload = false) {
    const now = Date.now();
    
    // Return cached settings if still valid
    if (!forceReload && this.rideSettings && (now - this.settingsLastLoaded < this.settingsCacheDuration)) {
      return this.rideSettings;
    }

    try {
      this.rideSettings = await RideSetting.findOne({ name: "default" }).lean();
      
      if (!this.rideSettings) {
        this.rideSettings = await this.createDefaultSettings();
      }
      
      this.settingsLastLoaded = now;
      this.logger.info('[DispatchService] Ride settings loaded successfully.');
      
      if (!this.validateDispatchSettings()) {
        throw new Error('Invalid dispatch settings');
      }
      
      return this.rideSettings;
    } catch (err) {
      this.logger.error('[DispatchService] Error loading ride settings:', err);
      return this.getDefaultSettings();
    }
  }

  async createDefaultSettings() {
    const defaultSettings = new RideSetting(this.getDefaultSettings());
    await defaultSettings.save();
    return defaultSettings.toObject();
  }

  getDefaultSettings() {
    return {
      dispatch: {
        initialRadiusKm: 2,
        maxRadiusKm: 10,
        radiusIncrementKm: 1,
        notificationTimeout: 15,
        maxDispatchTime: 300,
        graceAfterMaxRadius: 30
      }
    };
  }

  validateDispatchSettings() {
    const { dispatch } = this.rideSettings;
    
    const validations = [
      { condition: dispatch.initialRadiusKm > 0, error: 'Initial radius must be positive' },
      { condition: dispatch.maxRadiusKm > 0, error: 'Max radius must be positive' },
      { condition: dispatch.radiusIncrementKm > 0, error: 'Radius increment must be positive' },
      { condition: dispatch.initialRadiusKm <= dispatch.maxRadiusKm, error: 'Initial radius cannot exceed max radius' },
      { condition: dispatch.notificationTimeout > 0, error: 'Notification timeout must be positive' },
      { condition: dispatch.maxDispatchTime > 0, error: 'Max dispatch time must be positive' }
    ];

    for (const { condition, error } of validations) {
      if (!condition) {
        this.logger.error(`[DispatchService] Validation failed: ${error}`);
        return false;
      }
    }

    return true;
  }

  // Main dispatch method - split into smaller, focused methods
  async dispatchRide(ride, origin) {
    const rideId = ride._id.toString();
    
    try {
      // Initialize dispatch context
      const context = await this.initializeDispatchContext(ride, origin);
      
      // Register cancellation handler
      this.registerCancellation(rideId, context);
      
      // Execute dispatch process
      const result = await this.executeDispatchProcess(context);
      
      // Handle dispatch result
      await this.handleDispatchResult(context, result);
      
    } catch (err) {
      this.logger.error(`[Dispatch] Critical error for ride ${rideId}:`, err);
      await this.handleDispatchError(rideId, err);
    } finally {
      await this.cleanupDispatch(rideId);
    }
  }

  async initializeDispatchContext(ride, origin) {
    const settings = await this.loadRideSettings();
    const passenger = await this.getPassengerInfo(ride.passenger);
    
    return {
      ride,
      rideId: ride._id.toString(),
      origin,
      passenger,
      settings: settings.dispatch,
      startTime: Date.now(),
      notifiedCaptains: new Set(),
      currentRadiusCaptains: new Set(),
      accepted: false,
      cancelled: false,
      currentRadius: settings.dispatch.initialRadiusKm
    };
  }

  async getPassengerInfo(passengerId) {
    return customer.findById(passengerId)
      .select("name phoneNumber")
      .lean()
      .cache(60); // Cache for 60 seconds if your ODM supports it
  }

  registerCancellation(rideId, context) {
    const cancelFunc = () => {
      this.logger.warn(`[Dispatch] Cancellation requested for ride ${rideId}`);
      context.cancelled = true;
    };
    
    this.dispatchProcesses.set(rideId, cancelFunc);
    this.rideNotifications.set(rideId, new Set());
    this.currentRadiusNotifications.set(rideId, new Set());
  }

  async executeDispatchProcess(context) {
    const { settings, rideId } = context;
    
    while (!context.cancelled && !context.accepted && context.currentRadius <= settings.maxRadiusKm) {
      // Check timeouts
      if (this.isDispatchTimedOut(context)) {
        return { status: 'timeout', reason: 'Max dispatch time exceeded' };
      }
      
      // Verify ride status
      const rideStatus = await this.checkRideStatus(rideId);
      if (!rideStatus.valid) {
        return rideStatus;
      }
      
      // Search and notify captains in current radius
      const radiusResult = await this.processRadiusSearch(context);
      
      if (radiusResult.accepted) {
        context.accepted = true;
        return { status: 'accepted', driverId: radiusResult.driverId };
      }
      
      // Expand radius if needed
      if (!context.accepted && !context.cancelled && context.currentRadius < settings.maxRadiusKm) {
        context.currentRadius += settings.radiusIncrementKm;
        await this.delay(2000); // Small delay before expanding
      }
    }
    
    // Handle max radius reached
    if (context.currentRadius > settings.maxRadiusKm && !context.cancelled && !context.accepted) {
      return await this.handleMaxRadiusReached(context);
    }
    
    return { status: 'failed', reason: 'Unknown' };
  }

  isDispatchTimedOut(context) {
    const elapsed = Date.now() - context.startTime;
    const maxTime = context.settings.maxDispatchTime * 1000;
    return elapsed >= maxTime;
  }

  async checkRideStatus(rideId) {
    const ride = await Ride.findById(rideId).select('status').lean();
    
    if (!ride || ride.status !== 'requested') {
      return {
        valid: false,
        status: 'invalid',
        reason: `Ride no longer in requested state (current: ${ride?.status})`
      };
    }
    
    return { valid: true };
  }

  async processRadiusSearch(context) {
    const { rideId, origin, currentRadius, settings } = context;
    
    this.logger.info(`[Dispatch] Ride ${rideId}: Searching radius ${currentRadius}km`);
    
    // Clear current radius tracking
    this.currentRadiusNotifications.set(rideId, new Set());
    
    // Find nearby captains
    const nearbyCaptains = await this.findAvailableCaptains(origin, currentRadius, context.notifiedCaptains);
    
    if (nearbyCaptains.length === 0) {
      this.logger.info(`[Dispatch] No new captains found in radius ${currentRadius}km`);
      return { accepted: false };
    }
    
    // Send notifications
    await this.notifyCaptainsInBatch(nearbyCaptains, context);
    
    // Wait for response
    await this.delay(settings.notificationTimeout * 1000);
    
    // Check if ride was accepted
    const updatedRide = await Ride.findById(rideId).select('status driver').lean();
    
    if (updatedRide?.status === 'accepted') {
      this.queueHideNotifications(rideId, updatedRide.driver);
      return { accepted: true, driverId: updatedRide.driver };
    }
    
    // Hide ride from current radius captains if expanding
    if (currentRadius < settings.maxRadiusKm) {
      this.queueRadiusHideNotifications(rideId, `timeout_radius_${currentRadius}km`);
    }
    
    return { accepted: false };
  }

  async findAvailableCaptains(origin, radius, excludeSet) {
    const allCaptains = await findNearbyCaptains(this.redisClient, this.logger, origin, radius);
    
    // Filter online captains not already notified
    return allCaptains.filter(captainId => 
      this.onlineCaptains[captainId] && !excludeSet.has(captainId)
    );
  }

  async notifyCaptainsInBatch(captainIds, context) {
    const { ride, passenger, rideId } = context;
    
    const notification = {
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
    };
    
    // Process notifications in batches for better performance
    const batchSize = 10;
    const results = [];
    
    for (let i = 0; i < captainIds.length; i += batchSize) {
      const batch = captainIds.slice(i, i + batchSize);
      const batchPromises = batch.map(captainId => this.notifyCaptain(captainId, notification, context));
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);
    }
    
    const successCount = results.filter(r => r.status === 'fulfilled' && r.value).length;
    this.logger.info(`[Dispatch] Notified ${successCount}/${captainIds.length} captains`);
  }

  async notifyCaptain(captainId, notification, context) {
    try {
      if (!this.captainSocketService) {
        throw new Error('Captain socket service not available');
      }
      
      const sent = this.captainSocketService.emitToCaptain(captainId, "newRide", notification);
      
      if (sent) {
        context.notifiedCaptains.add(captainId);
        this.rideNotifications.get(context.rideId).add(captainId);
        this.currentRadiusNotifications.get(context.rideId).add(captainId);
        return true;
      }
      
      return false;
    } catch (err) {
      this.logger.error(`[Dispatch] Failed to notify captain ${captainId}:`, err);
      return false;
    }
  }

  async handleMaxRadiusReached(context) {
    const { rideId, settings } = context;
    const graceTimeout = settings.graceAfterMaxRadius * 1000;
    
    this.logger.warn(`[Dispatch] Ride ${rideId}: Max radius reached, waiting ${graceTimeout/1000}s grace period`);
    
    const graceEnd = Date.now() + graceTimeout;
    
    while (Date.now() < graceEnd && !context.accepted && !context.cancelled) {
      await this.delay(5000);
      
      const ride = await Ride.findById(rideId).select('status driver').lean();
      if (ride?.status === 'accepted') {
        this.queueHideNotifications(rideId, ride.driver);
        return { status: 'accepted', driverId: ride.driver };
      }
    }
    
    return { status: 'not_approved', reason: 'No captain found within max radius' };
  }

  async handleDispatchResult(context, result) {
    const { rideId, startTime } = context;
    
    switch (result.status) {
      case 'accepted':
        this.logger.info(`[Dispatch] Ride ${rideId} accepted by captain ${result.driverId}`);
        break;
        
      case 'timeout':
      case 'not_approved':
        await this.updateRideStatus(rideId, 'notApprove', result.reason);
        this.notifyCustomerRideNotApproved(context, result);
        this.queueHideNotifications(rideId, null, RIDE_HIDE_REASONS.DISPATCH_TIMEOUT);
        break;
        
      case 'invalid':
        this.logger.warn(`[Dispatch] Ride ${rideId} dispatch stopped: ${result.reason}`);
        break;
        
      default:
        this.logger.error(`[Dispatch] Unknown result status: ${result.status}`);
    }
  }

  async updateRideStatus(rideId, status, reason) {
    try {
      await Ride.findByIdAndUpdate(rideId, {
        status,
        isDispatching: false,
        dispatchEndTime: new Date(),
        cancellationReason: reason
      });
      
      this.logger.info(`[DB] Ride ${rideId} status updated to '${status}'`);
    } catch (err) {
      this.logger.error(`[DB] Failed to update ride ${rideId} status:`, err);
    }
  }

  notifyCustomerRideNotApproved(context, result) {
    const { ride, startTime, settings } = context;
    
    this.customerSocketService?.emitToCustomer(ride.passenger, 'rideNotApproved', {
      rideId: ride._id,
      message: 'لم نعثر على كابتن قريب في الوقت الحالي، الرجاء المحاولة مرة أخرى لاحقاً.',
      searchDuration: Math.round((Date.now() - startTime) / 1000),
      maxRadius: settings.maxRadiusKm
    });
  }

  async handleDispatchError(rideId, error) {
    try {
      await this.updateRideStatus(rideId, 'failed', `Dispatch error: ${error.message}`);
      this.queueHideNotifications(rideId, null, RIDE_HIDE_REASONS.DISPATCH_ERROR);
      
      const ride = await Ride.findById(rideId).select('passenger').lean();
      if (ride) {
        this.customerSocketService?.emitToCustomer(ride.passenger, 'rideError', {
          rideId,
          message: 'An error occurred while searching for captains. Please try again.'
        });
      }
    } catch (err) {
      this.logger.error(`[Dispatch] Failed to handle dispatch error for ride ${rideId}:`, err);
    }
  }

  async cleanupDispatch(rideId) {
    // Remove from active processes
    this.dispatchProcesses.delete(rideId);
    
    // Check if ride was accepted before cleaning notifications
    const ride = await Ride.findById(rideId).select('status').lean();
    if (!ride || ride.status !== 'accepted') {
      this.cleanupRideNotifications(rideId);
    }
    
    this.logger.info(`[Dispatch] Cleaned up dispatch for ride ${rideId}`);
  }

  // Notification management with batching
  queueHideNotifications(rideId, excludeCaptainId, reason = RIDE_HIDE_REASONS.RIDE_TAKEN) {
    this.notificationQueue.push({
      type: 'hide',
      rideId,
      excludeCaptainId,
      reason,
      timestamp: Date.now()
    });
  }

  queueRadiusHideNotifications(rideId, reason) {
    this.notificationQueue.push({
      type: 'hideRadius',
      rideId,
      reason,
      timestamp: Date.now()
    });
  }

  startBatchNotificationProcessor() {
    this.batchNotificationInterval = setInterval(() => {
      this.processBatchNotifications();
    }, 100); // Process every 100ms
  }

  async processBatchNotifications() {
    if (this.notificationQueue.length === 0) return;
    
    const batch = this.notificationQueue.splice(0, 50); // Process up to 50 at a time
    
    const hideNotifications = batch.filter(n => n.type === 'hide');
    const radiusNotifications = batch.filter(n => n.type === 'hideRadius');
    
    // Group by rideId for efficiency
    const hideByRide = this.groupBy(hideNotifications, 'rideId');
    const radiusByRide = this.groupBy(radiusNotifications, 'rideId');
    
    // Process hide notifications
    for (const [rideId, notifications] of Object.entries(hideByRide)) {
      const latestNotification = notifications[notifications.length - 1];
      await this.sendHideNotifications(rideId, latestNotification.excludeCaptainId, latestNotification.reason);
    }
    
    // Process radius hide notifications
    for (const [rideId, notifications] of Object.entries(radiusByRide)) {
      const latestNotification = notifications[notifications.length - 1];
      await this.sendRadiusHideNotifications(rideId, latestNotification.reason);
    }
  }

  groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key];
      if (!result[group]) result[group] = [];
      result[group].push(item);
      return result;
    }, {});
  }

  async sendHideNotifications(rideId, excludeCaptainId, reason) {
    const notifiedCaptains = this.rideNotifications.get(rideId);
    if (!notifiedCaptains || notifiedCaptains.size === 0) return;
    
    const captainsToNotify = Array.from(notifiedCaptains).filter(id => id !== excludeCaptainId);
    
    if (captainsToNotify.length === 0) return;
    
    const message = this.getHideMessage(reason);
    const notification = { rideId, reason, message };
    
    // Send in parallel batches
    const batchSize = 20;
    for (let i = 0; i < captainsToNotify.length; i += batchSize) {
      const batch = captainsToNotify.slice(i, i + batchSize);
      await Promise.all(batch.map(captainId => 
        this.captainSocketService?.emitToCaptain(captainId, "hideRide", notification)
      ));
    }
    
    this.cleanupRideNotifications(rideId);
  }

  async sendRadiusHideNotifications(rideId, reason) {
    const currentRadiusCaptains = this.currentRadiusNotifications.get(rideId);
    if (!currentRadiusCaptains || currentRadiusCaptains.size === 0) return;
    
    const captainsToNotify = Array.from(currentRadiusCaptains);
    const message = this.getHideMessage(reason);
    const notification = { rideId, reason, message };
    
    // Send in parallel batches
    const batchSize = 20;
    for (let i = 0; i < captainsToNotify.length; i += batchSize) {
      const batch = captainsToNotify.slice(i, i + batchSize);
      await Promise.all(batch.map(captainId => 
        this.captainSocketService?.emitToCaptain(captainId, "hideRide", notification)
      ));
    }
    
    this.currentRadiusNotifications.set(rideId, new Set());
  }

  getHideMessage(reason) {
    const messages = {
      [RIDE_HIDE_REASONS.RIDE_TAKEN]: 'This ride has been taken by another captain.',
      [RIDE_HIDE_REASONS.DISPATCH_TIMEOUT]: 'This ride request has timed out.',
      [RIDE_HIDE_REASONS.MAX_RADIUS_REACHED]: 'No captain found for this ride.',
      [RIDE_HIDE_REASONS.DISPATCH_ERROR]: 'An error occurred with this ride request.',
      [RIDE_HIDE_REASONS.EMERGENCY_STOP]: 'Dispatch service was stopped.',
      [RIDE_HIDE_REASONS.RADIUS_TIMEOUT]: 'Searching for captains in a wider area.'
    };
    
    if (reason.includes('timeout_radius_')) {
      return messages[RIDE_HIDE_REASONS.RADIUS_TIMEOUT];
    }
    
    return messages[reason] || 'This ride is no longer available.';
  }

  // Background dispatcher with optimizations
  startBackgroundDispatcher() {
    const interval = Math.max(30000, Math.min(120000, (this.rideSettings?.dispatch?.notificationTimeout || 15) * 2000));
    
    this.logger.info(`[Dispatch] Background dispatcher interval: ${interval/1000}s`);
    
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
    }
    
    this.backgroundIntervalId = setInterval(() => {
      this.checkPendingRides();
    }, interval);
  }

  async checkPendingRides() {
    try {
      // Find rides that need dispatch
      const activeRideIds = Array.from(this.dispatchProcesses.keys());
      
      const pendingRides = await Ride.find({
        status: 'requested',
        isDispatching: { $ne: true },
        _id: { $nin: activeRideIds }
      })
      .select('_id createdAt passenger pickupLocation')
      .limit(10) // Process max 10 at a time
      .lean();
      
      if (pendingRides.length === 0) return;
      
      this.logger.info(`[Background] Found ${pendingRides.length} rides needing dispatch`);
      
      // Process rides
      await Promise.all(pendingRides.map(ride => this.processPendingRide(ride)));
      
    } catch (err) {
      this.logger.error("[Background] Error checking pending rides:", err);
    }
  }

  async processPendingRide(ride) {
    try {
      const settings = await this.loadRideSettings();
      const maxAge = (settings.dispatch.maxDispatchTime + settings.dispatch.graceAfterMaxRadius);
      const rideAge = (Date.now() - new Date(ride.createdAt)) / 1000;
      
      if (rideAge > maxAge) {
        await this.expireRide(ride._id, rideAge, maxAge);
        return;
      }
      
      // Mark as dispatching
      await Ride.findByIdAndUpdate(ride._id, { isDispatching: true });
      
      const origin = {
        latitude: ride.pickupLocation.coordinates[1],
        longitude: ride.pickupLocation.coordinates[0],
      };
      
      // Start dispatch (non-blocking)
      this.dispatchRide(ride, origin);
      
    } catch (err) {
      this.logger.error(`[Background] Error processing ride ${ride._id}:`, err);
    }
  }

  async expireRide(rideId, rideAge, maxAge) {
    await this.updateRideStatus(rideId, 'notApprove', `Ride expired - too old (${Math.round(rideAge)}s > ${maxAge}s)`);
    
    const ride = await Ride.findById(rideId).select('passenger').lean();
    if (ride) {
      this.customerSocketService?.emitToCustomer(ride.passenger, 'rideNotApproved', {
        rideId,
        message: 'Your ride request has expired. Please try requesting again.'
      });
    }
  }

  // Cleanup methods
  startNotificationCleanup() {
    // Clean up old notification tracking every 5 minutes
    this.notificationCleanupInterval = setInterval(() => {
      this.cleanupOldNotifications();
    }, 300000);
  }

  cleanupOldNotifications() {
    const maxAge = 600000; // 10 minutes
    const now = Date.now();
    
    for (const [rideId, _] of this.rideNotifications) {
      // Check if ride still exists and is active
      Ride.findById(rideId).select('status updatedAt').lean()
        .then(ride => {
          if (!ride || (now - new Date(ride.updatedAt) > maxAge && ride.status !== 'requested')) {
            this.cleanupRideNotifications(rideId);
          }
        })
        .catch(err => {
          this.logger.error(`[Cleanup] Error checking ride ${rideId}:`, err);
        });
    }
  }

  cleanupRideNotifications(rideId) {
    const rideIdStr = rideId.toString();
    this.rideNotifications.delete(rideIdStr);
    this.currentRadiusNotifications.delete(rideIdStr);
  }

  // Utility methods
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API methods
  stopBackgroundDispatcher() {
    if (this.backgroundIntervalId) {
      clearInterval(this.backgroundIntervalId);
      this.backgroundIntervalId = null;
    }
  }

  async refreshSettings() {
    await this.loadRideSettings(true);
    this.startBackgroundDispatcher();
  }

  getDispatchStats() {
    const settings = this.rideSettings?.dispatch || {};
    
    return {
      activeDispatches: this.dispatchProcesses.size,
      activeRideIds: Array.from(this.dispatchProcesses.keys()),
      trackedNotifications: this.rideNotifications.size,
      queuedNotifications: this.notificationQueue.length,
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

  async emergencyStopAllDispatches() {
    this.logger.warn('[DispatchService] Emergency stop initiated');
    
    // Stop all active dispatches
    const activeRides = Array.from(this.dispatchProcesses.entries());
    
    for (const [rideId, cancelFunc] of activeRides) {
      this.queueHideNotifications(rideId, null, RIDE_HIDE_REASONS.EMERGENCY_STOP);
      cancelFunc();
    }
    
    // Clear all tracking
    this.dispatchProcesses.clear();
    this.rideNotifications.clear();
    this.currentRadiusNotifications.clear();
    this.notificationQueue = [];
    
    // Process any queued notifications
    await this.processBatchNotifications();
    
    this.logger.info('[DispatchService] Emergency stop completed');
  }

  // Cleanup on service shutdown
  async shutdown() {
    this.stopBackgroundDispatcher();
    
    if (this.notificationCleanupInterval) {
      clearInterval(this.notificationCleanupInterval);
    }
    
    if (this.batchNotificationInterval) {
      clearInterval(this.batchNotificationInterval);
    }
    
    // Process remaining notifications
    await this.processBatchNotifications();
    
    this.logger.info('[DispatchService] Service shutdown complete');
  }
}

module.exports = DispatchService;