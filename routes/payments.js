const express = require('express');
const router = express.Router();
const PaymentService = require('../services/paymentService');
const authenticateToken = require('../middlewares/authenticateToken'); // استخدام middleware الأساسي

/**
 * Payment Routes for Ride Hailing App
 * Handles payment processing, history, and analytics
 * 
 * @version 1.0.0
 */

// Initialize PaymentService (will be injected via middleware)
let paymentService = null;

// Middleware to inject PaymentService
const injectPaymentService = (req, res, next) => {
  if (req.paymentService) {
    paymentService = req.paymentService;
  }
  next();
};

// Middleware to verify captain role using main models
const verifyCaptain = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const Driver = require('../model/Driver');
    const User = require('../model/user');

    // التحقق من أن المستخدم سائق في model Driver
    const driver = await Driver.findById(req.user.id);
    if (driver) {
      req.captain = driver; // إضافة معلومات السائق للطلب
      return next();
    }

    // التحقق من أن المستخدم له دور سائق في model User
    const user = await User.findById(req.user.id);
    if (user && (user.role === 'driver' || user.role === 'captain')) {
      req.captain = user;
      return next();
    }

    // إذا لم يتم العثور على السائق
    return res.status(403).json({
      success: false,
      message: 'Access denied. Captain privileges required'
    });

  } catch (error) {
    console.error('[Auth] Error verifying captain role:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication'
    });
  }
};

// Middleware to verify admin role using main models
const verifyAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    const User = require('../model/user');
    const user = await User.findById(req.user.id);
    
    if (!user || user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin privileges required'
      });
    }

    req.adminUser = user;
    next();

  } catch (error) {
    console.error('[Auth] Error verifying admin role:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error during authentication'
    });
  }
};

/**
 * @route POST /rides/payment/
 * @desc Record payment for a completed ride
 * @access Private (Captain only)
 * @body {string} rideId - The ride ID
 * @body {number} receivedAmount - Amount received from customer
 * @body {number} expectedAmount - Expected fare amount
 * @body {string} currency - Currency code (default: IQD)
 * @body {string} paymentStatus - Payment status: "full" or "partial"
 * @body {string} reason - Reason for partial payment (required if partial)
 * @body {string} timestamp - Payment timestamp
 * @body {string} paymentMethod - Payment method (optional)
 * @body {string} notes - Additional notes (optional)
 */
router.post('/payment/', injectPaymentService, authenticateToken, verifyCaptain, async (req, res) => {
  try {
    const {
      rideId,
      receivedAmount,
      expectedAmount,
      currency = 'IQD',
      paymentStatus,
      reason = null,
      timestamp,
      paymentMethod = 'cash',
      notes = null
    } = req.body;

    const captainId = req.user.id;

    // Log the payment attempt
    console.log(`[Payment API] Captain ${captainId} submitting payment for ride ${rideId}:`, {
      receivedAmount,
      expectedAmount,
      paymentStatus,
      currency
    });

    // Validate PaymentService availability
    if (!paymentService) {
      return res.status(500).json({
        success: false,
        message: 'Payment service is not available'
      });
    }

    // Process the payment
    const result = await paymentService.processPayment({
      rideId,
      captainId,
      receivedAmount,
      expectedAmount,
      currency,
      paymentStatus,
      paymentMethod,
      reason,
      timestamp,
      notes
    });

    // Successful response
    res.status(200).json({
      success: true,
      message: 'Payment recorded successfully',
      data: {
        paymentId: result.payment._id,
        rideId: result.payment.rideId,
        rideCode: result.ride.rideCode,
        receivedAmount: result.payment.receivedAmount,
        expectedAmount: result.payment.expectedAmount,
        currency: result.payment.currency,
        paymentStatus: result.payment.paymentStatus,
        paymentMethod: result.payment.paymentMethod,
        timestamp: result.payment.timestamp,
        earnings: {
          captainEarnings: result.earnings.captainEarnings,
          companyCommission: result.earnings.companyCommission,
          processingFee: result.earnings.processingFee
        },
        completionPercentage: result.payment.completionPercentage,
        amountShortage: result.payment.paymentStatus === 'partial' ? result.payment.amountShortage : 0
      }
    });

  } catch (error) {
    console.error('[Payment API] Error processing payment:', error);
    
    // Determine error status code
    let statusCode = 500;
    if (error.message.includes('not found')) statusCode = 404;
    else if (error.message.includes('Access denied') || error.message.includes('belong to you')) statusCode = 403;
    else if (error.message.includes('required') || 
             error.message.includes('Invalid') || 
             error.message.includes('must be')) statusCode = 400;
    else if (error.message.includes('already recorded')) statusCode = 409;

    res.status(statusCode).json({
      success: false,
      message: error.message,
      errorCode: getErrorCode(error.message)
    });
  }
});

/**
 * @route GET /rides/payments/history
 * @desc Get payment history for the authenticated captain
 * @access Private (Captain only)
 * @query {number} page - Page number (default: 1)
 * @query {number} limit - Items per page (default: 20)
 * @query {string} startDate - Start date filter
 * @query {string} endDate - End date filter
 * @query {string} paymentStatus - Payment status filter
 * @query {string} paymentMethod - Payment method filter
 */
