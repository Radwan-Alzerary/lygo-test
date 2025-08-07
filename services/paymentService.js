const Payment = require("../model/payment");
const Ride = require("../model/ride");
const Driver = require("../model/Driver");

/**
 * Payment Service for handling ride payments
 * Manages payment processing, captain earnings, and commission calculations
 * 
 * @class PaymentService
 * @version 1.0.0
 */
class PaymentService {
  constructor(logger, redisClient = null) {
    this.logger = logger;
    this.redisClient = redisClient;
    
    // Default commission settings (can be configured)
    this.settings = {
      defaultCommissionRate: 0.15, // 15%
      processingFeeFixed: 0, // Fixed processing fee
      processingFeePercentage: 0, // Percentage-based processing fee
      minPaymentAmount: 0,
      maxPaymentAmount: 1000000, // 1 million IQD max
      supportedCurrencies: ['IQD', 'USD', 'EUR'],
      paymentMethods: ['cash', 'card', 'wallet', 'other']
    };
    
    this.logger.info('[PaymentService] Payment service initialized successfully');
  }

  /**
   * Process a new payment record
   * @param {Object} paymentData - Payment information
   * @returns {Object} Processed payment record
   */
  async processPayment(paymentData) {
    try {
      const {
        rideId,
        captainId,
        receivedAmount,
        expectedAmount,
        currency = 'IQD',
        paymentStatus,
        paymentMethod = 'cash',
        reason = null,
        timestamp,
        notes = null
      } = paymentData;

      // Validate required fields
      this.validatePaymentData(paymentData);

      // Check if ride exists and get ride details
      const ride = await this.getRideForPayment(rideId, captainId);

      // Check if payment already exists
      const existingPayment = await Payment.findOne({ rideId });
      if (existingPayment) {
        throw new Error('Payment already recorded for this ride');
      }

      // Calculate processing fee
      const processingFee = this.calculateProcessingFee(receivedAmount);

      // Create payment record
      const paymentRecord = new Payment({
        rideId,
        captainId,
        customerId: ride.passenger,
        receivedAmount: parseFloat(receivedAmount),
        expectedAmount: parseFloat(expectedAmount),
        currency: currency.toUpperCase(),
        paymentStatus,
        paymentMethod,
        reason: paymentStatus === 'partial' ? reason : null,
        timestamp: new Date(timestamp),
        commissionRate: this.settings.defaultCommissionRate,
        processingFee,
        notes
      });

      // Save payment record (pre-save middleware will calculate earnings)
      const savedPayment = await paymentRecord.save();

      // Update ride with payment details
      await this.updateRidePaymentStatus(ride, savedPayment);

      // Update captain earnings
      await this.updateCaptainEarnings(captainId, savedPayment.captainEarnings);

      // Update customer spending stats
      await this.updateCustomerSpendingStats(ride.passenger, savedPayment.receivedAmount);

      // Transfer commission to admin
      await this.transferCommissionToAdmin(savedPayment.companyCommission, rideId, captainId);

      // Cache payment data if Redis is available
      if (this.redisClient) {
        await this.cachePaymentData(savedPayment);
      }

      // Log successful payment processing
      this.logger.info(`[PaymentService] Payment processed successfully for ride ${rideId}, captain ${captainId}, amount ${receivedAmount} ${currency}`);

      return {
        payment: savedPayment,
        ride: ride,
        earnings: {
          captainEarnings: savedPayment.captainEarnings,
          companyCommission: savedPayment.companyCommission,
          processingFee: savedPayment.processingFee
        }
      };

    } catch (error) {
      this.logger.error('[PaymentService] Error processing payment:', error);
      throw error;
    }
  }

  /**
   * Get payment history for a captain
   * @param {string} captainId - Captain ID
   * @param {Object} filters - Filter options
   * @returns {Object} Payment history and stats
   */
  async getCaptainPaymentHistory(captainId, filters = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        startDate,
        endDate,
        paymentStatus,
        paymentMethod
      } = filters;

      // Build query
      const query = { captainId };
      
      if (startDate || endDate) {
        query.timestamp = {};
        if (startDate) query.timestamp.$gte = new Date(startDate);
        if (endDate) query.timestamp.$lte = new Date(endDate);
      }
      
      if (paymentStatus) query.paymentStatus = paymentStatus;
      if (paymentMethod) query.paymentMethod = paymentMethod;

      // Execute query with pagination
      const payments = await Payment.find(query)
        .populate('rideId', 'rideCode pickupAddress dropoffAddress')
        .sort({ timestamp: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .lean();

      // Get total count
      const total = await Payment.countDocuments(query);

      // Get statistics
      const stats = await Payment.getCaptainStats(captainId, startDate, endDate);

      return {
        payments,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        stats
      };

    } catch (error) {
      this.logger.error('[PaymentService] Error getting captain payment history:', error);
      throw error;
    }
  }

