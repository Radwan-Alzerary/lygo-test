const User = require('../model/user');
const Driver = require('../model/Driver');

/**
 * Location Tracking Service for Monitoring Captain Locations
 * Provides real-time location tracking for administrative users
 * 
 * @class LocationTrackingService
 * @version 1.0.0
 */
class LocationTrackingService {
  constructor(logger, redisClient = null) {
    this.logger = logger;
    this.redisClient = redisClient;
    
    // Active tracking sessions: Map of userId -> socket connections
    this.trackingSessions = new Map();
    
    // Current captain locations cache
    this.captainLocations = new Map(); // captainId -> location data
    
    // Settings
    this.settings = {
      maxTrackingSessions: 10, // Maximum concurrent tracking sessions
      locationUpdateInterval: 5000, // 5 seconds
      locationExpiry: 60000, // 1 minute - expire old locations
      allowedTrackingRoles: ['admin', 'dispatcher', 'manager', 'support'] // Roles allowed to track
    };
    
    this.logger.info('[LocationTrackingService] Location tracking service initialized');
    
    // Start cleanup interval
    this.startLocationCleanup();
  }

  /**
   * Check if user has permission to track captain locations
   * @param {Object} user - User object with role and permissions
   * @returns {boolean} Whether user can track locations
   */
  canTrackLocations(user) {
    if (!user) return false;
    
    // Check if user role is allowed
    if (this.settings.allowedTrackingRoles.includes(user.role)) {
      return true;
    }
    
    // Check specific permissions
    if (user.permissions && user.permissions.includes('location_tracking')) {
      return true;
    }
    
    return false;
  }

  /**
   * Start tracking session for a user
   * @param {string} userId - User ID requesting tracking
   * @param {Object} socket - Socket connection
   * @returns {Object} Session info
   */
  async startTrackingSession(userId, socket) {
    try {
      // Get user details
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // Check permissions
      if (!this.canTrackLocations(user)) {
        throw new Error('Insufficient permissions for location tracking');
      }

      // Check session limits
      if (this.trackingSessions.size >= this.settings.maxTrackingSessions) {
        throw new Error('Maximum tracking sessions reached');
      }

      // Create tracking session
      const sessionId = `track_${userId}_${Date.now()}`;
      const session = {
        sessionId,
        userId,
        userRole: user.role,
        socket,
        startTime: new Date(),
        lastActivity: new Date(),
        isActive: true
      };

      this.trackingSessions.set(sessionId, session);
      
      this.logger.info(`[LocationTracking] Started tracking session for user ${user.name} (${user.role})`);

      // Send current captain locations immediately
      await this.sendCurrentLocations(sessionId);

      return {
        success: true,
        sessionId,
        message: 'Location tracking session started',
        captainCount: this.captainLocations.size
      };

    } catch (error) {
      this.logger.error('[LocationTracking] Error starting tracking session:', error);
      throw error;
    }
  }

  /**
   * Stop tracking session
   * @param {string} sessionId - Session ID to stop
   */
  stopTrackingSession(sessionId) {
    try {
      const session = this.trackingSessions.get(sessionId);
      if (session) {
        session.isActive = false;
        this.trackingSessions.delete(sessionId);
        this.logger.info(`[LocationTracking] Stopped tracking session ${sessionId}`);
      }
    } catch (error) {
      this.logger.error('[LocationTracking] Error stopping tracking session:', error);
    }
  }

  /**
   * Update captain location
   * @param {string} captainId - Captain ID
   * @param {Object} locationData - Location information
   */
  async updateCaptainLocation(captainId, locationData) {
    try {
      // Validate location data
      if (!locationData.latitude || !locationData.longitude) {
        return;
      }

      // Get captain details
      const captain = await Driver.findById(captainId).select('name phone isOnline status');
      if (!captain) {
        return;
      }

      // Prepare location update
      const locationUpdate = {
        captainId,
        captainName: captain.name,
        captainPhone: captain.phone,
        latitude: parseFloat(locationData.latitude),
        longitude: parseFloat(locationData.longitude),
        accuracy: locationData.accuracy || null,
        heading: locationData.heading || null,
        speed: locationData.speed || null,
        altitude: locationData.altitude || null,
        isOnline: captain.isOnline,
        status: captain.status,
        timestamp: new Date(),
        lastUpdate: Date.now()
      };

      // Store in cache
      this.captainLocations.set(captainId, locationUpdate);

      // Store in Redis for persistence (optional)
      if (this.redisClient) {
        const redisKey = `captain_location:${captainId}`;
        await this.redisClient.setex(redisKey, 300, JSON.stringify(locationUpdate)); // 5 min expiry
      }

      // Broadcast to all active tracking sessions
      this.broadcastLocationUpdate(locationUpdate);

    } catch (error) {
      this.logger.error('[LocationTracking] Error updating captain location:', error);
    }
  }