router.get('/payments/history', injectPaymentService, authenticateToken, verifyCaptain, async (req, res) => {
  try {
    const captainId = req.user.id;
    const filters = {
      page: parseInt(req.query.page) || 1,
      limit: parseInt(req.query.limit) || 20,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      paymentStatus: req.query.paymentStatus,
      paymentMethod: req.query.paymentMethod
    };

    // Validate PaymentService availability
    if (!paymentService) {
      return res.status(500).json({
        success: false,
        message: 'Payment service is not available'
      });
    }

    const result = await paymentService.getCaptainPaymentHistory(captainId, filters);

    res.json({
      success: true,
      message: 'Payment history retrieved successfully',
      data: {
        payments: result.payments,
        pagination: result.pagination,
        statistics: result.stats
      }
    });

  } catch (error) {
    console.error('[Payment API] Error getting payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment history',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route GET /rides/payments/stats
 * @desc Get payment statistics for the authenticated captain
 * @access Private (Captain only)
 * @query {string} startDate - Start date for statistics
 * @query {string} endDate - End date for statistics
 */
router.get('/payments/stats', injectPaymentService, authenticateToken, verifyCaptain, async (req, res) => {
  try {
    const captainId = req.user.id;
    const { startDate, endDate } = req.query;

    // Validate PaymentService availability
    if (!paymentService) {
      return res.status(500).json({
        success: false,
        message: 'Payment service is not available'
      });
    }

    const Payment = require('../model/payment');
    const stats = await Payment.getCaptainStats(captainId, startDate, endDate);

    res.json({
      success: true,
      message: 'Payment statistics retrieved successfully',
      data: {
        captainId,
        period: {
          startDate: startDate || 'All time',
          endDate: endDate || 'Present'
        },
        statistics: stats
      }
    });

  } catch (error) {
    console.error('[Payment API] Error getting payment stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment statistics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route GET /rides/payments/analytics
 * @desc Get payment analytics (Admin only)
 * @access Private (Admin only)
 * @query {string} startDate - Start date for analytics
 * @query {string} endDate - End date for analytics
 * @query {string} groupBy - Group by: day, week, month
 */
router.get('/payments/analytics', injectPaymentService, authenticateToken, verifyAdmin, async (req, res) => {
  try {
    const filters = {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      groupBy: req.query.groupBy || 'day'
    };

    // Validate PaymentService availability
    if (!paymentService) {
      return res.status(500).json({
        success: false,
        message: 'Payment service is not available'
      });
    }

    const result = await paymentService.getPaymentAnalytics(filters);

    res.json({
      success: true,
      message: 'Payment analytics retrieved successfully',
      data: result
    });

  } catch (error) {
    console.error('[Payment API] Error getting payment analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve payment analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route PUT /rides/payments/:paymentId/process
 * @desc Mark a payment as processed (Admin only)
 * @access Private (Admin only)
 */
router.put('/payments/:paymentId/process', injectPaymentService, authenticateToken, verifyAdmin, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const Payment = require('../model/payment');
    
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.isProcessed) {
      return res.status(409).json({
        success: false,
        message: 'Payment already processed'
      });
    }

    await payment.markAsProcessed(req.user.id);

    res.json({
      success: true,
      message: 'Payment marked as processed',
      data: {
        paymentId: payment._id,
        processedAt: payment.processedAt,
        processedBy: req.user.id
      }
    });

  } catch (error) {
    console.error('[Payment API] Error processing payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route POST /rides/payments/:paymentId/dispute
 * @desc Create a dispute for a payment
 * @access Private (Captain only - for their own payments)
 */
router.post('/payments/:paymentId/dispute', injectPaymentService, authenticateToken, verifyCaptain, async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { reason } = req.body;
    const captainId = req.user.id;

    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Dispute reason is required'
      });
    }

    const Payment = require('../model/payment');
    const payment = await Payment.findById(paymentId);
    
    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    if (payment.captainId.toString() !== captainId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. This payment does not belong to you'
      });
    }

    if (payment.hasDispute) {
      return res.status(409).json({
        success: false,
        message: 'Dispute already exists for this payment'
      });
    }

    await payment.createDispute(reason.trim());

    res.json({
      success: true,
      message: 'Dispute created successfully',
      data: {
        paymentId: payment._id,
        disputeReason: payment.disputeReason,
        hasDispute: payment.hasDispute
      }
    });

  } catch (error) {
    console.error('[Payment API] Error creating dispute:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create dispute',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Helper function to determine error codes
function getErrorCode(errorMessage) {
  const errorCodes = {
    'Ride not found': 'RIDE_NOT_FOUND',
    'Access denied': 'ACCESS_DENIED',
    'already recorded': 'PAYMENT_ALREADY_EXISTS',
    'required': 'VALIDATION_ERROR',
    'Invalid': 'VALIDATION_ERROR',
    'must be': 'VALIDATION_ERROR'
  };

  for (const [key, code] of Object.entries(errorCodes)) {
    if (errorMessage.includes(key)) {
      return code;
    }
  }

  return 'UNKNOWN_ERROR';
}

module.exports = router;
