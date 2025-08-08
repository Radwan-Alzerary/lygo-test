#!/usr/bin/env node
/**
 * Test script to verify the FinancialAccount validation fix
 * Tests that accounts are created with all required fields
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Connect to database
require('./config/database');

const PaymentService = require('./services/paymentService');
const FinancialAccountService = require('./services/financialAccountService');
const createLogger = require('./config/logger');

async function testFinancialAccountCreation() {
  const logger = createLogger();
  
  try {
    logger.info('=== Testing FinancialAccount Creation Fix ===');
    
    // Initialize services
    const financialAccountService = new FinancialAccountService(logger);
    const paymentService = new PaymentService(logger, null); // No Redis needed for this test
    
    // Test 1: Create captain account
    logger.info('Test 1: Creating captain account...');
    const captainAccount = await financialAccountService.createAccount(
      '507f1f77bcf86cd799439011', // Dummy ObjectId
      'captain',
      0,
      { purpose: 'test_captain_account' }
    );
    
    logger.info(`✅ Captain account created successfully: ${captainAccount._id}`);
    logger.info(`   - User: ${captainAccount.user}`);
    logger.info(`   - Account Type: ${captainAccount.accountType}`);
    logger.info(`   - Balance: ${captainAccount.vault} ${captainAccount.currency}`);
    
    // Test 2: Create customer account
    logger.info('Test 2: Creating customer account...');
    const customerAccount = await financialAccountService.createAccount(
      '507f1f77bcf86cd799439012', // Dummy ObjectId
      'customer',
      0,
      { purpose: 'test_customer_account' }
    );
    
    logger.info(`✅ Customer account created successfully: ${customerAccount._id}`);
    logger.info(`   - User: ${customerAccount.user}`);
    logger.info(`   - Account Type: ${customerAccount.accountType}`);
    logger.info(`   - Balance: ${customerAccount.vault} ${customerAccount.currency}`);
    
    // Test 3: Create admin account
    logger.info('Test 3: Creating admin account...');
    const adminAccount = await financialAccountService.createAccount(
      '507f1f77bcf86cd799439013', // Dummy ObjectId
      'admin',
      0,
      { purpose: 'test_admin_account' }
    );
    
    logger.info(`✅ Admin account created successfully: ${adminAccount._id}`);
    logger.info(`   - User: ${adminAccount.user}`);
    logger.info(`   - Account Type: ${adminAccount.accountType}`);
    logger.info(`   - Balance: ${adminAccount.vault} ${adminAccount.currency}`);
    
    // Cleanup test accounts
    logger.info('Cleaning up test accounts...');
    await financialAccountService.FinancialAccount.deleteMany({
      user: { $in: ['507f1f77bcf86cd799439011', '507f1f77bcf86cd799439012', '507f1f77bcf86cd799439013'] }
    });
    
    logger.info('✅ All tests passed! FinancialAccount validation issues are fixed.');
    
  } catch (error) {
    logger.error('❌ Test failed:', error);
    process.exit(1);
  } finally {
    // Close database connection
    setTimeout(() => {
      mongoose.connection.close();
      process.exit(0);
    }, 1000);
  }
}

testFinancialAccountCreation();
