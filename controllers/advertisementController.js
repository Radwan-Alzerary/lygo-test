// controllers/advertisementController.js
const Advertisement = require('../model/Advertisement');
const mongoose = require('mongoose');

// Helper function to build filter object
const buildFilters = (query) => {
  const filters = {};
  
  if (query.search) {
    filters.$text = { $search: query.search };
  }
  
  if (query.isActive !== undefined) {
    filters.isActive = query.isActive === 'true';
  }
  
  if (query.category) {
    filters.category = query.category;
  }
  
  if (query.priority !== undefined) {
    filters.priority = { $gte: parseInt(query.priority) };
  }
  
  if (query.tags) {
    const tagArray = Array.isArray(query.tags) ? query.tags : [query.tags];
    filters.tags = { $in: tagArray };
  }
  
  if (query.startDate || query.endDate) {
    filters.createdAt = {};
    if (query.startDate) filters.createdAt.$gte = new Date(query.startDate);
    if (query.endDate) filters.createdAt.$lte = new Date(query.endDate);
  }
  
  return filters;
};

// Helper function to build sort object
const buildSort = (sortBy = 'createdAt', sortOrder = 'desc') => {
  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;
  return sort;
};

// @desc    Get all advertisements
// @route   GET /api/advertisements
// @access  Public
const getAdvertisements = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filters and sort
    const filters = buildFilters(req.query);
    const sort = buildSort(sortBy, sortOrder);

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);

    // Execute query with pagination
    const [advertisements, total] = await Promise.all([
      Advertisement.find(filters)
        .sort(sort)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Advertisement.countDocuments(filters)
    ]);

    const pages = Math.ceil(total / limitNum);

    res.status(200).json({
      success: true,
      data: advertisements,
      pagination: {
        page: parseInt(page),
        limit: limitNum,
        total,
        pages,
        hasNextPage: page < pages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Error fetching advertisements:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب الإعلانات',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Get advertisement statistics
// @route   GET /api/advertisements/stats
// @access  Public
const getAdvertisementStats = async (req, res) => {
  try {
    const stats = await Advertisement.aggregate([
      {
        $group: {
          _id: null,
          totalAds: { $sum: 1 },
          activeAds: {
            $sum: { $cond: [{ $eq: ['$isActive', true] }, 1, 0] }
          },
          totalClicks: { $sum: '$clickCount' },
          totalImpressions: { $sum: '$impressions' },
          avgCtr: { $avg: '$ctr' },
          totalBudgetSpent: { $sum: '$budget.spent' },
          avgPerformanceScore: { $avg: '$performanceScore' }
        }
      }
    ]);

    const result = stats[0] || {
      totalAds: 0,
      activeAds: 0,
      totalClicks: 0,
      totalImpressions: 0,
      avgCtr: 0,
      totalBudgetSpent: 0,
      avgPerformanceScore: 0
    };

    // Calculate overall CTR
    const overallCTR = result.totalImpressions > 0 
      ? Math.round((result.totalClicks / result.totalImpressions) * 100 * 100) / 100 
      : 0;

    // Get additional insights
    const [topPerformers, expiringSoon, categoryStats] = await Promise.all([
      Advertisement.getTopPerformers(5),
      Advertisement.getExpiringSoon(7),
      Advertisement.aggregate([
        { $match: { isActive: true } },
        { $group: { _id: '$category', count: { $sum: 1 }, totalClicks: { $sum: '$clickCount' } } },
        { $sort: { count: -1 } }
      ])
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalAds: result.totalAds,
          activeAds: result.activeAds,
          inactiveAds: result.totalAds - result.activeAds,
          totalClicks: result.totalClicks,
          totalImpressions: result.totalImpressions,
          overallCTR,
          averageCTR: Math.round(result.avgCtr * 100) / 100,
          totalBudgetSpent: result.totalBudgetSpent || 0,
          avgPerformanceScore: Math.round(result.avgPerformanceScore || 0)
        },
        insights: {
          topPerformers: topPerformers.map(ad => ({
            id: ad._id,
            name: ad.name,
            title: ad.title,
            ctr: ad.ctr,
            clickCount: ad.clickCount,
            performanceScore: ad.performanceScore
          })),
          expiringSoon: expiringSoon.map(ad => ({
            id: ad._id,
            name: ad.name,
            title: ad.title,
            endDate: ad.endDate,
            daysLeft: Math.ceil((ad.endDate - new Date()) / (1000 * 60 * 60 * 24))
          })),
          categoryStats: categoryStats.map(cat => ({
            category: cat._id,
            count: cat.count,
            totalClicks: cat.totalClicks,
            avgClicksPerAd: Math.round(cat.totalClicks / cat.count)
          }))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب الإحصائيات',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Get single advertisement
// @route   GET /api/advertisements/:id
// @access  Public
const getAdvertisementById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الإعلان غير صحيح'
      });
    }

    const advertisement = await Advertisement.findById(id);
    
    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'الإعلان غير موجود'
      });
    }

    res.status(200).json({
      success: true,
      data: advertisement
    });
  } catch (error) {
    console.error('Error fetching advertisement:', error);
    res.status(500).json({
      success: false,
      message: 'حدث خطأ في جلب الإعلان',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Create new advertisement
// @route   POST /api/advertisements
// @access  Private
const createAdvertisement = async (req, res) => {
  try {
    const advertisementData = req.body;
    
    // Add metadata
    if (req.user) {
      advertisementData.metadata = {
        ...advertisementData.metadata,
        createdBy: req.user.id || req.user.name || 'System'
      };
    }

    const advertisement = new Advertisement(advertisementData);
    await advertisement.save();

    res.status(201).json({
      success: true,
      data: advertisement,
      message: 'تم إنشاء الإعلان بنجاح'
    });
  } catch (error) {
    console.error('Error creating advertisement:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'فشل في إنشاء الإعلان',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Update advertisement
// @route   PUT /api/advertisements/:id
// @access  Private
const updateAdvertisement = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الإعلان غير صحيح'
      });
    }

    // Add metadata
    if (req.user) {
      req.body.metadata = {
        ...req.body.metadata,
        updatedBy: req.user.id || req.user.name || 'System'
      };
    }

    const advertisement = await Advertisement.findByIdAndUpdate(
      id,
      req.body,
      { 
        new: true, 
        runValidators: true,
        context: 'query'
      }
    );

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'الإعلان غير موجود'
      });
    }

    res.status(200).json({
      success: true,
      data: advertisement,
      message: 'تم تحديث الإعلان بنجاح'
    });
  } catch (error) {
    console.error('Error updating advertisement:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'بيانات غير صحيحة',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'فشل في تحديث الإعلان',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Delete advertisement
// @route   DELETE /api/advertisements/:id
// @access  Private
const deleteAdvertisement = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الإعلان غير صحيح'
      });
    }

    const advertisement = await Advertisement.findByIdAndDelete(id);

    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'الإعلان غير موجود'
      });
    }

    res.status(200).json({
      success: true,
      data: { id },
      message: 'تم حذف الإعلان بنجاح'
    });
  } catch (error) {
    console.error('Error deleting advertisement:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في حذف الإعلان',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Record advertisement click
// @route   POST /api/advertisements/:id/click
// @access  Public
const recordClick = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الإعلان غير صحيح'
      });
    }

    const advertisement = await Advertisement.findById(id);
    
    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'الإعلان غير موجود'
      });
    }

    if (!advertisement.canBeDisplayed()) {
      return res.status(400).json({
        success: false,
        message: 'الإعلان غير متاح حالياً'
      });
    }

    // Extract metadata from request
    const metadata = {
      device: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 
              req.headers['user-agent']?.includes('Tablet') ? 'tablet' : 'desktop',
      referrer: req.headers.referer || req.headers.referrer || 'direct',
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress
    };

    await advertisement.recordClick(metadata);

    res.status(200).json({
      success: true,
      data: {
        clickCount: advertisement.clickCount,
        ctr: advertisement.ctr,
        performanceScore: advertisement.performanceScore
      },
      message: 'تم تسجيل النقرة بنجاح'
    });
  } catch (error) {
    console.error('Error recording click:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في تسجيل النقرة',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Record advertisement impression
// @route   POST /api/advertisements/:id/impression
// @access  Public
const recordImpression = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الإعلان غير صحيح'
      });
    }

    const advertisement = await Advertisement.findById(id);
    
    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'الإعلان غير موجود'
      });
    }

    if (!advertisement.canBeDisplayed()) {
      return res.status(400).json({
        success: false,
        message: 'الإعلان غير متاح حالياً'
      });
    }

    // Extract metadata from request
    const metadata = {
      device: req.headers['user-agent']?.includes('Mobile') ? 'mobile' : 
              req.headers['user-agent']?.includes('Tablet') ? 'tablet' : 'desktop',
      referrer: req.headers.referer || req.headers.referrer || 'direct',
      userAgent: req.headers['user-agent'],
      ip: req.ip || req.connection.remoteAddress
    };

    await advertisement.recordImpression(metadata);

    res.status(200).json({
      success: true,
      data: {
        impressions: advertisement.impressions,
        ctr: advertisement.ctr,
        performanceScore: advertisement.performanceScore
      },
      message: 'تم تسجيل المشاهدة بنجاح'
    });
  } catch (error) {
    console.error('Error recording impression:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في تسجيل المشاهدة',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Get advertisement analytics
// @route   GET /api/advertisements/:id/analytics
// @access  Public
const getAdvertisementAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 30, includeHourly = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'معرف الإعلان غير صحيح'
      });
    }

    const advertisement = await Advertisement.findById(id);
    
    if (!advertisement) {
      return res.status(404).json({
        success: false,
        message: 'الإعلان غير موجود'
      });
    }

    const daysAgo = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
    
    const analytics = {
      overview: {
        totalClicks: advertisement.clickCount,
        totalImpressions: advertisement.impressions,
        ctr: advertisement.ctr,
        performanceScore: advertisement.performanceScore,
        campaignStatus: advertisement.campaignStatus,
        budgetUtilization: advertisement.budgetUtilization,
        lastClick: advertisement.analytics.lastClick,
        lastImpression: advertisement.analytics.lastImpression
      },
      timeSeriesData: {
        clicksOverTime: advertisement.analytics.dailyClicks
          .filter(entry => entry.date >= daysAgo)
          .sort((a, b) => a.date - b.date),
        impressionsOverTime: advertisement.analytics.dailyImpressions
          .filter(entry => entry.date >= daysAgo)
          .sort((a, b) => a.date - b.date)
      },
      deviceStats: advertisement.analytics.deviceStats,
      referrerStats: advertisement.analytics.referrerStats
        .sort((a, b) => b.count - a.count)
        .slice(0, 10), // Top 10 referrers
      budget: advertisement.budget
    };

    if (includeHourly === 'true') {
      analytics.peakHours = advertisement.analytics.peakHours
        .sort((a, b) => (b.clicks + b.impressions) - (a.clicks + a.impressions));
    }

    res.status(200).json({
      success: true,
      data: analytics
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب الإحصائيات التفصيلية',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Bulk activate/deactivate advertisements
// @route   POST /api/advertisements/bulk/activate
// @access  Private
const bulkActivateAdvertisements = async (req, res) => {
  try {
    const { ids, isActive } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يجب تحديد قائمة بالمعرفات'
      });
    }

    // Validate all IDs
    const invalidIds = ids.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'بعض المعرفات غير صحيحة',
        invalidIds
      });
    }

    const updateData = { isActive: Boolean(isActive) };
    if (req.user) {
      updateData['metadata.updatedBy'] = req.user.id || req.user.name || 'System';
    }

    const result = await Advertisement.updateMany(
      { _id: { $in: ids } },
      updateData
    );

    res.status(200).json({
      success: true,
      data: {
        modifiedCount: result.modifiedCount,
        matchedCount: result.matchedCount,
        requestedCount: ids.length
      },
      message: `تم تحديث ${result.modifiedCount} إعلان من أصل ${ids.length} بنجاح`
    });
  } catch (error) {
    console.error('Error bulk updating:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في التحديث المجمع',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Bulk delete advertisements
// @route   DELETE /api/advertisements/bulk
// @access  Private
const bulkDeleteAdvertisements = async (req, res) => {
  try {
    const { ids } = req.body;
    
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'يجب تحديد قائمة بالمعرفات'
      });
    }

    // Validate all IDs
    const invalidIds = ids.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'بعض المعرفات غير صحيحة',
        invalidIds
      });
    }

    const result = await Advertisement.deleteMany({ _id: { $in: ids } });

    res.status(200).json({
      success: true,
      data: {
        deletedCount: result.deletedCount,
        requestedCount: ids.length
      },
      message: `تم حذف ${result.deletedCount} إعلان من أصل ${ids.length} بنجاح`
    });
  } catch (error) {
    console.error('Error bulk deleting:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في الحذف المجمع',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Get advertisements by category
// @route   GET /api/advertisements/category/:category
// @access  Public
const getAdvertisementsByCategory = async (req, res) => {
  try {
    const { category } = req.params;
    const { limit = 10, includeInactive = false } = req.query;

    const filters = { category };
    if (!includeInactive) {
      filters.isActive = true;
    }

    const advertisements = await Advertisement.find(filters)
      .sort({ priority: -1, ctr: -1 })
      .limit(parseInt(limit));

    res.status(200).json({
      success: true,
      data: advertisements,
      count: advertisements.length
    });
  } catch (error) {
    console.error('Error fetching advertisements by category:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب الإعلانات حسب الفئة',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

// @desc    Get trending advertisements
// @route   GET /api/advertisements/trending
// @access  Public
const getTrendingAdvertisements = async (req, res) => {
  try {
    const { limit = 10, timeframe = 7 } = req.query;
    const daysAgo = new Date(Date.now() - parseInt(timeframe) * 24 * 60 * 60 * 1000);

    const trendingAds = await Advertisement.aggregate([
      { $match: { isActive: true, updatedAt: { $gte: daysAgo } } },
      {
        $addFields: {
          recentEngagement: {
            $add: [
              { $multiply: ['$clickCount', 10] }, // Weight clicks more
              '$impressions'
            ]
          }
        }
      },
      { $sort: { recentEngagement: -1, ctr: -1 } },
      { $limit: parseInt(limit) }
    ]);

    res.status(200).json({
      success: true,
      data: trendingAds,
      timeframe: `${timeframe} days`,
      count: trendingAds.length
    });
  } catch (error) {
    console.error('Error fetching trending advertisements:', error);
    res.status(500).json({
      success: false,
      message: 'فشل في جلب الإعلانات الرائجة',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Server Error'
    });
  }
};

module.exports = {
  getAdvertisements,
  getAdvertisementStats,
  getAdvertisementById,
  createAdvertisement,
  updateAdvertisement,
  deleteAdvertisement,
  recordClick,
  recordImpression,
  getAdvertisementAnalytics,
  bulkActivateAdvertisements,
  bulkDeleteAdvertisements,
  getAdvertisementsByCategory,
  getTrendingAdvertisements
};