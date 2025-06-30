const Driver = require('../model/Driver');
const Customer = require('../model/customer');
const FinancialAccount = require('../model/financialAccount');
const MoneyTransfers = require('../model/moneyTransfers');

// Helper function to create financial account for new users
const createFinancialAccount = async () => {
  const financialAccount = new FinancialAccount({
    vault: 0,
    transactions: []
  });
  await financialAccount.save();
  return financialAccount._id;
};

// Helper function to update balance
const updateBalance = async (userId, amount, userType) => {
  const Model = userType === 'driver' ? Driver : Customer;
  const user = await Model.findById(userId).populate('financialAccount');
  
  if (!user) {
    throw new Error('User not found');
  }

  if (!user.financialAccount) {
    // Create financial account if it doesn't exist
    const financialAccountId = await createFinancialAccount();
    user.financialAccount = financialAccountId;
    await user.save();
    await user.populate('financialAccount');
  }

  // Update vault balance
  user.financialAccount.vault += amount;
  
  // Add transaction record
  user.financialAccount.transactions.push({
    date: new Date(),
    description: `Balance ${amount > 0 ? 'credit' : 'debit'} of ${Math.abs(amount)} IQD`
  });

  await user.financialAccount.save();
  return user;
};

module.exports = {
  createFinancialAccount,
  updateBalance
};