const express = require('express');
const router = express.Router();
const Driver = require('../../model/Driver');
const Customer = require('../../model/customer');
const Ride = require('../../model/ride');

// GET / - Dashboard overview
router.get('/', async (req, res) => {
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

module.exports = router;