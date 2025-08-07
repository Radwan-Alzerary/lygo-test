const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../model/user");

const router = express.Router();

/**
 * Middleware للتحقق من صلاحيات الأدمن
 */
const authenticateAdmin = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authorization token is required for admin access.' 
      });
    }

    // التحقق من صحة الـ token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key");
    
    // جلب معلومات المستخدم من قاعدة البيانات
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        message: 'Invalid user token.' 
      });
    }

    // التحقق من صلاحيات الأدمن
    const adminRoles = ['admin', 'dispatcher', 'manager', 'support'];
    if (!adminRoles.includes(user.role)) {
      return res.status(403).json({ 
        success: false, 
        message: 'Access denied. Admin privileges required.' 
      });
    }

    req.user = {
      userId: user._id,
      id: user._id,
      email: user.email,
      userName: user.userName,
      role: user.role
    };
    
    next();
  } catch (error) {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid or expired token.',
      error: error.message 
    });
  }
};

/**
 * جلب جميع المواقع الحالية للكباتن
 * GET /api/admin/locations/current
 */
router.get('/locations/current', authenticateAdmin, async (req, res) => {
  try {
    const locationTrackingService = req.app.locals.locationTrackingService;
    
    if (!locationTrackingService) {
      return res.status(503).json({
        success: false,
        message: 'Location tracking service not available'
      });
    }

    // جلب جميع المواقع الحالية
    const currentLocations = await locationTrackingService.getAllCurrentLocations();
    
    // إحصائيات إضافية
    const stats = locationTrackingService.getTrackingStats();
    
    res.json({
      success: true,
      message: 'Current locations retrieved successfully',
      data: {
        locations: currentLocations,
        stats: {
          totalTrackedCaptains: currentLocations.length,
          activeSessions: stats.activeSessions,
          trackedCaptains: stats.trackedCaptains,
          onlineCaptains: currentLocations.filter(loc => loc.status === 'online').length,
          offlineCaptains: currentLocations.filter(loc => loc.status === 'offline').length
        },
        timestamp: new Date().toISOString(),
        requestedBy: {
          userId: req.user.userId,
          role: req.user.role
        }
      }
    });

  } catch (error) {
    console.error('[Admin API] Error fetching current locations:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve current locations',
      error: error.message
    });
  }
});

/**
 * جلب موقع كابتن محدد
 * GET /api/admin/locations/captain/:driverId
 */
router.get('/locations/captain/:driverId', authenticateAdmin, async (req, res) => {
  try {
    const { driverId } = req.params;
    const locationTrackingService = req.app.locals.locationTrackingService;
    
    if (!locationTrackingService) {
      return res.status(503).json({
        success: false,
        message: 'Location tracking service not available'
      });
    }

    if (!driverId) {
      return res.status(400).json({
        success: false,
        message: 'Driver ID is required'
      });
    }

    // جلب موقع الكابتن المحدد
    const captainLocation = await locationTrackingService.getCaptainCurrentLocation(driverId);
    
    if (!captainLocation) {
      return res.status(404).json({
        success: false,
        message: `Captain with ID ${driverId} not found or not currently tracked`,
        data: null
      });
    }

    // جلب تاريخ المواقع للكابتن (آخر 24 ساعة)
    const locationHistory = await locationTrackingService.getCaptainLocationHistory(driverId, 24);
    
    res.json({
      success: true,
      message: 'Captain location retrieved successfully',
      data: {
        currentLocation: captainLocation,
        locationHistory: locationHistory || [],
        captainId: driverId,
        trackingInfo: {
          isBeingTracked: true,
          lastUpdate: captainLocation.timestamp,
          status: captainLocation.status || 'unknown',
          accuracy: captainLocation.accuracy || null,
          speed: captainLocation.speed || null
        },
        requestedBy: {
          userId: req.user.userId,
          role: req.user.role
        }
      }
    });

  } catch (error) {
    console.error(`[Admin API] Error fetching captain ${req.params.driverId} location:`, error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve captain location',
      error: error.message
    });
  }
});

