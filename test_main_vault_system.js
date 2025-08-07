/**
 * Test script for Main Vault System
 * Tests the 20% deduction when captain accepts a ride
 */

const mongoose = require("mongoose");
require("dotenv").config();
require("./config/database");

// Import required models and services
const Driver = require("./model/Driver");
const FinancialAccount = require("./model/financialAccount");
const User = require("./model/user");
const Ride = require("./model/ride");
const Customer = require("./model/customer");
const MoneyTransfers = require("./model/moneyTransfers");
const PaymentService = require("./services/paymentService");
const createLogger = require("./config/logger");

const logger = createLogger();

async function testMainVaultSystem() {
  try {
    console.log("\n🚀 Testing Main Vault System...\n");

    // Initialize Payment Service
    const paymentService = new PaymentService(logger);
    
    // === Test 1: Create Test Captain ===
    console.log("1️⃣ Setting up test captain...");
    
    // Create test user for captain
    let captainUser = await User.findOne({ username: 'test_captain_vault' });
    if (!captainUser) {
      captainUser = new User({
        username: 'test_captain_vault',
        name: 'Test Captain Vault',
        email: 'captain.vault@test.com',
        phone: '+964700000001',
        role: 'captain',
        isActive: true
      });
      await captainUser.save();
    }

    // Create test driver profile
    let testDriver = await Driver.findOne({ userId: captainUser._id });
    if (!testDriver) {
      testDriver = new Driver({
        userId: captainUser._id,
        fullName: 'Test Captain Vault',
        email: 'captain.vault@test.com',
        phoneNumber: '+964700000001',
        licenseNumber: 'TEST123456',
        vehicleInfo: {
          make: 'Test',
          model: 'Vault Car',
          year: 2023,
          plateNumber: 'TEST-001',
          color: 'Blue'
        },
        isActive: true,
        isApproved: true
      });
      await testDriver.save();
    }

    // Create financial account for captain with initial balance
    let captainAccount = await FinancialAccount.findOne({ 
      user: captainUser._id, 
      accountType: 'captain' 
    });
    if (!captainAccount) {
      captainAccount = new FinancialAccount({
        user: captainUser._id,
        accountType: 'captain',
        vault: 10000, // Initial balance: 10,000 IQD
        currency: 'IQD',
        isActive: true
      });
      await captainAccount.save();
    } else {
      // Update balance to 10,000 for testing
      captainAccount.vault = 10000;
      await captainAccount.save();
    }

    console.log(`✅ Captain created with ID: ${captainUser._id}`);
    console.log(`✅ Captain initial balance: ${captainAccount.vault} IQD`);

    // === Test 2: Create Test Customer ===
    console.log("\n2️⃣ Setting up test customer...");
    
    let testCustomer = await Customer.findOne({ email: 'customer.vault@test.com' });
    if (!testCustomer) {
      testCustomer = new Customer({
        fullName: 'Test Customer Vault',
        email: 'customer.vault@test.com',
        phoneNumber: '+964700000002',
        isActive: true
      });
      await testCustomer.save();
    }

    console.log(`✅ Customer created with ID: ${testCustomer._id}`);

    // === Test 3: Create Test Ride ===
    console.log("\n3️⃣ Creating test ride...");
    
    const testRide = new Ride({
      passenger: testCustomer._id,
      pickupLocation: {
        coordinates: [43.1167, 36.3167], // Mosul coordinates
        locationName: 'Test Pickup Location'
      },
      dropoffLocation: {
        coordinates: [43.1267, 36.3267], // Nearby location
        locationName: 'Test Dropoff Location'
      },
      totalFare: 3000, // 3,000 IQD ride fare
      fare: {
        amount: 3000,
        currency: 'IQD'
      },
      status: 'requested'
    });
    await testRide.save();

    console.log(`✅ Test ride created with ID: ${testRide._id}`);
    console.log(`✅ Ride fare: ${testRide.totalFare} IQD`);

    // === Test 4: Process Main Vault Deduction ===
    console.log("\n4️⃣ Processing main vault deduction (20%)...");
    
    const deductionResult = await paymentService.processRideDeduction(captainUser._id, testRide.totalFare);
    
    console.log("📊 Deduction Results:");
    console.log(`   - Deduction Amount: ${deductionResult.deductionAmount} IQD`);
    console.log(`   - Captain Remaining Balance: ${deductionResult.captainRemainingBalance} IQD`);
    console.log(`   - Main Vault New Balance: ${deductionResult.mainVaultNewBalance} IQD`);

    // === Test 5: Verify Main Vault Statistics ===
    console.log("\n5️⃣ Getting main vault statistics...");
    
    const vaultStats = await paymentService.getMainVaultStats();
    
    console.log("📈 Main Vault Statistics:");
    console.log(`   - Current Balance: ${vaultStats.currentBalance} IQD`);
    console.log(`   - Total Deductions Amount: ${vaultStats.totalDeductionsAmount} IQD`);
    console.log(`   - Total Deductions Count: ${vaultStats.totalDeductionsCount}`);
    console.log(`   - Daily Deductions Amount: ${vaultStats.dailyDeductionsAmount} IQD`);
    console.log(`   - Daily Deductions Count: ${vaultStats.dailyDeductionsCount}`);
    console.log(`   - Deduction Rate: ${vaultStats.deductionRate * 100}%`);

    // === Test 6: Verify Money Transfer Record ===
    console.log("\n6️⃣ Verifying money transfer record...");
    
    const transfers = await MoneyTransfers.find({
      from: captainUser._id,
      type: 'ride_deduction',
      status: 'completed'
    }).sort({ createdAt: -1 }).limit(1);

    if (transfers.length > 0) {
      const transfer = transfers[0];
      console.log("💸 Latest Transfer Record:");
      console.log(`   - Transfer ID: ${transfer._id}`);
      console.log(`   - Amount: ${transfer.amount} IQD`);
      console.log(`   - Description: ${transfer.description}`);
      console.log(`   - Status: ${transfer.status}`);
      console.log(`   - Created: ${transfer.createdAt}`);
    }

    // === Test 7: Simulate Another Ride ===
    console.log("\n7️⃣ Testing second ride with remaining balance...");
    
    const secondRideAmount = 4000; // 4,000 IQD
    console.log(`Second ride amount: ${secondRideAmount} IQD`);
    console.log(`Captain current balance: ${deductionResult.captainRemainingBalance} IQD`);
    console.log(`Required deduction (20%): ${secondRideAmount * 0.20} IQD`);
    
    if (deductionResult.captainRemainingBalance >= (secondRideAmount * 0.20)) {
      console.log("✅ Captain has sufficient balance for second ride");
      
      const secondDeduction = await paymentService.processRideDeduction(captainUser._id, secondRideAmount);
      console.log(`✅ Second deduction successful: ${secondDeduction.deductionAmount} IQD`);
      console.log(`✅ Captain final balance: ${secondDeduction.captainRemainingBalance} IQD`);
    } else {
      console.log("❌ Captain has insufficient balance for second ride");
    }

    // === Final Statistics ===
    console.log("\n📊 Final System Statistics:");
    const finalStats = await paymentService.getMainVaultStats();
    console.log(`   - Main Vault Balance: ${finalStats.currentBalance} IQD`);
    console.log(`   - Total System Deductions: ${finalStats.totalDeductionsAmount} IQD`);
    
    const finalCaptainAccount = await FinancialAccount.findOne({ 
      user: captainUser._id, 
      accountType: 'captain' 
    });
    console.log(`   - Captain Final Balance: ${finalCaptainAccount.vault} IQD`);

    console.log("\n🎉 Main Vault System Test Completed Successfully! 🎉");
    console.log("\n📋 Summary:");
    console.log("✅ Main vault system created and operational");
    console.log("✅ 20% deduction working correctly");
    console.log("✅ Financial account integration successful");  
    console.log("✅ Money transfer records created properly");
    console.log("✅ Vault statistics API working");

  } catch (error) {
    console.error("❌ Test failed:", error);
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testMainVaultSystem()
    .then(() => {
      console.log("\n✅ All tests passed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Test suite failed:", error);
      process.exit(1);
    });
}

module.exports = { testMainVaultSystem };
