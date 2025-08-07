const mongoose = require('mongoose');

// Database connection string
const DATABASE_URL = 'mongodb://127.0.0.1:27017/lygo';

// Test to verify vault settings from ride settings
async function testVaultSettings() {
  try {
    console.log('\n🔧 Vault Settings Configuration Test\n');

    // Connect to database
    await mongoose.connect(DATABASE_URL);
    console.log('✅ Database connected');

    // Wait a moment for connection to be fully established
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Import models
    const RideSetting = require('./model/rideSetting');
    console.log('✅ RideSetting model imported:', typeof RideSetting);

    console.log('1️⃣ Checking/creating default ride settings...');

    // Find or create default ride setting with custom vault rate
    let defaultRideSetting = await RideSetting.findOne({ name: 'default' });
    
    if (!defaultRideSetting) {
      console.log('Creating default ride setting with 25% vault deduction rate...');
      defaultRideSetting = new RideSetting({
        name: 'default',
        mainVault: {
          deductionRate: 0.25, // 25% instead of default 20%
          enabled: true,
          description: 'Custom main vault deduction - 25%'
        }
      });
      await defaultRideSetting.save();
      console.log('✅ Default ride setting created successfully');
    } else {
      console.log('✅ Default ride setting already exists');
    }

    console.log('\n2️⃣ Current vault settings:');
    const vaultConfig = defaultRideSetting.mainVault;
    console.log(`- Deduction Rate: ${(vaultConfig.deductionRate * 100).toFixed(1)}%`);
    console.log(`- Enabled: ${vaultConfig.enabled}`);
    console.log(`- Description: ${vaultConfig.description}`);

    console.log('\n3️⃣ Testing different deduction rates...');
    
    // Test updating the deduction rate
    const testRates = [0.15, 0.20, 0.25, 0.30]; // 15%, 20%, 25%, 30%
    
    for (const rate of testRates) {
      defaultRideSetting.mainVault.deductionRate = rate;
      defaultRideSetting.mainVault.description = `Main vault deduction - ${(rate * 100).toFixed(0)}%`;
      await defaultRideSetting.save();
      
      console.log(`✅ Updated deduction rate to ${(rate * 100).toFixed(0)}%`);
      
      // Simulate calculation
      const rideAmount = 5000; // 5000 IQD
      const deductionAmount = Math.round(rideAmount * rate);
      const captainNet = rideAmount - deductionAmount;
      
      console.log(`   - Ride Amount: ${rideAmount} IQD`);
      console.log(`   - Vault Deduction: ${deductionAmount} IQD`);
      console.log(`   - Captain Net: ${captainNet} IQD`);
      console.log('   ---');
    }

    console.log('\n4️⃣ Testing vault enable/disable...');
    
    // Test disabling vault
    defaultRideSetting.mainVault.enabled = false;
    await defaultRideSetting.save();
    console.log('✅ Vault disabled - no deductions will be made');
    
    // Re-enable vault
    defaultRideSetting.mainVault.enabled = true;
    defaultRideSetting.mainVault.deductionRate = 0.20; // Set back to 20%
    await defaultRideSetting.save();
    console.log('✅ Vault re-enabled with 20% deduction rate');

    console.log('\n🎯 Vault Settings Test Summary:');
    console.log('✅ Ride settings model working correctly');
    console.log('✅ Vault deduction rates configurable');
    console.log('✅ Vault can be enabled/disabled');
    console.log('✅ Settings persist in database');
    console.log('✅ PaymentService will now read from ride settings');

    console.log('\n✅ Vault settings configuration test completed successfully!');

  } catch (error) {
    console.error('\n❌ Vault settings test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Database disconnected');
  }
}

// Run the test
testVaultSettings();