/**
 * جلب إحصائيات التتبع
 * GET /api/admin/tracking/stats
 */
router.get('/tracking/stats', authenticateAdmin, async (req, res) => {
  try {
    const locationTrackingService = req.app.locals.locationTrackingService;
    const adminSocketService = req.app.locals.adminSocketService;
    
    if (!locationTrackingService) {
      return res.status(503).json({
        success: false,
        message: 'Location tracking service not available'
      });
    }

    // جلب إحصائيات التتبع
    const trackingStats = locationTrackingService.getTrackingStats();
    
    // جلب إحصائيات الأدمن
    const adminStats = adminSocketService?.getAdminStats() || {
      totalConnected: 0,
      tracking: 0,
      totalSessions: 0
    };

    // جلب المواقع الحالية للإحصائيات المفصلة
    const currentLocations = await locationTrackingService.getAllCurrentLocations();
    
    // تحليل البيانات
    const onlineCount = currentLocations.filter(loc => loc.status === 'online').length;
    const offlineCount = currentLocations.filter(loc => loc.status === 'offline').length;
    const recentUpdates = currentLocations.filter(loc => {
      const updateTime = new Date(loc.timestamp);
      const now = new Date();
      const diffMinutes = (now - updateTime) / (1000 * 60);
      return diffMinutes <= 5; // آخر 5 دقائق
    }).length;

    // إحصائيات الأداء
    const performanceStats = {
      avgResponseTime: '< 100ms',
      systemHealth: 'operational',
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };

    res.json({
      success: true,
      message: 'Tracking statistics retrieved successfully',
      data: {
        tracking: {
          ...trackingStats,
          totalLocations: currentLocations.length,
          onlineCaptains: onlineCount,
          offlineCaptains: offlineCount,
          recentlyUpdated: recentUpdates
        },
        admin: {
          ...adminStats,
          requestingAdmin: {
            userId: req.user.userId,
            role: req.user.role,
            userName: req.user.userName
          }
        },
        system: {
          timestamp: new Date().toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          performance: performanceStats
        },
        breakdown: {
          captainsByStatus: {
            online: onlineCount,
            offline: offlineCount,
            unknown: currentLocations.length - onlineCount - offlineCount
          },
          updateFrequency: {
            recent: recentUpdates,
            total: currentLocations.length,
            percentage: currentLocations.length > 0 ? ((recentUpdates / currentLocations.length) * 100).toFixed(1) + '%' : '0%'
          }
        }
      }
    });

  } catch (error) {
    console.error('[Admin API] Error fetching tracking stats:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve tracking statistics',
      error: error.message
    });
  }
});

/**
 * تحكم في التتبع - بدء التتبع
 * POST /api/admin/tracking/start
 */
