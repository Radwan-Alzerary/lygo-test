const express = require('express');
const router = express.Router();
const MoneyTransfers = require('../../model/moneyTransfers');

// GET /transactions - Get financial transactions
router.get('/transactions', async (req, res) => {
  try {
    const { page = 1, limit = 50, type, userId } = req.query;
    
    let query = {};
    
    if (type) {
      query.transferType = type;
    }
    
    if (userId) {
      query.$or = [
        { 'from.id': userId },
        { 'to.id': userId }
      ];
    }

    const transactions = await MoneyTransfers.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await MoneyTransfers.countDocuments(query);

    res.json({
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Transactions fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;