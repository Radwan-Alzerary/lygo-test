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
    
    // Initialize financial account service
    const FinancialAccountService = require('./financialAccountService');
    this.financialAccountService = new FinancialAccountService(logger);
    
    // Default commission settings (can be configured)
    this.settings = {
      defaultCommissionRate: 0.15, // 15%
      mainVaultDeductionRate: 0.20, // 20% deduction for main vault (fallback)
      processingFeeFixed: 0, // Fixed processing fee
      processingFeePercentage: 0, // Percentage-based processing fee
      minPaymentAmount: 0,
      maxPaymentAmount: 1000000, // 1 million IQD max
      supportedCurrencies: ['IQD', 'USD', 'EUR'],
      paymentMethods: ['cash', 'card', 'wallet', 'other']
    };
    
    this.logger.info('[PaymentService] Payment service initialized successfully');
    
    // Initialize main vault on service startup
    this.initializeMainVault();
  }

  /**
   * Initialize main vault system on service startup
   * This ensures the main vault is ready before any rides are accepted
   */
  async initializeMainVault() {
    try {
      this.logger.info('[PaymentService] 🏦 Initializing main vault system...');
      
      const mainVault = await this.getOrCreateMainVault();
      const vaultSettings = await this.getMainVaultSettings();
      
      this.logger.info('[PaymentService] ✅ Main vault system initialized successfully');
      this.logger.info(`[PaymentService] 💰 Main vault balance: ${mainVault.vault} IQD`);
      this.logger.info(`[PaymentService] 📊 Deduction rate: ${(vaultSettings.deductionRate * 100).toFixed(1)}%`);
      this.logger.info(`[PaymentService] 🎛️  Vault enabled: ${vaultSettings.enabled ? 'YES' : 'NO'}`);
      
      // Store reference for quick access
      this.mainVaultAccount = mainVault;
      
    } catch (error) {
      this.logger.error('[PaymentService] ❌ Failed to initialize main vault:', error);
      // Don't throw here to prevent service startup failure
      // The vault will be created when first needed
    }
  }

  /**
   * Get main vault settings from ride settings
   * @returns {Object} Main vault configuration with deduction rate
   */
  async getMainVaultSettings() {
    try {
      const RideSetting = require('../model/rideSetting');
      
      // Get default ride setting
      let rideSetting = await RideSetting.findOne({ name: 'default' });
      
      if (!rideSetting) {
        // Create default ride setting with main vault config if it doesn't exist
        this.logger.info('[PaymentService] Creating default ride setting with main vault configuration...');
        rideSetting = new RideSetting({
          name: 'default',
          mainVault: {
            deductionRate: 0.20, // 20%
            enabled: true,
            description: 'Main vault automatic deduction from captain earnings'
          }
        });
        await rideSetting.save();
        this.logger.info('[PaymentService] ✅ Default ride setting created with main vault config');
      }
      
      // Return main vault settings or fallback to defaults
      const vaultSettings = rideSetting.mainVault || {
        deductionRate: 0.20,
        enabled: true,
        description: 'Main vault automatic deduction from captain earnings'
      };
      
      this.logger.info(`[PaymentService] 📊 Main vault deduction rate loaded: ${(vaultSettings.deductionRate * 100).toFixed(1)}%`);
      
      return vaultSettings;
      
    } catch (error) {
      this.logger.warn('[PaymentService] ⚠️  Failed to load main vault settings from ride settings, using fallback:', error.message);
      
      // Fallback to default settings
      return {
        deductionRate: this.settings.mainVaultDeductionRate,
        enabled: true,
        description: 'Main vault automatic deduction (fallback settings)'
      };
    }
  }

  /**
   * Get or create main vault financial account
   * Ensures there's always a main vault available in the system
   * @returns {Object} Main vault financial account
   */
  async getOrCreateMainVault() {
    try {
      const Users = require('../model/user');
      const FinancialAccount = require('../model/financialAccount');

      this.logger.info('[PaymentService] Checking for main vault...');

      // First, try to find existing main vault account directly
      let mainVaultAccount = await FinancialAccount.findOne({ 
        accountType: 'main_vault',
        isActive: true 
      });

      if (mainVaultAccount) {
        // Populate user information
        mainVaultAccount = await FinancialAccount.findById(mainVaultAccount._id).populate('user');
        this.logger.info(`[PaymentService] Main vault found with balance: ${mainVaultAccount.vault} IQD`);
        return mainVaultAccount;
      }

      this.logger.info('[PaymentService] No main vault found. Creating main vault system...');

      // Find or create main vault user
      let mainVaultUser = await Users.findOne({ userName: 'main_vault_system' });
      
      if (!mainVaultUser) {
        // Try to find by email in case username field is different
        mainVaultUser = await Users.findOne({ email: 'vault@lygo-system.com' });
        
        if (!mainVaultUser) {
          this.logger.info('[PaymentService] Creating main vault user...');
          try {
            mainVaultUser = new Users({
              userName: 'main_vault_system',
              name: 'Main Vault System',
              email: 'vault@lygo-system.com',
              password: 'MainVaultSystem123!@#', // Strong default password
              role: 'system',
              isActive: true,
              metadata: {
                createdBy: 'system',
                purpose: 'main_vault',
                isMainVault: true,
                autoCreated: true,
                createdAt: new Date()
              }
            });
            await mainVaultUser.save();
            this.logger.info(`[PaymentService] ✅ Main vault user created with ID: ${mainVaultUser._id}`);
          } catch (error) {
            if (error.code === 11000) {
              // Duplicate key error, try to find the existing user
              this.logger.info('[PaymentService] Main vault user already exists, finding existing user...');
              mainVaultUser = await Users.findOne({ 
                $or: [
                  { userName: 'main_vault_system' },
                  { email: 'vault@lygo-system.com' }
                ]
              });
              if (!mainVaultUser) {
                throw new Error('Could not find or create main vault user');
              }
            } else {
              throw error;
            }
          }
        } else {
          this.logger.info('[PaymentService] Found existing main vault user by email');
        }
      } else {
        this.logger.info('[PaymentService] Found existing main vault user by username');
      }

      // Create main vault financial account
      this.logger.info('[PaymentService] Creating main vault financial account...');
      mainVaultAccount = new FinancialAccount({
        user: mainVaultUser._id,
        accountType: 'main_vault',
        currency: 'IQD',
        vault: 0,
        isActive: true,
        metadata: {
          createdBy: 'system',
          purpose: 'main_vault_deductions',
          description: 'Main system vault for collecting ride deductions (20%)',
          isMainVault: true,
          autoCreated: true,
          deductionRate: this.settings.mainVaultDeductionRate,
          createdAt: new Date()
        }
      });
      await mainVaultAccount.save();
      
      this.logger.info(`[PaymentService] ✅ Main vault financial account created with ID: ${mainVaultAccount._id}`);
      this.logger.info(`[PaymentService] 🏦 Main vault system is now operational!`);
      
      // Populate user for consistency
      mainVaultAccount = await FinancialAccount.findById(mainVaultAccount._id).populate('user');
      
      return mainVaultAccount;

    } catch (error) {
      this.logger.error('[PaymentService] ❌ Error getting/creating main vault:', error);
      throw new Error(`Failed to initialize main vault: ${error.message}`);
    }
  }

  /**
   * Process ride request and deduct main vault fee from captain
   * Ensures main vault exists before processing deduction
   * @param {String} captainId - Captain's user ID
   * @param {Number} rideAmount - Expected ride amount
   * @returns {Object} Deduction result
   */
  async processRideDeduction(captainId, rideAmount) {
    try {
      this.logger.info(`[PaymentService] 🚖 Processing ride deduction for captain ${captainId}, ride amount: ${rideAmount}`);

      // Get main vault settings from ride settings (includes deduction rate)
      const vaultSettings = await this.getMainVaultSettings();
      
      if (!vaultSettings.enabled) {
        this.logger.info('[PaymentService] 🏦 Main vault deduction is disabled, skipping...');
        return {
          success: true,
          deductionAmount: 0,
          captainRemainingBalance: 0,
          mainVaultNewBalance: 0,
          skipped: true,
          reason: 'Main vault deduction disabled in ride settings'
        };
      }

      // Calculate main vault deduction using rate from settings
      const deductionAmount = Math.round(rideAmount * vaultSettings.deductionRate);
      this.logger.info(`[PaymentService] 📊 Using deduction rate: ${(vaultSettings.deductionRate * 100).toFixed(1)}% = ${deductionAmount} IQD`);
      
      // Ensure main vault exists (create if needed)
      this.logger.info('[PaymentService] 🏦 Ensuring main vault is available...');
      const mainVaultAccount = await this.getOrCreateMainVault();
      
      if (!mainVaultAccount) {
        throw new Error('Failed to initialize main vault system');
      }

      this.logger.info(`[PaymentService] 🏦 Main vault account found with balance: ${mainVaultAccount.vault} IQD`);

      // Get captain's financial account
      const captainAccount = await this.financialAccountService.getAccountByUserAndType(captainId, 'captain');
      
      if (!captainAccount) {
        throw new Error(`Captain financial account not found for user ${captainId}`);
      }

      this.logger.info(`[PaymentService] 👨‍✈️ Captain account found with balance: ${captainAccount.vault} IQD`);

      // Check if captain has sufficient balance
      if (captainAccount.vault < deductionAmount) {
        throw new Error(`Insufficient captain balance. Required: ${deductionAmount}, Available: ${captainAccount.vault}`);
      }

      // Transfer money from captain to main vault
      this.logger.info(`[PaymentService] 💸 Transferring ${deductionAmount} IQD from captain to main vault...`);
      const transferResult = await this.financialAccountService.transferMoney({
        fromAccountId: captainAccount._id,
        toAccountId: mainVaultAccount._id,
        amount: deductionAmount,
        transferType: 'ride_deduction',
        fromRole: 'Driver',
        toRole: 'Users',
        description: `Main vault deduction (${this.settings.mainVaultDeductionRate * 100}%) for ride amount ${rideAmount} IQD`,
        checkBalance: true,
        metadata: {
          rideAmount: rideAmount,
          deductionRate: this.settings.mainVaultDeductionRate,
          category: 'main_vault_deduction',
          automated: true,
          timestamp: new Date(),
          captainId: captainId
        }
      });

      // Update cached main vault reference
      this.mainVaultAccount = await this.getOrCreateMainVault();

      this.logger.info(`[PaymentService] ✅ Successfully deducted ${deductionAmount} IQD from captain ${captainId} to main vault`);
      this.logger.info(`[PaymentService] 📊 Main vault new balance: ${this.mainVaultAccount.vault} IQD`);
      
      return {
        success: true,
        deductionAmount,
        captainRemainingBalance: captainAccount.vault - deductionAmount,
        mainVaultNewBalance: this.mainVaultAccount.vault,
        transfer: transferResult
      };

    } catch (error) {
      this.logger.error('[PaymentService] ❌ Error processing ride deduction:', error);
      throw error;
    }
  }

  /**
   * Get main vault statistics and balance
   * @returns {Object} Main vault statistics
   */
  async getMainVaultStats() {
    try {
      const mainVaultAccount = await this.getOrCreateMainVault();
      const MoneyTransfers = require('../model/moneyTransfers');
      
      // Get vault settings to include current deduction rate
      const vaultSettings = await this.getMainVaultSettings();
      
      // Get total deductions made to main vault
      const totalDeductions = await MoneyTransfers.aggregate([
        {
          $match: {
            'to.id': mainVaultAccount._id,
            transferType: 'ride_deduction',
            status: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: '$vault' },
            totalTransactions: { $sum: 1 }
          }
        }
      ]);

      // Get daily deductions
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const dailyDeductions = await MoneyTransfers.aggregate([
        {
          $match: {
            'to.id': mainVaultAccount._id,
            transferType: 'ride_deduction',
            status: 'completed',
            createdAt: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            dailyAmount: { $sum: '$vault' },
            dailyTransactions: { $sum: 1 }
          }
        }
      ]);

      const stats = {
        balance: mainVaultAccount.vault,
        totalDeductions: totalDeductions[0]?.totalAmount || 0,
        totalTransactions: totalDeductions[0]?.totalTransactions || 0,
        dailyDeductions: dailyDeductions[0]?.dailyAmount || 0,
        dailyTransactions: dailyDeductions[0]?.dailyTransactions || 0,
        deductionRate: vaultSettings.deductionRate, // Use rate from ride settings
        enabled: vaultSettings.enabled,
        currency: 'IQD',
        accountId: mainVaultAccount._id,
        lastUpdated: new Date()
      };

      this.logger.info('[PaymentService] Main vault stats retrieved successfully');
      return stats;

    } catch (error) {
      this.logger.error('[PaymentService] Error getting main vault stats:', error);
      throw error;
    }
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
      const Driver = require('../model/Driver');
      const FinancialAccount = require('../model/financialAccount');

      // Get captain with financial account
      const captain = await Driver.findById(captainId).populate('financialAccount');
      
      if (!captain || !captain.financialAccount) {
        this.logger.error(`[PaymentService] Captain or financial account not found: ${captainId}`);
        return;
      }

      // Update captain's financial account vault (main balance)
      captain.financialAccount.vault += earnings;
      
      // Add transaction record to captain's financial account
      captain.financialAccount.transactions.push({
        moneyTransfers: [],
        description: `أرباح من رحلة: ${earnings} دينار`,
        date: new Date()
      });

      await captain.financialAccount.save();

      // Update captain's summary fields (for quick access/reporting)
      await Driver.findByIdAndUpdate(captainId, {
        $inc: {
          totalEarnings: earnings,
          totalRides: 1
        },
        $set: {
          lastPaymentDate: new Date(),
          balance: captain.financialAccount.vault // Sync with financial account
        }
      });

      this.logger.debug(`[PaymentService] Updated captain ${captainId} earnings by ${earnings} via financialAccount`);
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
  async transferCommissionToAdmin(amount, description = 'Commission from ride', metadata = {}) {
    try {
      this.logger.info(`[transferCommissionToAdmin] Starting commission transfer: ${amount} IQD`);

      // Find admin user with role 'admin'
      let adminUser = await User.findOne({ role: 'admin' });
      
      if (!adminUser) {
        this.logger.warn('[transferCommissionToAdmin] Admin user not found, creating default admin');
        adminUser = await this.createDefaultAdminUser();
      }

      // Ensure admin has a financial account
      let adminFinancialAccount = await FinancialAccount.findOne({ user: adminUser._id });
      if (!adminFinancialAccount) {
        this.logger.info('[transferCommissionToAdmin] Creating financial account for admin');
        adminFinancialAccount = new FinancialAccount({
          user: adminUser._id,
          accountType: 'admin',
          currency: 'IQD',
          vault: 0,
          isActive: true,
          metadata: {
            createdBy: 'system',
            purpose: 'admin_earnings'
          }
        });
        await adminFinancialAccount.save();
      }

      // Use FinancialAccountService to add balance to admin
      const result = await this.financialAccountService.addBalance(
        adminFinancialAccount._id,
        amount,
        'commission',
        description,
        {
          ...metadata,
          category: 'admin_commission',
          automated: true,
          timestamp: new Date()
        }
      );

      this.logger.info(`[transferCommissionToAdmin] Commission transferred successfully: ${amount} IQD to admin`);
      return result;

    } catch (error) {
      this.logger.error('[transferCommissionToAdmin] Error transferring commission to admin:', error);
      throw error;
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
      const FinancialAccount = require('../model/financialAccount');

      // Get customer with financial account
      const customer = await Customer.findById(customerId).populate('financialAccount');
      
      if (!customer || !customer.financialAccount) {
        this.logger.error(`[PaymentService] Customer or financial account not found: ${customerId}`);
        return;
      }

      // Deduct amount from customer's financial account (they paid this amount)
      customer.financialAccount.vault -= amount;
      
      // Add transaction record to customer's financial account
      customer.financialAccount.transactions.push({
        moneyTransfers: [],
        description: `دفع ثمن رحلة: ${amount} دينار`,
        date: new Date()
      });

      await customer.financialAccount.save();

      // Update customer's summary fields (for quick access/reporting)
      await Customer.findByIdAndUpdate(customerId, {
        $inc: {
          totalSpent: amount,
          totalRides: 1
        },
        $set: {
          walletBalance: customer.financialAccount.vault // Sync with financial account
        }
      });

      this.logger.debug(`[PaymentService] Updated customer ${customerId} spending stats: +${amount} via financialAccount`);
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
      const Users = require('../model/user');
      const FinancialAccount = require('../model/financialAccount');
      
      // Get admin user with financial account
      const adminUser = await Users.findOne({ role: 'admin' }).populate('financialAccount');
      
      if (!adminUser || !adminUser.financialAccount) {
        this.logger.error('[PaymentService] Admin user or financial account not found for earnings update');
        return;
      }

      // Update admin's summary fields (for quick access/reporting)
      await User.findOneAndUpdate(
        { role: 'admin' },
        {
          $inc: {
            totalCommissions: commission,
            totalSystemEarnings: commission
          }
        }
      );

      this.logger.debug(`[PaymentService] Updated admin system earnings: +${commission} via financialAccount`);
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
      const Users = require('../model/user');
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
