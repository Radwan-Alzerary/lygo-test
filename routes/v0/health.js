const express = require('express');
const router = express.Router();
const Driver = require('../../model/Driver');
const Customer = require('../../model/customer');
const Ride = require('../../model/ride');

// GET / - System health check
router.get('/', async (req, res) => {
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