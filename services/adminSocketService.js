const jwt = require('jsonwebtoken');
const User = require('../model/user');

/**
 * Admin Socket Service for Location Tracking
 * Handles socket connections for administrative users to track captain locations
 * 
 * @class AdminSocketService
 * @version 1.0.0
 */
class AdminSocketService {
  constructor(io, logger, shared) {
    this.io = io;
    this.logger = logger;
    this.shared = shared;
    
    // Admin namespace for location tracking
    this.adminNamespace = this.io.of('/admin');
    
    // Connected admin users
    this.connectedAdmins = new Map(); // socketId -> user info
    
    this.logger.info('[AdminSocketService] Admin socket service initialized');
  }

  /**
   * Initialize admin socket service
   */
  async initialize() {
    try {
      await this.setupAdminNamespace();
      this.logger.info('[AdminSocketService] Admin socket service ready');
    } catch (error) {
      this.logger.error('[AdminSocketService] Failed to initialize:', error);
      throw error;
    }
  }

  /**
   * Setup admin namespace with authentication and event handlers
   */
  async setupAdminNamespace() {
    // Authentication middleware for admin namespace
    this.adminNamespace.use(async (socket, next) => {
      try {
        const token = socket.handshake.auth?.token || socket.handshake.query?.token;
        
        if (!token) {
          return next(new Error('Authentication token required'));
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        const user = await User.findById(decoded.userId);
        
        if (!user) {
          return next(new Error('Invalid user'));
        }

        // Check if user has admin/tracking permissions
        const hasPermission = this.shared.locationTrackingService?.canTrackLocations(user);
        if (!hasPermission) {
          return next(new Error('Insufficient permissions for location tracking'));
        }

        // Attach user to socket
        socket.userId = user._id.toString();
        socket.userRole = user.role;
        socket.userName = user.userName;
        socket.user = user;

        next();
      } catch (error) {
        this.logger.warn('[AdminSocket] Authentication failed:', error.message);
        next(new Error('Authentication failed'));
      }
    });

    // Handle admin connections
    this.adminNamespace.on('connection', (socket) => {
      this.handleAdminConnection(socket);
    });
  }

  /**
   * Handle new admin connection
   * @param {Socket} socket - Admin socket connection
   */
  async handleAdminConnection(socket) {
    try {
      const adminInfo = {
        socketId: socket.id,
        userId: socket.userId,
        userName: socket.userName,
        userRole: socket.userRole,
        connectedAt: new Date(),
        isTracking: false,
        trackingSessionId: null
      };

      this.connectedAdmins.set(socket.id, adminInfo);
      
      this.logger.info(`[AdminSocket] Admin connected: ${adminInfo.userName} (${adminInfo.userRole}) - Socket: ${socket.id}`);

      // Send connection confirmation
      socket.emit('admin_connected', {
        success: true,
        message: 'Connected to admin tracking system',
        userInfo: {
          name: adminInfo.userName,
          role: adminInfo.userRole,
          permissions: ['location_tracking']
        },
        stats: this.shared.locationTrackingService?.getTrackingStats() || {}
      });

      // Setup event handlers
      this.setupAdminEventHandlers(socket);

    } catch (error) {
      this.logger.error('[AdminSocket] Error handling admin connection:', error);
      socket.emit('error', { message: 'Connection setup failed' });
    }
  }

  /**
   * Setup event handlers for admin socket
   * @param {Socket} socket - Admin socket
   */
  setupAdminEventHandlers(socket) {
    // Start location tracking
    socket.on('start_location_tracking', async (data) => {
      await this.handleStartTracking(socket, data);
    });

    // Stop location tracking
    socket.on('stop_location_tracking', async (data) => {
      await this.handleStopTracking(socket, data);
    });

    // Get current captain locations
    socket.on('get_current_locations', async () => {
      await this.handleGetCurrentLocations(socket);
    });

    // Get tracking statistics
    socket.on('get_tracking_stats', () => {
      this.handleGetTrackingStats(socket);
    });

    // Focus on specific captain
    socket.on('focus_captain', (data) => {
      this.handleFocusCaptain(socket, data);
    });

    // Handle disconnection
    socket.on('disconnect', (reason) => {
      this.handleAdminDisconnection(socket, reason);
    });

    // Handle errors
    socket.on('error', (error) => {
      this.logger.warn(`[AdminSocket] Socket error for ${socket.userName}:`, error);
    });
  }

  /**
   * Handle start location tracking request
   * @param {Socket} socket - Admin socket
   * @param {Object} data - Request data
   */
  async handleStartTracking(socket, data = {}) {
    try {
      const adminInfo = this.connectedAdmins.get(socket.id);
      if (!adminInfo) {
        socket.emit('tracking_error', { message: 'Admin session not found' });
        return;
      }

      if (adminInfo.isTracking) {
        socket.emit('tracking_response', { 
          success: false, 
          message: 'Already tracking locations' 
        });
        return;
      }

      // Start tracking session
      const result = await this.shared.locationTrackingService.startTrackingSession(
        adminInfo.userId, 
        socket
      );

      // Update admin info
      adminInfo.isTracking = true;
      adminInfo.trackingSessionId = result.sessionId;

      socket.emit('tracking_response', {
        success: true,
        message: 'Location tracking started',
        sessionId: result.sessionId,
        captainCount: result.captainCount
      });

      this.logger.info(`[AdminSocket] ${adminInfo.userName} started location tracking`);

    } catch (error) {
      this.logger.error('[AdminSocket] Error starting tracking:', error);
      socket.emit('tracking_error', { 
        message: error.message || 'Failed to start location tracking' 
      });
    }
  }

  /**
   * Handle stop location tracking request
   * @param {Socket} socket - Admin socket
   * @param {Object} data - Request data
   */
  async handleStopTracking(socket, data = {}) {
    try {
      const adminInfo = this.connectedAdmins.get(socket.id);
      if (!adminInfo) {
        return;
      }

      if (!adminInfo.isTracking) {
        socket.emit('tracking_response', { 
          success: false, 
          message: 'Not currently tracking' 
        });
        return;
      }

      // Stop tracking session
      if (adminInfo.trackingSessionId) {
        this.shared.locationTrackingService.stopTrackingSession(adminInfo.trackingSessionId);
      }

      // Update admin info
      adminInfo.isTracking = false;
      adminInfo.trackingSessionId = null;

      socket.emit('tracking_response', {
        success: true,
        message: 'Location tracking stopped'
      });

      this.logger.info(`[AdminSocket] ${adminInfo.userName} stopped location tracking`);

    } catch (error) {
      this.logger.error('[AdminSocket] Error stopping tracking:', error);
      socket.emit('tracking_error', { 
        message: 'Failed to stop location tracking' 
      });
    }
  }

  /**
   * Handle get current locations request
   * @param {Socket} socket - Admin socket
   */
  async handleGetCurrentLocations(socket) {
    try {
      const locations = this.shared.locationTrackingService?.getAllTrackedLocations() || [];
      
      socket.emit('current_locations', {
        success: true,
        locations,
        count: locations.length,
        timestamp: new Date()
      });

    } catch (error) {
      this.logger.error('[AdminSocket] Error getting current locations:', error);
      socket.emit('locations_error', { 
        message: 'Failed to get current locations' 
      });
    }
  }

  /**
   * Handle get tracking statistics request
   * @param {Socket} socket - Admin socket
   */
  handleGetTrackingStats(socket) {
    try {
      const stats = this.shared.locationTrackingService?.getTrackingStats() || {};
      const adminStats = {
        connectedAdmins: this.connectedAdmins.size,
        trackingAdmins: Array.from(this.connectedAdmins.values()).filter(a => a.isTracking).length
      };

      socket.emit('tracking_stats', {
        success: true,
        locationStats: stats,
        adminStats,
        timestamp: new Date()
      });

    } catch (error) {
      this.logger.error('[AdminSocket] Error getting tracking stats:', error);
      socket.emit('stats_error', { 
        message: 'Failed to get tracking statistics' 
      });
    }
  }

  /**
   * Handle focus on specific captain
   * @param {Socket} socket - Admin socket
   * @param {Object} data - Captain focus data
   */
  handleFocusCaptain(socket, data) {
    try {
      const { captainId } = data;
      if (!captainId) {
        socket.emit('focus_error', { message: 'Captain ID required' });
        return;
      }

      const captainLocation = this.shared.locationTrackingService?.getCaptainLocation(captainId);
      
      if (!captainLocation) {
        socket.emit('focus_error', { message: 'Captain location not found' });
        return;
      }

      socket.emit('captain_focused', {
        success: true,
        captain: captainLocation,
        timestamp: new Date()
      });

      const adminInfo = this.connectedAdmins.get(socket.id);
      this.logger.info(`[AdminSocket] ${adminInfo?.userName} focused on captain ${captainId}`);

    } catch (error) {
      this.logger.error('[AdminSocket] Error focusing captain:', error);
      socket.emit('focus_error', { 
        message: 'Failed to focus on captain' 
      });
    }
  }

  /**
   * Handle admin disconnection
   * @param {Socket} socket - Admin socket
   * @param {string} reason - Disconnection reason
   */
  handleAdminDisconnection(socket, reason) {
    try {
      const adminInfo = this.connectedAdmins.get(socket.id);
      
      if (adminInfo) {
        // Stop tracking session if active
        if (adminInfo.isTracking && adminInfo.trackingSessionId) {
          this.shared.locationTrackingService?.stopTrackingSession(adminInfo.trackingSessionId);
        }

        this.connectedAdmins.delete(socket.id);
        
        this.logger.info(`[AdminSocket] Admin disconnected: ${adminInfo.userName} - Reason: ${reason}`);
      }

    } catch (error) {
      this.logger.error('[AdminSocket] Error handling admin disconnection:', error);
    }
  }

  /**
   * Broadcast message to all connected admins
   * @param {string} event - Event name
   * @param {Object} data - Event data
   */
  broadcastToAdmins(event, data) {
    try {
      this.adminNamespace.emit(event, data);
    } catch (error) {
      this.logger.error('[AdminSocket] Error broadcasting to admins:', error);
    }
  }

  /**
   * Get connected admin statistics
   * @returns {Object} Admin connection stats
   */
  getAdminStats() {
    const admins = Array.from(this.connectedAdmins.values());
    
    return {
      totalConnected: admins.length,
      tracking: admins.filter(a => a.isTracking).length,
      byRole: admins.reduce((acc, admin) => {
        acc[admin.userRole] = (acc[admin.userRole] || 0) + 1;
        return acc;
      }, {}),
      sessions: admins.map(a => ({
        userId: a.userId,
        userName: a.userName,
        role: a.userRole,
        connectedAt: a.connectedAt,
        isTracking: a.isTracking
      }))
    };
  }
}

module.exports = AdminSocketService;
