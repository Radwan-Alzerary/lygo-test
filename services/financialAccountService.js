const FinancialAccount = require('../model/financialAccount');
const MoneyTransfers = require('../model/moneyTransfers');

/**
 * Financial Account Service
 * خدمة إدارة الحسابات المالية لجميع المستخدمين
 */
class FinancialAccountService {
  constructor(logger) {
    this.logger = logger;
  }

  /**
   * Transfer money between financial accounts
   * @param {Object} params - Transfer parameters
   * @param {string} params.fromAccountId - Source financial account ID
   * @param {string} params.toAccountId - Destination financial account ID  
   * @param {number} params.amount - Amount to transfer
   * @param {string} params.transferType - Type of transfer (dtc, dtu, etc.)
   * @param {string} params.fromRole - Source account role
   * @param {string} params.toRole - Destination account role
   * @param {string} params.description - Transaction description
   * @param {boolean} params.checkBalance - Whether to check sufficient balance
   * @returns {Object} Transfer result
   */
  async transferMoney({ 
    fromAccountId, 
    toAccountId, 
    amount, 
    transferType, 
    fromRole, 
    toRole, 
    description,
    checkBalance = true 
  }) {
    try {
      // Get both financial accounts
      const fromAccount = await FinancialAccount.findById(fromAccountId);
      const toAccount = await FinancialAccount.findById(toAccountId);

      if (!fromAccount || !toAccount) {
        throw new Error('One or both financial accounts not found');
      }

      // Check balance if required
      if (checkBalance && fromAccount.vault < amount) {
        this.logger.warn(`[FinancialAccount] Insufficient balance: ${fromAccount.vault} < ${amount}`);
        return { 
          success: false, 
          reason: 'insufficient_funds',
          availableBalance: fromAccount.vault,
          requiredAmount: amount
        };
      }

      // Create money transfer record
      const moneyTransfer = new MoneyTransfers({
        transferType,
        status: checkBalance && fromAccount.vault >= amount ? 'completed' : 'pending',
        from: { id: fromAccountId, role: fromRole },
        to: { id: toAccountId, role: toRole },
        vault: amount,
      });

      await moneyTransfer.save();

      // Update balances
      fromAccount.vault -= amount;
      toAccount.vault += amount;

      // Add transaction records
      fromAccount.transactions.push({
        moneyTransfers: [moneyTransfer._id],
        description: `${description} - مرسل`,
        date: new Date()
      });

      toAccount.transactions.push({
        moneyTransfers: [moneyTransfer._id],
        description: `${description} - مستلم`,
        date: new Date()
      });

      // Save both accounts
      await fromAccount.save();
      await toAccount.save();

      this.logger.info(`[FinancialAccount] Money transfer completed: ${amount} from ${fromAccountId} to ${toAccountId}`);

      return {
        success: true,
        transferId: moneyTransfer._id,
        fromBalance: fromAccount.vault,
        toBalance: toAccount.vault,
        status: 'completed'
      };

    } catch (error) {
      this.logger.error('[FinancialAccount] Error transferring money:', error);
      return {
        success: false,
        reason: 'transfer_failed',
        error: error.message
      };
    }
  }

  /**
   * Create pending transfer when balance is insufficient
   */
  async createPendingTransfer({
    fromAccountId,
    toAccountId,
    amount,
    transferType,
    fromRole,
    toRole,
    description
  }) {
    try {
      const fromAccount = await FinancialAccount.findById(fromAccountId);
      const toAccount = await FinancialAccount.findById(toAccountId);

      if (!fromAccount || !toAccount) {
        throw new Error('One or both financial accounts not found');
      }

      // Create pending money transfer record
      const moneyTransfer = new MoneyTransfers({
        transferType,
        status: 'pending',
        from: { id: fromAccountId, role: fromRole },
        to: { id: toAccountId, role: toRole },
        vault: amount,
      });

      await moneyTransfer.save();

      // Add transaction records (but don't change balances)
      fromAccount.transactions.push({
        moneyTransfers: [moneyTransfer._id],
        description: `${description} - دين مؤجل`,
        date: new Date()
      });

      toAccount.transactions.push({
        moneyTransfers: [moneyTransfer._id],
        description: `${description} - ائتمان مؤجل`,
        date: new Date()
      });

      await fromAccount.save();
      await toAccount.save();

      this.logger.info(`[FinancialAccount] Pending transfer created: ${amount} from ${fromAccountId} to ${toAccountId}`);

      return {
        success: true,
        transferId: moneyTransfer._id,
        status: 'pending'
      };

    } catch (error) {
      this.logger.error('[FinancialAccount] Error creating pending transfer:', error);
      return {
        success: false,
        reason: 'pending_transfer_failed',
        error: error.message
      };
    }
  }

