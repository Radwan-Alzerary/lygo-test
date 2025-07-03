const express = require('express');
const router = express.Router();
const Customer = require('../../model/customer');
const MoneyTransfers = require('../../model/moneyTransfers');
const { createFinancialAccount, updateBalance } = require('../../utils/routeHelpers');
const { verifyToken } = require('../../middlewares/customerMiddlewareAyuth');
const ride = require('../../model/ride');

// GET / - Get all customers
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search } = req.query;
    
    // Build query
    let query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const customers = await Customer.find(query)
      .populate('financialAccount')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Customer.countDocuments(query);

    const customersData = customers.map(customer => ({
      id: customer._id,
      name: customer.name,
      phone: customer.phoneNumber,
      email: customer.email,
      balance: customer.financialAccount?.vault || 0,
      totalRides: customer.rideHistory?.length || 0,
      createdAt: customer.createdAt
    }));

    res.json({
      customers: customersData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Customers fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /:id - Get single customer
router.get('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .populate('financialAccount')
      .lean();

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const customerData = {
      id: customer._id,
      name: customer.name,
      phone: customer.phoneNumber,
      email: customer.email,
      balance: customer.financialAccount?.vault || 0,
      totalRides: customer.rideHistory?.length || 0,
      createdAt: customer.createdAt
    };

    res.json(customerData);
  } catch (error) {
    console.error('Customer fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});
router.get('/myRides/getall',verifyToken, async (req, res) => {
  try {
   console.log("Fetching customer rides");
   console.log(req.user);
    const customer = await ride.find({passenger: req.user.id})
    res.json(customer);
  } catch (error) {
    console.error('Customer fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST / - Create new customer
router.post('/', async (req, res) => {
  try {
    const customerData = req.body;
    
    // Check if phone number already exists
    const existingCustomer = await Customer.findOne({ phoneNumber: customerData.phoneNumber });
    if (existingCustomer) {
      return res.status(400).json({ error: 'Phone number already exists' });
    }
    
    // Create financial account for new customer
    const financialAccountId = await createFinancialAccount();
    
    const customer = new Customer({
      ...customerData,
      financialAccount: financialAccountId,
      rideHistory: []
    });

    await customer.save();
    await customer.populate('financialAccount');

    const responseData = {
      id: customer._id,
      name: customer.name,
      phone: customer.phoneNumber,
      email: customer.email,
      balance: customer.financialAccount.vault,
      totalRides: 0
    };

    res.status(201).json(responseData);
  } catch (error) {
    console.error('Customer creation error:', error);
    res.status(400).json({ error: error.message });
  }
});

// PATCH /:id/balance - Update customer balance
router.patch('/:id/balance', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const updatedCustomer = await updateBalance(id, amount, 'customer');
    await updatedCustomer.populate('financialAccount');

    // Create money transfer record
    const moneyTransfer = new MoneyTransfers({
      vault: amount,
      transferType: amount > 0 ? 'credit' : 'debit',
      from: {
        id: id,
        role: 'Customer'
      },
      to: {
        id: id,
        role: 'Customer'
      }
    });
    await moneyTransfer.save();

    const responseData = {
      id: updatedCustomer._id,
      name: updatedCustomer.name,
      phone: updatedCustomer.phoneNumber,
      email: updatedCustomer.email,
      balance: updatedCustomer.financialAccount.vault,
      totalRides: updatedCustomer.rideHistory?.length || 0
    };

    res.json(responseData);
  } catch (error) {
    console.error('Customer balance update error:', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;