// routes/advertisements.js
const express = require('express');
const router = express.Router();
const {
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
} = require('../../controllers/advertisementController');



// Public routes - no authentication required

// @route   GET /api/advertisements
// @desc    Get all advertisements with filtering and pagination
// @access  Public
router.get('/', getAdvertisements);

// @route   GET /api/advertisements/stats
// @desc    Get advertisement statistics and insights
// @access  Public
router.get('/stats', getAdvertisementStats);

// @route   GET /api/advertisements/trending
// @desc    Get trending advertisements
// @access  Public
router.get('/trending', getTrendingAdvertisements);

// @route   GET /api/advertisements/category/:category
// @desc    Get advertisements by category
// @access  Public
router.get('/category/:category', getAdvertisementsByCategory);

// @route   GET /api/advertisements/:id
// @desc    Get single advertisement by ID
// @access  Public
router.get('/:id', getAdvertisementById);

// @route   GET /api/advertisements/:id/analytics
// @desc    Get detailed analytics for specific advertisement
// @access  Public
router.get('/:id/analytics', getAdvertisementAnalytics);

// @route   POST /api/advertisements/:id/click
// @desc    Record a click on an advertisement
// @access  Public
router.post('/:id/click', recordClick);

// @route   POST /api/advertisements/:id/impression  
// @desc    Record an impression (view) of an advertisement
// @access  Public
router.post('/:id/impression', recordImpression);

// Protected routes - authentication required

// @route   POST /api/advertisements
// @desc    Create new advertisement
// @access  Private
router.post('/', createAdvertisement);

// @route   PUT /api/advertisements/:id
// @desc    Update advertisement
// @access  Private
router.put('/:id',  updateAdvertisement);

// @route   DELETE /api/advertisements/:id
// @desc    Delete advertisement
// @access  Private
router.delete('/:id', deleteAdvertisement);

// Bulk operations routes

// @route   POST /api/advertisements/bulk/activate
// @desc    Bulk activate/deactivate advertisements
// @access  Private
router.post('/bulk/activate',  bulkActivateAdvertisements);

// @route   DELETE /api/advertisements/bulk
// @desc    Bulk delete advertisements
// @access  Private
router.delete('/bulk', bulkDeleteAdvertisements);

module.exports = router;
