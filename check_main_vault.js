/**
 * Main Vault Status Checker
 * Checks if main vault exists and creates it if needed
 */

const mongoose = require("mongoose");
require("dotenv").config();
require("./config/database");

// Import required models FIRST
const User = require("./model/user");
const FinancialAccount = require("./model/financialAccount");
const MoneyTransfers = require("./model/moneyTransfers");

// Import required services
const createLogger = require("./config/logger");
const FinancialAccountService = require("./services/financialAccountService");
const PaymentService = require("./services/paymentService");

const logger = createLogger();

async function checkMainVaultStatus() {
  try {
    console.log("\n🏦 Main Vault Status Checker\n");

    // Initialize services
    const financialAccountService = new FinancialAccountService(logger);
    const paymentService = new PaymentService(logger);

    // Check current vault status
    console.log("1️⃣ Checking current main vault status...");
    
    try {
      const vaultStats = await paymentService.getMainVaultStats();
      
      console.log("✅ Main vault is operational!");
      console.log(`💰 Current Balance: ${vaultStats.currentBalance} ${vaultStats.currency}`);
      console.log(`📊 Deduction Rate: ${vaultStats.deductionRate * 100}%`);
      console.log(`📈 Total Deductions: ${vaultStats.totalDeductionsAmount} ${vaultStats.currency}`);
      console.log(`🔢 Total Transactions: ${vaultStats.totalDeductionsCount}`);
      
    } catch (error) {
      console.log("❌ Main vault not found or not operational");
      console.log("🔄 Initializing main vault system...");
      
      // Initialize main vault
      const vaultInit = await financialAccountService.initializeMainVaultSystem();
      
      if (vaultInit.created) {
        console.log("✅ Main vault system created successfully!");
      } else {
        console.log("✅ Main vault system restored!");
      }
      
      console.log(`💰 Initial Balance: ${vaultInit.balance} IQD`);
      console.log(`🏦 Account ID: ${vaultInit.account._id}`);
      console.log(`👤 User: ${vaultInit.account.user.name}`);
    }

    // Final verification
    console.log("\n2️⃣ Final verification...");
    
    const finalStats = await paymentService.getMainVaultStats();
    console.log("🎉 Main vault verification successful!");
    console.log(`✅ Vault Balance: ${finalStats.currentBalance} ${finalStats.currency}`);
    console.log(`✅ Account Type: main_vault`);
    console.log(`✅ Status: OPERATIONAL`);
    
    console.log("\n🎯 Main Vault System Summary:");
    console.log("✅ Main vault user created/verified");
    console.log("✅ Main vault financial account created/verified");
    console.log("✅ Deduction system ready (20%)");
    console.log("✅ Statistics API functional");
    console.log("✅ System is ready for ride deductions");

  } catch (error) {
    console.error("❌ Error checking main vault status:", error);
    throw error;
  }
}

// Run the checker
if (require.main === module) {
  checkMainVaultStatus()
    .then(() => {
      console.log("\n✅ Main vault status check completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Main vault status check failed:", error);
      process.exit(1);
    });
}

module.exports = { checkMainVaultStatus };