  /**
   * Add balance to financial account
   */
  async addBalance(accountId, amount, description) {
    try {
      const account = await FinancialAccount.findById(accountId);
      
      if (!account) {
        throw new Error('Financial account not found');
      }

      account.vault += amount;
      account.transactions.push({
        moneyTransfers: [],
        description: description,
        date: new Date()
      });

      await account.save();

      this.logger.info(`[FinancialAccount] Balance added: ${amount} to account ${accountId}`);

      return {
        success: true,
        newBalance: account.vault
      };

    } catch (error) {
      this.logger.error('[FinancialAccount] Error adding balance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Deduct balance from financial account
   */
  async deductBalance(accountId, amount, description, checkBalance = true) {
    try {
      const account = await FinancialAccount.findById(accountId);
      
      if (!account) {
        throw new Error('Financial account not found');
      }

      if (checkBalance && account.vault < amount) {
        return {
          success: false,
          reason: 'insufficient_funds',
          availableBalance: account.vault
        };
      }

      account.vault -= amount;
      account.transactions.push({
        moneyTransfers: [],
        description: description,
        date: new Date()
      });

      await account.save();

      this.logger.info(`[FinancialAccount] Balance deducted: ${amount} from account ${accountId}`);

      return {
        success: true,
        newBalance: account.vault
      };

    } catch (error) {
      this.logger.error('[FinancialAccount] Error deducting balance:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get account balance and recent transactions
   */
  async getAccountSummary(accountId, limit = 10) {
    try {
      const account = await FinancialAccount.findById(accountId)
        .populate('transactions.moneyTransfers');
      
      if (!account) {
        return null;
      }

      return {
        balance: account.vault,
        recentTransactions: account.transactions
          .slice(-limit)
          .reverse() // Most recent first
      };

    } catch (error) {
      this.logger.error('[FinancialAccount] Error getting account summary:', error);
      return null;
    }
  }

  /**
   * Process all pending transfers for a specific account when balance becomes available
   */
  async processPendingTransfers(fromAccountId) {
    try {
      const pendingTransfers = await MoneyTransfers.find({
        'from.id': fromAccountId,
        status: 'pending'
      });

      const account = await FinancialAccount.findById(fromAccountId);
      
      if (!account) {
        return { processed: 0, failed: 0 };
      }

      let processed = 0;
      let failed = 0;

      for (const transfer of pendingTransfers) {
        if (account.vault >= transfer.vault) {
          const result = await this.transferMoney({
            fromAccountId: transfer.from.id,
            toAccountId: transfer.to.id,
            amount: transfer.vault,
            transferType: transfer.transferType,
            fromRole: transfer.from.role,
            toRole: transfer.to.role,
            description: 'معالجة تحويل مؤجل',
            checkBalance: true
          });

          if (result.success) {
            // Mark original transfer as completed
            transfer.status = 'completed';
            await transfer.save();
            processed++;
          } else {
            failed++;
          }
        }
      }

      this.logger.info(`[FinancialAccount] Processed pending transfers: ${processed} completed, ${failed} failed`);

      return { processed, failed };

    } catch (error) {
      this.logger.error('[FinancialAccount] Error processing pending transfers:', error);
      return { processed: 0, failed: 0, error: error.message };
    }
  }
}

module.exports = FinancialAccountService;