  /**
   * Remove captain location (when captain goes offline)
   * @param {string} captainId - Captain ID
   */
  async removeCaptainLocation(captainId) {
    try {
      this.captainLocations.delete(captainId);

      // Remove from Redis
      if (this.redisClient) {
        const redisKey = `captain_location:${captainId}`;
        await this.redisClient.del(redisKey);
      }

      // Broadcast removal to tracking sessions
      this.broadcastLocationRemoval(captainId);

      this.logger.debug(`[LocationTracking] Removed location for captain ${captainId}`);
    } catch (error) {
      this.logger.error('[LocationTracking] Error removing captain location:', error);
    }
  }

  /**
   * Broadcast location update to all tracking sessions
   * @param {Object} locationUpdate - Location data
   */
  broadcastLocationUpdate(locationUpdate) {
    this.trackingSessions.forEach((session) => {
      if (session.isActive && session.socket) {
        try {
          session.socket.emit('captain_location_update', {
            type: 'location_update',
            data: locationUpdate
          });
          session.lastActivity = new Date();
        } catch (error) {
          this.logger.warn(`[LocationTracking] Error broadcasting to session ${session.sessionId}:`, error);
          // Remove broken session
          this.stopTrackingSession(session.sessionId);
        }
      }
    });
  }

  /**
   * Broadcast location removal to all tracking sessions
   * @param {string} captainId - Captain ID
   */
  broadcastLocationRemoval(captainId) {
    this.trackingSessions.forEach((session) => {
      if (session.isActive && session.socket) {
        try {
          session.socket.emit('captain_location_update', {
            type: 'location_removed',
            captainId
          });
          session.lastActivity = new Date();
        } catch (error) {
          this.logger.warn(`[LocationTracking] Error broadcasting removal to session ${session.sessionId}:`, error);
          this.stopTrackingSession(session.sessionId);
        }
      }
    });
  }

  /**
   * Send current locations to a specific tracking session
   * @param {string} sessionId - Session ID
   */
  async sendCurrentLocations(sessionId) {
    try {
      const session = this.trackingSessions.get(sessionId);
      if (!session || !session.isActive) {
        return;
      }

      const currentLocations = Array.from(this.captainLocations.values());
      
      session.socket.emit('captain_locations_initial', {
        type: 'initial_locations',
        data: currentLocations,
        count: currentLocations.length,
        timestamp: new Date()
      });

      this.logger.debug(`[LocationTracking] Sent ${currentLocations.length} initial locations to session ${sessionId}`);
    } catch (error) {
      this.logger.error('[LocationTracking] Error sending current locations:', error);
    }
  }

  /**
   * Get tracking statistics
   * @returns {Object} Tracking stats
   */
  getTrackingStats() {
    const activeSessions = Array.from(this.trackingSessions.values()).filter(s => s.isActive);
    
    return {
      activeSessions: activeSessions.length,
      maxSessions: this.settings.maxTrackingSessions,
      trackedCaptains: this.captainLocations.size,
      sessionDetails: activeSessions.map(s => ({
        sessionId: s.sessionId,
        userId: s.userId,
        role: s.userRole,
        startTime: s.startTime,
        lastActivity: s.lastActivity
      }))
    };
  }

  /**
   * Start cleanup interval for expired locations
   */
  startLocationCleanup() {
    setInterval(() => {
      this.cleanupExpiredLocations();
      this.cleanupInactiveSessions();
    }, this.settings.locationUpdateInterval);
  }

  /**
   * Clean up expired locations
   */
  cleanupExpiredLocations() {
    const now = Date.now();
    const expiredCaptains = [];

    this.captainLocations.forEach((location, captainId) => {
      if (now - location.lastUpdate > this.settings.locationExpiry) {
        expiredCaptains.push(captainId);
      }
    });

    expiredCaptains.forEach(captainId => {
      this.captainLocations.delete(captainId);
      this.broadcastLocationRemoval(captainId);
    });

    if (expiredCaptains.length > 0) {
      this.logger.debug(`[LocationTracking] Cleaned up ${expiredCaptains.length} expired locations`);
    }
  }

  /**
   * Clean up inactive tracking sessions
   */
  cleanupInactiveSessions() {
    const now = Date.now();
    const inactiveSessions = [];

    this.trackingSessions.forEach((session, sessionId) => {
      // Remove sessions inactive for more than 30 minutes
      if (now - session.lastActivity.getTime() > 1800000) {
        inactiveSessions.push(sessionId);
      }
    });

    inactiveSessions.forEach(sessionId => {
      this.stopTrackingSession(sessionId);
    });

    if (inactiveSessions.length > 0) {
      this.logger.debug(`[LocationTracking] Cleaned up ${inactiveSessions.length} inactive sessions`);
    }
  }

  /**
   * Get all tracked captain locations
   * @returns {Array} Current captain locations
   */
  getAllTrackedLocations() {
    return Array.from(this.captainLocations.values());
  }

  /**
   * Get specific captain location
   * @param {string} captainId - Captain ID
   * @returns {Object|null} Captain location data
   */
  getCaptainLocation(captainId) {
    return this.captainLocations.get(captainId) || null;
  }
}

module.exports = LocationTrackingService;