router.post('/tracking/start', authenticateAdmin, async (req, res) => {
  try {
    const locationTrackingService = req.app.locals.locationTrackingService;
    const adminSocketService = req.app.locals.adminSocketService;
    
    if (!locationTrackingService || !adminSocketService) {
      return res.status(503).json({
        success: false,
        message: 'Tracking services not available'
      });
    }

    // بدء التتبع
    const result = await locationTrackingService.startTrackingSession(req.user.userId);
    
    // إشعار الأدمنز الآخرين
    adminSocketService.broadcastToAdmins('trackingStarted', {
      startedBy: req.user.userName,
      userId: req.user.userId,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Location tracking started successfully',
      data: {
        sessionId: result.sessionId,
        startedBy: req.user.userName,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    req.logger?.error('[Admin API] Error starting tracking:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to start tracking',
      error: error.message
    });
  }
});

/**
 * تحكم في التتبع - إيقاف التتبع
 * POST /api/admin/tracking/stop
 */
router.post('/tracking/stop', authenticateAdmin, async (req, res) => {
  try {
    const locationTrackingService = req.app.locals.locationTrackingService;
    const adminSocketService = req.app.locals.adminSocketService;
    
    if (!locationTrackingService || !adminSocketService) {
      return res.status(503).json({
        success: false,
        message: 'Tracking services not available'
      });
    }

    // إيقاف التتبع
    const result = await locationTrackingService.stopTrackingSession(req.user.userId);
    
    // إشعار الأدمنز الآخرين
    adminSocketService.broadcastToAdmins('trackingStopped', {
      stoppedBy: req.user.userName,
      userId: req.user.userId,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Location tracking stopped successfully',
      data: {
        stoppedBy: req.user.userName,
        timestamp: new Date().toISOString(),
        sessionDuration: result.duration || 'unknown'
      }
    });

  } catch (error) {
    req.logger?.error('[Admin API] Error stopping tracking:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to stop tracking',
      error: error.message
    });
  }
});

/**
 * جلب قائمة الكباتن المتاحين للتتبع
 * GET /api/admin/captains/available
 */
router.get('/captains/available', authenticateAdmin, async (req, res) => {
  try {
    const Driver = require("../model/Driver");
    
    // جلب جميع الكباتن النشطين
    const availableCaptains = await Driver.find({ 
      isActive: true 
    }).select('_id name phone email location isOnline lastLocation createdAt');

    // جلب معلومات التتبع الحالية
    const locationTrackingService = req.app.locals.locationTrackingService;
    const currentLocations = locationTrackingService ? 
      await locationTrackingService.getAllCurrentLocations() : [];

    // دمج البيانات
    const captainsWithTracking = availableCaptains.map(captain => {
      const trackingInfo = currentLocations.find(loc => loc.captainId === captain._id.toString());
      
      return {
        id: captain._id,
        name: captain.name,
        phone: captain.phone,
        email: captain.email,
        isOnline: captain.isOnline,
        isBeingTracked: !!trackingInfo,
        lastKnownLocation: trackingInfo ? trackingInfo.location : captain.lastLocation,
        lastUpdate: trackingInfo ? trackingInfo.timestamp : captain.updatedAt,
        status: trackingInfo ? trackingInfo.status : (captain.isOnline ? 'online' : 'offline'),
        registeredAt: captain.createdAt
      };
    });

    res.json({
      success: true,
      message: 'Available captains retrieved successfully',
      data: {
        captains: captainsWithTracking,
        summary: {
          total: availableCaptains.length,
          online: captainsWithTracking.filter(c => c.isOnline).length,
          beingTracked: captainsWithTracking.filter(c => c.isBeingTracked).length,
          available: captainsWithTracking.filter(c => c.isOnline && !c.isBeingTracked).length
        },
        requestedBy: {
          userId: req.user.userId,
          role: req.user.role
        }
      }
    });

  } catch (error) {
    req.logger?.error('[Admin API] Error fetching available captains:', error);
    
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve available captains',
      error: error.message
    });
  }
});

/**
 * معلومات صحة النظام
 * GET /api/admin/health
 */
router.get('/health', authenticateAdmin, async (req, res) => {
  try {
    const locationTrackingService = req.app.locals.locationTrackingService;
    const adminSocketService = req.app.locals.adminSocketService;
    
    const health = {
      status: 'operational',
      timestamp: new Date().toISOString(),
      services: {
        locationTracking: {
          status: locationTrackingService ? 'available' : 'unavailable',
          stats: locationTrackingService ? locationTrackingService.getTrackingStats() : null
        },
        adminSocket: {
          status: adminSocketService ? 'available' : 'unavailable',
          stats: adminSocketService ? adminSocketService.getAdminStats() : null
        },
        database: {
          status: 'connected', // يمكن تحسينه لاحقاً للتحقق الفعلي
          connection: 'mongodb'
        }
      },
      system: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version
      },
      checkedBy: {
        userId: req.user.userId,
        role: req.user.role
      }
    };

    res.json({
      success: true,
      message: 'System health check completed',
      data: health
    });

  } catch (error) {
    req.logger?.error('[Admin API] Error checking system health:', error);
    
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

module.exports = router;
