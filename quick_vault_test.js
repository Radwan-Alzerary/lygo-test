// Quick test for main vault system
console.log("🧪 Testing Main Vault Integration...");

const mongoose = require("mongoose");

// Mock test to verify the logic
async function quickTest() {
  console.log("1. Testing deduction calculation:");
  const rideAmount = 3000;
  const deductionRate = 0.20;
  const expectedDeduction = Math.round(rideAmount * deductionRate);
  
  console.log(`   Ride Amount: ${rideAmount} IQD`);
  console.log(`   Deduction Rate: ${deductionRate * 100}%`);
  console.log(`   Expected Deduction: ${expectedDeduction} IQD`);
  
  console.log("\n2. Testing captain balance scenarios:");
  const captainBalance = 10000;
  console.log(`   Captain Initial Balance: ${captainBalance} IQD`);
  console.log(`   After Deduction: ${captainBalance - expectedDeduction} IQD`);
  
  if (captainBalance >= expectedDeduction) {
    console.log("   ✅ Captain has sufficient balance");
  } else {
    console.log("   ❌ Captain has insufficient balance");
  }
  
  console.log("\n3. Testing multiple rides:");
  let currentBalance = captainBalance;
  const rides = [3000, 2500, 4000, 1500, 2000];
  
  for (let i = 0; i < rides.length; i++) {
    const deduction = Math.round(rides[i] * deductionRate);
    console.log(`   Ride ${i + 1}: ${rides[i]} IQD, Deduction: ${deduction} IQD`);
    
    if (currentBalance >= deduction) {
      currentBalance -= deduction;
      console.log(`     ✅ Accepted. New balance: ${currentBalance} IQD`);
    } else {
      console.log(`     ❌ Rejected. Insufficient balance (need ${deduction}, have ${currentBalance})`);
    }
  }
  
  console.log(`\n📊 Final captain balance: ${currentBalance} IQD`);
  console.log(`💰 Total deducted to main vault: ${captainBalance - currentBalance} IQD`);
}

quickTest().then(() => {
  console.log("\n🎉 Quick test completed!");
}).catch(console.error);
