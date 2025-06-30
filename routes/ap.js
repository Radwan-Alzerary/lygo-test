const express = require('express');
const router = express.Router();
const Driver = require('../model/Driver');
const Customer = require('../model/customer');
const Ride = require('../model/ride');
const FinancialAccount = require('../model/financialAccount');
const MoneyTransfers = require('../model/moneyTransfers');
const RideSetting = require('../model/rideSetting');

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

// ================================
// DASHBOARD OVERVIEW ENDPOINTS
// ================================

// GET /api/dashboard - Dashboard overview
router.get('/dashboard', async (req, res) => {
  try {
    // Get counts and statistics
    const [
      totalDrivers,
      activeDrivers,
      totalCustomers,
      totalRides,
      completedRides,
      todayRides,
      pendingRides,
      totalRevenue
    ] = await Promise.all([
      Driver.countDocuments({ active: true }),
      Driver.countDocuments({ active: true, isAvailable: true }),
      Customer.countDocuments(),
      Ride.countDocuments(),
      Ride.countDocuments({ status: 'completed' }),
      Ride.countDocuments({ 
        createdAt: { 
          $gte: new Date(new Date().setHours(0, 0, 0, 0)) 
        } 
      }),
      Ride.countDocuments({ 
        status: { $in: ['requested', 'accepted', 'arrived', 'onRide'] } 
      }),
      Ride.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$fare' } } }
      ])
    ]);

    // Calculate average rating from completed rides with driver ratings
    const avgRatingResult = await Ride.aggregate([
      { $match: { status: 'completed', driverRating: { $exists: true, $ne: null } } },
      { $group: { _id: null, avgRating: { $avg: '$driverRating' } } }
    ]);

    const averageRating = avgRatingResult.length > 0 ? avgRatingResult[0].avgRating : 0;

    // Get recent rides for activity
    const recentRides = await Ride.find()
      .populate('driver', 'name')
      .populate('passenger', 'name')
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();

    const dashboardData = {
      overview: {
        totalRides,
        completedRides,
        activeDrivers,
        totalDrivers,
        totalCustomers,
        todayRides,
        pendingRides,
        totalRevenue: totalRevenue.length > 0 ? totalRevenue[0].total : 0,
        averageRating: Math.round(averageRating * 10) / 10
      },
      recentActivity: recentRides.map(ride => ({
        id: ride._id,
        type: 'ride',
        description: `رحلة من ${ride.pickupAddress || 'موقع غير محدد'} إلى ${ride.dropoffAddress || 'موقع غير محدد'}`,
        driver: ride.driver?.name || 'غير محدد',
        passenger: ride.passenger?.name || 'غير محدد',
        status: ride.status,
        amount: ride.fare,
        time: ride.createdAt
      }))
    };

    res.json(dashboardData);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// SETTINGS ENDPOINTS
// ================================

// GET /api/settings - Get ride settings
router.get('/settings', async (req, res) => {
  try {
    // Get the default settings or create them if they don't exist
    let settings = await RideSetting.findOne({ name: 'default' });
    
    if (!settings) {
      // Create default settings
      settings = new RideSetting({
        name: 'default',
        fare: {
          currency: 'IQD',
          baseFare: 3000,
          pricePerKm: 500,
          pricePerMinute: 0,
          minRidePrice: 2000,
          maxRidePrice: 7000,
          nightMultiplier: 1.2,
          weekendMultiplier: 1.15,
          surge: {
            enabled: false,
            multiplier: 1.5,
            activeFrom: null,
            activeTo: null
          }
        },
        dispatch: {
          initialRadiusKm: 2,
          maxRadiusKm: 10,
          radiusIncrementKm: 1,
          notificationTimeout: 15,
          maxDispatchTime: 300,
          graceAfterMaxRadius: 30
        },
        captainRules: {
          maxTopUpLimit: 1000,
          minWalletBalance: 0,
          minRating: 3.5,
          maxActiveRides: 1
        },
        passengerRules: {
          cancellationFee: 1000,
          freeCancelWindow: 120,
          minRatingRequired: 0
        },
        paymentMethods: ['cash', 'wallet'],
        allowShared: false
      });
      
      await settings.save();
    }

    res.json(settings);
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings - Update ride settings
router.put('/settings', async (req, res) => {
  try {
    const updateData = req.body;
    
    // Find and update settings or create new ones
    let settings = await RideSetting.findOneAndUpdate(
      { name: 'default' },
      updateData,
      { new: true, upsert: true, runValidators: true }
    );

    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings
    });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(400).json({ 
      success: false,
      error: error.message 
    });
  }
});

// POST /api/settings/reset - Reset settings to defaults
router.post('/settings/reset', async (req, res) => {
  try {
    const defaultSettings = {
      name: 'default',
      fare: {
        currency: 'IQD',
        baseFare: 3000,
        pricePerKm: 500,
        pricePerMinute: 0,
        minRidePrice: 2000,
        maxRidePrice: 7000,
        nightMultiplier: 1.2,
        weekendMultiplier: 1.15,
        surge: {
          enabled: false,
          multiplier: 1.5,
          activeFrom: null,
          activeTo: null
        }
      },
      dispatch: {
        initialRadiusKm: 2,
        maxRadiusKm: 10,
        radiusIncrementKm: 1,
        notificationTimeout: 15,
        maxDispatchTime: 300,
        graceAfterMaxRadius: 30
      },
      captainRules: {
        maxTopUpLimit: 1000,
        minWalletBalance: 0,
        minRating: 3.5,
        maxActiveRides: 1
      },
      passengerRules: {
        cancellationFee: 1000,
        freeCancelWindow: 120,
        minRatingRequired: 0
      },
      paymentMethods: ['cash', 'wallet'],
      allowShared: false
    };

    const settings = await RideSetting.findOneAndUpdate(
      { name: 'default' },
      defaultSettings,
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      message: 'Settings reset to defaults successfully',
      settings
    });
  } catch (error) {
    console.error('Settings reset error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ================================
// DRIVER ENDPOINTS
// ================================

// GET /api/drivers - Get all drivers
router.get('/drivers', async (req, res) => {
  try {
    const { page = 1, limit = 50, status, search } = req.query;
    
    // Build query
    let query = { active: true };
    
    if (status && status !== 'all') {
      query.isAvailable = status === 'available';
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const drivers = await Driver.find(query)
      .populate('financialAccount')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Driver.countDocuments(query);

    const driversData = drivers.map(driver => {
      return {
        id: driver._id,
        name: driver.name,
        email: driver.email,
        phoneNumber: driver.phoneNumber,
        whatsAppPhoneNumber: driver.whatsAppPhoneNumber,
        profileImage: driver.profileImage,
        carDetails: driver.carDetails,
        rating: 0, // Calculate from completed rides if needed
        totalRides: driver.rideHistory?.length || 0,
        balance: driver.financialAccount?.vault || 0,
        isAvailable: driver.isAvailable,
        age: driver.age,
        address: driver.address,
        currentLocation: driver.currentLocation,
        createdAt: driver.createdAt
      };
    });

    res.json({
      drivers: driversData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Drivers fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/drivers/:id - Get single driver
router.get('/drivers/:id', async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id)
      .populate('financialAccount')
      .lean();

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const driverData = {
      id: driver._id,
      name: driver.name,
      email: driver.email,
      phoneNumber: driver.phoneNumber,
      whatsAppPhoneNumber: driver.whatsAppPhoneNumber,
      profileImage: driver.profileImage,
      carDetails: driver.carDetails,
      rating: 0,
      totalRides: driver.rideHistory?.length || 0,
      balance: driver.financialAccount?.vault || 0,
      isAvailable: driver.isAvailable,
      age: driver.age,
      address: driver.address,
      currentLocation: driver.currentLocation,
      createdAt: driver.createdAt
    };

    res.json(driverData);
  } catch (error) {
    console.error('Driver fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/drivers - Create new driver
router.post('/drivers', async (req, res) => {
  try {
    const driverData = req.body;
    
    // Check if email already exists
    const existingDriver = await Driver.findOne({ email: driverData.email });
    if (existingDriver) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Create financial account for new driver
    const financialAccountId = await createFinancialAccount();
    
    const driver = new Driver({
      ...driverData,
      financialAccount: financialAccountId,
      rideHistory: []
    });

    await driver.save();
    await driver.populate('financialAccount');

    const responseData = {
      id: driver._id,
      name: driver.name,
      email: driver.email,
      phoneNumber: driver.phoneNumber,
      whatsAppPhoneNumber: driver.whatsAppPhoneNumber,
      profileImage: driver.profileImage,
      carDetails: driver.carDetails,
      rating: 0,
      totalRides: 0,
      balance: driver.financialAccount.vault,
      isAvailable: driver.isAvailable,
      age: driver.age,
      address: driver.address
    };

    res.status(201).json(responseData);
  } catch (error) {
    console.error('Driver creation error:', error);
    if (error.code === 11000) {
      res.status(400).json({ error: 'Email already exists' });
    } else {
      res.status(400).json({ error: error.message });
    }
  }
});

// PATCH /api/drivers/:id - Update driver
router.patch('/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Remove sensitive fields from update
    delete updateData.password;
    delete updateData.financialAccount;
    delete updateData.rideHistory;

    const driver = await Driver.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).populate('financialAccount');

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const responseData = {
      id: driver._id,
      name: driver.name,
      email: driver.email,
      phoneNumber: driver.phoneNumber,
      whatsAppPhoneNumber: driver.whatsAppPhoneNumber,
      profileImage: driver.profileImage,
      carDetails: driver.carDetails,
      rating: 0,
      totalRides: driver.rideHistory?.length || 0,
      balance: driver.financialAccount?.vault || 0,
      isAvailable: driver.isAvailable,
      age: driver.age,
      address: driver.address
    };

    res.json(responseData);
  } catch (error) {
    console.error('Driver update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/drivers/:id/balance - Update driver balance
router.patch('/drivers/:id/balance', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    if (!amount || typeof amount !== 'number') {
      return res.status(400).json({ error: 'Valid amount is required' });
    }

    const updatedDriver = await updateBalance(id, amount, 'driver');
    await updatedDriver.populate('financialAccount');

    // Create money transfer record
    const moneyTransfer = new MoneyTransfers({
      vault: amount,
      transferType: amount > 0 ? 'credit' : 'debit',
      from: {
        id: id,
        role: 'Driver'
      },
      to: {
        id: id,
        role: 'Driver'
      }
    });
    await moneyTransfer.save();

    const responseData = {
      id: updatedDriver._id,
      name: updatedDriver.name,
      email: updatedDriver.email,
      phoneNumber: updatedDriver.phoneNumber,
      whatsAppPhoneNumber: updatedDriver.whatsAppPhoneNumber,
      profileImage: updatedDriver.profileImage,
      carDetails: updatedDriver.carDetails,
      rating: 0,
      totalRides: updatedDriver.rideHistory?.length || 0,
      balance: updatedDriver.financialAccount.vault,
      isAvailable: updatedDriver.isAvailable,
      age: updatedDriver.age,
      address: updatedDriver.address
    };

    res.json(responseData);
  } catch (error) {
    console.error('Driver balance update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/drivers/:id/status - Update driver availability
router.patch('/drivers/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    const driver = await Driver.findByIdAndUpdate(
      id,
      { isAvailable },
      { new: true }
    ).populate('financialAccount');

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    const responseData = {
      id: driver._id,
      name: driver.name,
      email: driver.email,
      phoneNumber: driver.phoneNumber,
      whatsAppPhoneNumber: driver.whatsAppPhoneNumber,
      profileImage: driver.profileImage,
      carDetails: driver.carDetails,
      rating: 0,
      totalRides: driver.rideHistory?.length || 0,
      balance: driver.financialAccount?.vault || 0,
      isAvailable: driver.isAvailable,
      age: driver.age,
      address: driver.address
    };

    res.json(responseData);
  } catch (error) {
    console.error('Driver status update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// DELETE /api/drivers/:id - Deactivate driver
router.delete('/drivers/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const driver = await Driver.findByIdAndUpdate(
      id,
      { active: false },
      { new: true }
    );

    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    res.json({ message: 'Driver deactivated successfully' });
  } catch (error) {
    console.error('Driver deletion error:', error);
    res.status(400).json({ error: error.message });
  }
});

// GET /api/drivers/:id/analytics - Get driver analytics
router.get('/drivers/:id/analytics', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Find the driver
    const driver = await Driver.findById(id).populate('financialAccount');
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    // Get all rides for this driver
    const rides = await Ride.find({ driver: id }).sort({ createdAt: -1 });
    
    // Calculate analytics
    const completedRides = rides.filter(ride => ride.status === 'completed');
    const cancelledRides = rides.filter(ride => ['canceled', 'cancelled'].includes(ride.status));
    
    // Total earnings from completed rides
    const totalEarnings = completedRides.reduce((sum, ride) => sum + ride.fare, 0);
    
    // Average rating from completed rides with ratings
    const ratedRides = completedRides.filter(ride => ride.driverRating > 0);
    const averageRating = ratedRides.length > 0 
      ? ratedRides.reduce((sum, ride) => sum + ride.driverRating, 0) / ratedRides.length 
      : 0;
    
    // Total distance
    const totalDistance = completedRides.reduce((sum, ride) => sum + ride.distance, 0);
    
    // Average ride time
    const averageRideTime = completedRides.length > 0
      ? completedRides.reduce((sum, ride) => sum + ride.duration, 0) / completedRides.length
      : 0;

    // Monthly earnings (last 6 months)
    const now = new Date();
    const monthlyEarnings = [];
    const monthNames = [
      'كانون الثاني', 'شباط', 'آذار', 'نيسان', 'أيار', 'حزيران',
      'تموز', 'آب', 'أيلول', 'تشرين الأول', 'تشرين الثاني', 'كانون الأول'
    ];

    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0);
      
      const monthRides = completedRides.filter(ride => {
        const rideDate = new Date(ride.createdAt);
        return rideDate >= monthStart && rideDate <= monthEnd;
      });
      
      const monthEarnings = monthRides.reduce((sum, ride) => sum + ride.fare, 0);
      
      monthlyEarnings.push({
        month: monthNames[monthStart.getMonth()],
        earnings: monthEarnings
      });
    }

    // Rating distribution
    const ratingDistribution = [
      { rating: 5, count: 0 },
      { rating: 4, count: 0 },
      { rating: 3, count: 0 },
      { rating: 2, count: 0 },
      { rating: 1, count: 0 }
    ];

    ratedRides.forEach(ride => {
      const rating = Math.floor(ride.driverRating);
      const index = ratingDistribution.findIndex(r => r.rating === rating);
      if (index !== -1) {
        ratingDistribution[index].count++;
      }
    });

    // Filter out zero counts
    const filteredRatingDistribution = ratingDistribution.filter(item => item.count > 0);

    // Peak hours analysis
    const hourCounts = new Array(24).fill(0);
    completedRides.forEach(ride => {
      const hour = new Date(ride.createdAt).getHours();
      hourCounts[hour]++;
    });

    // Find top 3 peak hours
    const peakHours = hourCounts
      .map((count, hour) => ({ hour, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(item => `${item.hour.toString().padStart(2, '0')}:00-${(item.hour + 1).toString().padStart(2, '0')}:00`);

    // Current month statistics
    const currentMonth = new Date();
    const currentMonthStart = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1);
    const currentMonthRides = completedRides.filter(ride => new Date(ride.createdAt) >= currentMonthStart);
    const earningsThisMonth = currentMonthRides.reduce((sum, ride) => sum + ride.fare, 0);

    // Completion rate
    const totalRides = rides.length;
    const completionRate = totalRides > 0 ? Math.round((completedRides.length / totalRides) * 100) : 0;

    const analytics = {
      totalEarnings,
      completedRides: completedRides.length,
      cancelledRides: cancelledRides.length,
      averageRating: Math.round(averageRating * 10) / 10,
      totalDistance: Math.round(totalDistance * 10) / 10,
      averageRideTime: Math.round(averageRideTime),
      monthlyEarnings,
      ratingDistribution: filteredRatingDistribution,
      peakHours: peakHours.length > 0 ? peakHours : ['08:00-09:00', '17:00-18:00', '20:00-21:00'],
      ridesThisMonth: currentMonthRides.length,
      earningsThisMonth,
      completionRate
    };

    res.json(analytics);
  } catch (error) {
    console.error('Driver analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// CUSTOMER ENDPOINTS
// ================================

// GET /api/customers - Get all customers
router.get('/customers', async (req, res) => {
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

// GET /api/customers/:id - Get single customer
router.get('/customers/:id', async (req, res) => {
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

// POST /api/customers - Create new customer
router.post('/customers', async (req, res) => {
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

// PATCH /api/customers/:id/balance - Update customer balance
router.patch('/customers/:id/balance', async (req, res) => {
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

// ================================
// RIDE ENDPOINTS
// ================================

// GET /api/rides - Get all rides
router.get('/rides', async (req, res) => {
  try {
    const { status, page = 1, limit = 50, driverId, customerId, startDate, endDate } = req.query;
    
    // Build query
    let query = {};
    
    if (status && status !== 'all') {
      query.status = status;
    }
    
    if (driverId) {
      query.driver = driverId;
    }
    
    if (customerId) {
      query.passenger = customerId;
    }
    
    if (startDate && endDate) {
      query.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const rides = await Ride.find(query)
      .populate('driver', 'name phoneNumber')
      .populate('passenger', 'name phoneNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Ride.countDocuments(query);

    const ridesData = rides.map(ride => ({
      id: ride._id,
      driverId: ride.driver?._id,
      driverName: ride.driver?.name || 'غير محدد',
      driverPhone: ride.driver?.phoneNumber,
      customerId: ride.passenger?._id,
      customerName: ride.passenger?.name || 'غير محدد',
      customerPhone: ride.passenger?.phoneNumber,
      pickupLocation: ride.pickupLocation,
      dropoffLocation: ride.dropoffLocation,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      status: ride.status,
      fare: ride.fare,
      currency: ride.currency,
      distance: ride.distance,
      duration: ride.duration,
      paymentStatus: ride.paymentStatus,
      passengerRating: ride.passengerRating,
      driverRating: ride.driverRating,
      isDispatching: ride.isDispatching,
      notified: ride.notified,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt
    }));

    res.json({
      rides: ridesData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Rides fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/rides/:id - Get single ride
router.get('/rides/:id', async (req, res) => {
  try {
    const ride = await Ride.findById(req.params.id)
      .populate('driver', 'name phoneNumber email')
      .populate('passenger', 'name phoneNumber email')
      .lean();

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    const rideData = {
      id: ride._id,
      driverId: ride.driver?._id,
      driverName: ride.driver?.name,
      driverPhone: ride.driver?.phoneNumber,
      driverEmail: ride.driver?.email,
      customerId: ride.passenger?._id,
      customerName: ride.passenger?.name,
      customerPhone: ride.passenger?.phoneNumber,
      customerEmail: ride.passenger?.email,
      pickupLocation: ride.pickupLocation,
      dropoffLocation: ride.dropoffLocation,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      status: ride.status,
      fare: ride.fare,
      currency: ride.currency,
      distance: ride.distance,
      duration: ride.duration,
      paymentStatus: ride.paymentStatus,
      passengerRating: ride.passengerRating,
      driverRating: ride.driverRating,
      isDispatching: ride.isDispatching,
      notified: ride.notified,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt
    };

    res.json(rideData);
  } catch (error) {
    console.error('Ride fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/rides - Create new ride
router.post('/rides', async (req, res) => {
  try {
    const rideData = req.body;
    
    const ride = new Ride(rideData);
    await ride.save();
    
    // Add ride to customer's ride history
    if (ride.passenger) {
      await Customer.findByIdAndUpdate(
        ride.passenger,
        { $push: { rideHistory: { rideId: ride._id } } }
      );
    }

    // Add ride to driver's ride history if assigned
    if (ride.driver) {
      await Driver.findByIdAndUpdate(
        ride.driver,
        { $push: { rideHistory: ride._id } }
      );
    }

    await ride.populate('driver', 'name phoneNumber');
    await ride.populate('passenger', 'name phoneNumber');

    const responseData = {
      id: ride._id,
      driverId: ride.driver?._id,
      driverName: ride.driver?.name,
      driverPhone: ride.driver?.phoneNumber,
      customerId: ride.passenger?._id,
      customerName: ride.passenger?.name,
      customerPhone: ride.passenger?.phoneNumber,
      pickupLocation: ride.pickupLocation,
      dropoffLocation: ride.dropoffLocation,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      status: ride.status,
      fare: ride.fare,
      currency: ride.currency,
      distance: ride.distance,
      duration: ride.duration,
      paymentStatus: ride.paymentStatus,
      createdAt: ride.createdAt
    };

    res.status(201).json(responseData);
  } catch (error) {
    console.error('Ride creation error:', error);
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/rides/:id/status - Update ride status
router.patch('/rides/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = [
      'requested', 'accepted', 'arrived', 'onRide', 
      'completed', 'canceled', 'cancelled', 'notApprove'
    ];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const ride = await Ride.findByIdAndUpdate(
      id,
      { status },
      { new: true }
    )
    .populate('driver', 'name phoneNumber')
    .populate('passenger', 'name phoneNumber');

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    const responseData = {
      id: ride._id,
      driverId: ride.driver?._id,
      driverName: ride.driver?.name,
      driverPhone: ride.driver?.phoneNumber,
      customerId: ride.passenger?._id,
      customerName: ride.passenger?.name,
      customerPhone: ride.passenger?.phoneNumber,
      pickupLocation: ride.pickupLocation,
      dropoffLocation: ride.dropoffLocation,
      pickupAddress: ride.pickupAddress,
      dropoffAddress: ride.dropoffAddress,
      status: ride.status,
      fare: ride.fare,
      currency: ride.currency,
      distance: ride.distance,
      duration: ride.duration,
      paymentStatus: ride.paymentStatus,
      passengerRating: ride.passengerRating,
      driverRating: ride.driverRating,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt
    };

    res.json(responseData);
  } catch (error) {
    console.error('Ride status update error:', error);
    res.status(400).json({ error: error.message });
  }
});

// PATCH /api/rides/:id/assign-driver - Assign driver to ride
router.patch('/rides/:id/assign-driver', async (req, res) => {
  try {
    const { id } = req.params;
    const { driverId } = req.body;

    if (!driverId) {
      return res.status(400).json({ error: 'Driver ID is required' });
    }

    // Check if driver exists and is available
    const driver = await Driver.findById(driverId);
    if (!driver) {
      return res.status(404).json({ error: 'Driver not found' });
    }

    if (!driver.isAvailable) {
      return res.status(400).json({ error: 'Driver is not available' });
    }

    const ride = await Ride.findByIdAndUpdate(
      id,
      { 
        driver: driverId,
        status: 'accepted'
      },
      { new: true }
    )
    .populate('driver', 'name phoneNumber')
    .populate('passenger', 'name phoneNumber');

    if (!ride) {
      return res.status(404).json({ error: 'Ride not found' });
    }

    // Add ride to driver's history
    await Driver.findByIdAndUpdate(
      driverId,
      { $push: { rideHistory: ride._id } }
    );

    const responseData = {
      id: ride._id,
      driverId: ride.driver?._id,
      driverName: ride.driver?.name,
      driverPhone: ride.driver?.phoneNumber,
      customerId: ride.passenger?._id,
      customerName: ride.passenger?.name,
      customerPhone: ride.passenger?.phoneNumber,
      status: ride.status,
      fare: ride.fare,
      createdAt: ride.createdAt,
      updatedAt: ride.updatedAt
    };

    res.json(responseData);
  } catch (error) {
    console.error('Driver assignment error:', error);
    res.status(400).json({ error: error.message });
  }
});

// ================================
// ANALYTICS ENDPOINTS
// ================================

// GET /api/analytics/summary - Get analytics summary
router.get('/analytics/summary', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    const dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const [
      ridesByStatus,
      revenueByDate,
      topDrivers
    ] = await Promise.all([
      Ride.aggregate([
        { $match: dateFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Ride.aggregate([
        { $match: { ...dateFilter, status: 'completed' } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            revenue: { $sum: '$fare' },
            rides: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]),
      Ride.aggregate([
        { $match: { ...dateFilter, status: 'completed' } },
        { $group: { _id: '$driver', totalRides: { $sum: 1 }, totalRevenue: { $sum: '$fare' } } },
        { $lookup: { from: 'drivers', localField: '_id', foreignField: '_id', as: 'driverInfo' } },
        { $unwind: '$driverInfo' },
        { $sort: { totalRides: -1 } },
        { $limit: 10 }
      ])
    ]);

    res.json({
      ridesByStatus,
      revenueByDate,
      topDrivers
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/revenue - Get revenue analytics
router.get('/analytics/revenue', async (req, res) => {
  try {
    const { period = 'daily', startDate, endDate } = req.query;
    
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    let groupByFormat;
    switch (period) {
      case 'hourly':
        groupByFormat = '%Y-%m-%d %H:00';
        break;
      case 'daily':
        groupByFormat = '%Y-%m-%d';
        break;
      case 'weekly':
        groupByFormat = '%Y-%U';
        break;
      case 'monthly':
        groupByFormat = '%Y-%m';
        break;
      default:
        groupByFormat = '%Y-%m-%d';
    }

    const revenue = await Ride.aggregate([
      { $match: { ...dateFilter, status: 'completed' } },
      {
        $group: {
          _id: { $dateToString: { format: groupByFormat, date: '$createdAt' } },
          revenue: { $sum: '$fare' },
          rides: { $sum: 1 },
          avgFare: { $avg: '$fare' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json(revenue);
  } catch (error) {
    console.error('Revenue analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ================================
// FINANCIAL ENDPOINTS
// ================================

// GET /api/financial/transactions - Get financial transactions
router.get('/financial/transactions', async (req, res) => {
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

// ================================
// SYSTEM HEALTH ENDPOINTS
// ================================

// GET /api/health - System health check
router.get('/health', async (req, res) => {
  try {
    const [driverCount, customerCount, rideCount] = await Promise.all([
      Driver.countDocuments({ active: true }),
      Customer.countDocuments(),
      Ride.countDocuments()
    ]);

    res.json({
      status: 'healthy',
      timestamp: new Date(),
      database: 'connected',
      counts: {
        drivers: driverCount,
        customers: customerCount,
        rides: rideCount
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date(),
      error: error.message
    });
  }
});

module.exports = router;