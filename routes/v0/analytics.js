const express = require('express');
const router = express.Router();
const Ride = require('../../model/ride');

// GET /summary - Get analytics summary
router.get('/summary', async (req, res) => {
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

// GET /revenue - Get revenue analytics
router.get('/revenue', async (req, res) => {
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

module.exports = router;