const express = require('express');
const router = express.Router();
const Driver = require('../../model/Driver');
const Ride = require('../../model/ride');
const MoneyTransfers = require('../../model/moneyTransfers');
const { createFinancialAccount, updateBalance } = require('../../utils/routeHelpers');

// GET / - Get all drivers
router.get('/', async (req, res) => {
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

// GET /:id - Get single driver
router.get('/:id', async (req, res) => {
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

// POST / - Create new driver
router.post('/', async (req, res) => {
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

// PATCH /:id - Update driver
router.patch('/:id', async (req, res) => {
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

// PATCH /:id/balance - Update driver balance
router.patch('/:id/balance', async (req, res) => {
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

// PATCH /:id/status - Update driver availability
router.patch('/:id/status', async (req, res) => {
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

// DELETE /:id - Deactivate driver
router.delete('/:id', async (req, res) => {
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

// GET /:id/analytics - Get driver analytics
router.get('/:id/analytics', async (req, res) => {
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

module.exports = router;