  /**
   * Get payment analytics for dashboard
   * @param {Object} filters - Analytics filters
   * @returns {Object} Payment analytics data
   */
  async getPaymentAnalytics(filters = {}) {
    try {
      const {
        startDate,
        endDate,
        groupBy = 'day' // day, week, month
      } = filters;

      const matchCondition = {};
      if (startDate || endDate) {
        matchCondition.timestamp = {};
        if (startDate) matchCondition.timestamp.$gte = new Date(startDate);
        if (endDate) matchCondition.timestamp.$lte = new Date(endDate);
      }

      // Group by format based on period
      let dateFormat;
      switch (groupBy) {
        case 'week':
          dateFormat = { $dateToString: { format: "%Y-%U", date: "$timestamp" } };
          break;
        case 'month':
          dateFormat = { $dateToString: { format: "%Y-%m", date: "$timestamp" } };
          break;
        default: // day
          dateFormat = { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } };
      }

      const analytics = await Payment.aggregate([
        { $match: matchCondition },
        {
          $group: {
            _id: dateFormat,
            totalPayments: { $sum: 1 },
            totalAmount: { $sum: "$receivedAmount" },
            totalEarnings: { $sum: "$captainEarnings" },
            totalCommission: { $sum: "$companyCommission" },
            fullPayments: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "full"] }, 1, 0] }
            },
            partialPayments: {
              $sum: { $cond: [{ $eq: ["$paymentStatus", "partial"] }, 1, 0] }
            },
            averageAmount: { $avg: "$receivedAmount" }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Overall statistics
      const overallStats = await Payment.aggregate([
        { $match: matchCondition },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalRevenue: { $sum: "$receivedAmount" },
            totalCommission: { $sum: "$companyCommission" },
            averageTransaction: { $avg: "$receivedAmount" },
            uniqueCaptains: { $addToSet: "$captainId" },
            uniqueCustomers: { $addToSet: "$customerId" }
          }
        }
      ]);

      const stats = overallStats[0] || {
        totalTransactions: 0,
        totalRevenue: 0,
        totalCommission: 0,
        averageTransaction: 0,
        uniqueCaptains: [],
        uniqueCustomers: []
      };

      stats.uniqueCaptainsCount = stats.uniqueCaptains.length;
      stats.uniqueCustomersCount = stats.uniqueCustomers.length;
      delete stats.uniqueCaptains;
      delete stats.uniqueCustomers;

      return {
        analytics,
        overallStats: stats
      };

    } catch (error) {
      this.logger.error('[PaymentService] Error getting payment analytics:', error);
      throw error;
    }
  }

  /**
   * Update payment settings
   * @param {Object} newSettings - New settings to apply
   */
  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    this.logger.info('[PaymentService] Settings updated:', newSettings);
  }

  // ===============================
  // Private Helper Methods
  // ===============================

  /**
   * Validate payment data
   * @param {Object} paymentData - Payment data to validate
   */
  validatePaymentData(paymentData) {
    const {
      rideId,
      captainId,
      receivedAmount,
      expectedAmount,
      currency,
      paymentStatus,
      reason,
      timestamp
    } = paymentData;

    // Required field validation
    if (!rideId) throw new Error('Ride ID is required');
    if (!captainId) throw new Error('Captain ID is required');
    if (!receivedAmount && receivedAmount !== 0) throw new Error('Received amount is required');
    if (!expectedAmount) throw new Error('Expected amount is required');
    if (!paymentStatus) throw new Error('Payment status is required');
    if (!timestamp) throw new Error('Timestamp is required');

    // Value validation
    if (parseFloat(receivedAmount) < this.settings.minPaymentAmount) {
      throw new Error(`Received amount must be at least ${this.settings.minPaymentAmount}`);
    }
    
    if (parseFloat(receivedAmount) > this.settings.maxPaymentAmount) {
      throw new Error(`Received amount cannot exceed ${this.settings.maxPaymentAmount}`);
    }

    if (parseFloat(expectedAmount) <= 0) {
      throw new Error('Expected amount must be greater than 0');
    }

    // Currency validation
    if (currency && !this.settings.supportedCurrencies.includes(currency.toUpperCase())) {
      throw new Error(`Unsupported currency. Supported: ${this.settings.supportedCurrencies.join(', ')}`);
    }

    // Payment status validation
    if (!['full', 'partial'].includes(paymentStatus)) {
      throw new Error('Payment status must be either "full" or "partial"');
    }

    // Partial payment validation
    if (paymentStatus === 'partial') {
      if (!reason || reason.trim().length === 0) {
        throw new Error('Reason is required for partial payments');
      }
      if (parseFloat(receivedAmount) >= parseFloat(expectedAmount)) {
        throw new Error('For partial payments, received amount must be less than expected amount');
      }
    }

    // Full payment validation
    if (paymentStatus === 'full' && parseFloat(receivedAmount) < parseFloat(expectedAmount)) {
      throw new Error('For full payments, received amount should not be less than expected amount');
    }
  }

  /**
   * Get ride for payment processing
   * @param {string} rideId - Ride ID
   * @param {string} captainId - Captain ID
   * @returns {Object} Ride object
   */
  async getRideForPayment(rideId, captainId) {
    const ride = await Ride.findById(rideId).populate('passenger', 'name phoneNumber');
    
    if (!ride) {
      throw new Error('Ride not found');
    }

    if (!ride.driver || ride.driver.toString() !== captainId) {
      throw new Error('Access denied. This ride does not belong to you');
    }

    // Allow payment processing for rides that are awaiting payment or already completed
    if (!['completed', 'awaiting_payment'].includes(ride.status)) {
      throw new Error('Payment can only be processed for completed rides or rides awaiting payment');
    }

    return ride;
  }

  /**
   * Calculate processing fee
   * @param {number} amount - Payment amount
   * @returns {number} Processing fee
   */
  calculateProcessingFee(amount) {
    const fixedFee = this.settings.processingFeeFixed;
    const percentageFee = amount * this.settings.processingFeePercentage;
    return fixedFee + percentageFee;
  }

  /**
   * Update ride payment status
   * @param {Object} ride - Ride object
   * @param {Object} payment - Payment object
   */
  async updateRidePaymentStatus(ride, payment) {
    const updateData = {
      paymentStatus: payment.paymentStatus,
      'paymentDetails.receivedAmount': payment.receivedAmount,
      'paymentDetails.expectedAmount': payment.expectedAmount,
      'paymentDetails.currency': payment.currency,
      'paymentDetails.paymentTimestamp': payment.timestamp,
      'paymentDetails.paymentId': payment._id
    };

    if (payment.paymentStatus === 'partial') {
      updateData['paymentDetails.reason'] = payment.reason;
      updateData['paymentDetails.amountShortage'] = payment.expectedAmount - payment.receivedAmount;
    }

    await Ride.findByIdAndUpdate(ride._id, updateData);
  }

  /**
   * Update captain earnings
   * @param {string} captainId - Captain ID
   * @param {number} earnings - Earnings amount
   */
  async updateCaptainEarnings(captainId, earnings) {
    try {
      await Driver.findByIdAndUpdate(captainId, {
        $inc: {
          totalEarnings: earnings,
          balance: earnings,
          totalRides: 1
        },
        $set: {
          lastPaymentDate: new Date()
        }
      });

      this.logger.debug(`[PaymentService] Updated captain ${captainId} earnings by ${earnings}`);
    } catch (error) {
      this.logger.error('[PaymentService] Error updating captain earnings:', error);
      // Don't throw here - payment is already processed
    }
  }

  /**
   * Transfer commission to admin account
   * @param {number} commission - Commission amount
   * @param {string} rideId - Ride ID for reference
   * @param {string} captainId - Captain ID for reference
   */
  async transferCommissionToAdmin(commission, rideId, captainId) {
    try {
      if (commission <= 0) return;

      const User = require('../model/user');
      const FinancialAccount = require('../model/financialAccount');
      const MoneyTransfers = require('../model/moneyTransfers');
      const Driver = require('../model/Driver');

      // Find admin user (assuming role 'admin')
      let adminUser = await User.findOne({ role: 'admin' }).populate('financialAccount');
      const captain = await Driver.findById(captainId).populate('financialAccount');

      if (!adminUser) {
        this.logger.warn('[PaymentService] Admin user not found, creating default admin for commission transfer');
        await this.createDefaultAdminUser();
        // Retry finding admin after creation
        adminUser = await User.findOne({ role: 'admin' }).populate('financialAccount');
        if (!adminUser) {
          this.logger.error('[PaymentService] Failed to create admin user for commission transfer');
          return;
        }
      }

      if (!adminUser.financialAccount) {
        // Create financial account for admin if doesn't exist
        const newFinancialAccount = new FinancialAccount();
        await newFinancialAccount.save();
        adminUser.financialAccount = newFinancialAccount._id;
        await adminUser.save();
        await adminUser.populate('financialAccount');
      }

      if (!captain || !captain.financialAccount) {
        this.logger.warn('[PaymentService] Captain or captain financial account not found');
        return;
      }

      // Create money transfer record
      const moneyTransfer = new MoneyTransfers({
        transferType: "dtu", // Driver to User (Admin)
        status: "completed",
        from: { id: captain.financialAccount._id, role: "Driver" },
        to: { id: adminUser.financialAccount._id, role: "Users" },
        vault: commission,
      });

      await moneyTransfer.save();

      // Update admin vault (commission goes to admin)
      adminUser.financialAccount.vault += commission;
      
      // Add transaction record to admin account
      adminUser.financialAccount.transactions.push({
        moneyTransfers: [moneyTransfer._id],
        description: `عمولة من رحلة: ${rideId} - السائق: ${captainId}`,
        date: new Date()
      });

      // Note: Captain's financial account will be updated separately in captain earnings method
      // We don't deduct from captain here as it's already handled in payment processing

      await adminUser.financialAccount.save();

      // Update admin system earnings stats
      await this.updateAdminSystemEarnings(commission);

      this.logger.info(`[PaymentService] Commission ${commission} transferred to admin from ride ${rideId}`);
      
    } catch (error) {
      this.logger.error('[PaymentService] Error transferring commission to admin:', error);
      // Don't throw here - payment is already processed
    }
  }

  /**
   * Update customer spending statistics
   * @param {string} customerId - Customer ID
   * @param {number} amount - Amount spent
   */
  async updateCustomerSpendingStats(customerId, amount) {
    try {
      const Customer = require('../model/customer');
      
      await Customer.findByIdAndUpdate(customerId, {
        $inc: {
          totalSpent: amount,
          totalRides: 1
        }
      });

      this.logger.debug(`[PaymentService] Updated customer ${customerId} spending stats: +${amount}`);
    } catch (error) {
      this.logger.error('[PaymentService] Error updating customer spending stats:', error);
      // Don't throw here - payment is already processed
    }
  }

  /**
   * Update admin system earnings
   * @param {number} commission - Commission amount to add
   */
  async updateAdminSystemEarnings(commission) {
    try {
      const User = require('../model/user');
      
      await User.findOneAndUpdate(
        { role: 'admin' },
        {
          $inc: {
            totalCommissions: commission,
            totalSystemEarnings: commission
          }
        }
      );

      this.logger.debug(`[PaymentService] Updated admin system earnings: +${commission}`);
    } catch (error) {
      this.logger.error('[PaymentService] Error updating admin system earnings:', error);
      // Don't throw here - payment is already processed
    }
  }

  /**
   * Cache payment data in Redis
   * @param {Object} payment - Payment object
   */
  async cachePaymentData(payment) {
    if (!this.redisClient) return;

    try {
      const cacheKey = `payment:${payment._id}`;
      const cacheData = {
        _id: payment._id,
        rideId: payment.rideId,
        captainId: payment.captainId,
        receivedAmount: payment.receivedAmount,
        expectedAmount: payment.expectedAmount,
        paymentStatus: payment.paymentStatus,
        captainEarnings: payment.captainEarnings,
        timestamp: payment.timestamp
      };

      await this.redisClient.setEx(cacheKey, 3600, JSON.stringify(cacheData)); // Cache for 1 hour
      
      // Also cache in captain's payment list
      const captainPaymentsKey = `captain:${payment.captainId}:recent_payments`;
      await this.redisClient.lPush(captainPaymentsKey, JSON.stringify(cacheData));
      await this.redisClient.lTrim(captainPaymentsKey, 0, 49); // Keep last 50 payments
      await this.redisClient.expire(captainPaymentsKey, 86400); // Expire in 24 hours

    } catch (error) {
      this.logger.warn('[PaymentService] Failed to cache payment data:', error);
    }
  }

  /**
   * Create default admin user if doesn't exist
   */
  async createDefaultAdminUser() {
    try {
      const User = require('../model/user');
      const FinancialAccount = require('../model/financialAccount');
      const bcrypt = require('bcrypt');

      // Create financial account first
      const adminFinancialAccount = new FinancialAccount();
      await adminFinancialAccount.save();

      // Create admin user
      const adminUser = new User({
        email: 'admin@lygo-system.local',
        password: 'AdminSystem123!', // This will be hashed by the pre-save middleware
        userName: 'SystemAdmin',
        role: 'admin',
        financialAccount: adminFinancialAccount._id,
        totalCommissions: 0,
        totalSystemEarnings: 0
      });

      await adminUser.save();
      this.logger.info('[PaymentService] Default admin user created successfully');
      
    } catch (error) {
      this.logger.error('[PaymentService] Error creating default admin user:', error);
    }
  }
}

module.exports = PaymentService;
