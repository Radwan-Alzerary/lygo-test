const express = require('express');
const router = express.Router();
const FinancialAccount = require('../model/financialAccount');
const transfer = require('../services/TransferMoney');

// Get financial account details for a User
router.get('/financial/user/:id', async (req, res) => {
  try {
    const userId = req.params.id;
    const financialAccount = await FinancialAccount.findById(userId).populate('transactions.moneyTransfers');
    if (!financialAccount) {
      return res.status(404).json({ message: 'Financial account not found' });
    }
    res.status(200).json(financialAccount);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving financial account', error });
  }
});

// Get financial account details for a Customer
router.get('/financial/customer/:id', async (req, res) => {
  try {
    const customerId = req.params.id;
    const financialAccount = await FinancialAccount.findById(customerId).populate('transactions.moneyTransfers');
    if (!financialAccount) {
      return res.status(404).json({ message: 'Financial account not found' });
    }
    res.status(200).json(financialAccount);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving financial account', error });
  }
});

// Get financial account details for a Driver
router.get('/financial/driver/:id', async (req, res) => {
  try {
    const driverId = req.params.id;
    const financialAccount = await FinancialAccount.findById(driverId).populate('transactions.moneyTransfers');
    if (!financialAccount) {
      return res.status(404).json({ message: 'Financial account not found' });
    }
    res.status(200).json(financialAccount);
  } catch (error) {
    res.status(500).json({ message: 'Error retrieving financial account', error });
  }
});

// POST route for transferring money
router.post('/transfer', async (req, res) => {
    const { type, fromId, toId, amount } = req.body;
    
    console.log(type,fromId,toId,amount)
    
    try {
      await transfer(type, fromId, toId, amount);
      res.status(200).json({ message: 'Transfer successful' });
    } catch (error) {
      res.status(500).json({ message: 'Error processing transfer', error });
    }
  });
  
  

module.exports = router;
