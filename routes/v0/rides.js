const express = require('express');
const router = express.Router();
const Ride = require('../../model/ride');
const Driver = require('../../model/Driver');
const { verifyToken } = require('../../middlewares/customerMiddlewareAyuth');
const { validationResult } = require("express-validator");

const Customer = require('../../model/customer');
const { default: mongoose } = require('mongoose');


// GET / - Get all rides
router.get('/', async (req, res) => {
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

router.post(
  "/rate",
  verifyToken,                                               // must be logged-in customer,
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    const { rideId, rating, points = [] } = req.body;

    try {
      // 1. fetch the ride & basic guards
      const ride = await Ride.findById(rideId).select(
        "passenger driver status passengerRating"
      );
      if (!ride) return res.status(404).json({ message: "Ride not found" });

      if (!ride.passenger.equals(req.user.id))
        return res.status(403).json({ message: "Not your ride" });

      if (ride.status !== "completed")
        return res
          .status(400)
          .json({ message: "Ride must be completed before rating" });

      if (ride.passengerRating !== null)
        return res.status(409).json({ message: "Ride already rated" });

      // 2. update ride with rating + optional points
      ride.passengerRating = rating;
      if (points.length) ride.set("passengerFeedbackPoints", points); // optional
      await ride.save();

      // 3. update driver's aggregate rating (create the fields if missing)
      await Driver.findByIdAndUpdate(
        ride.driver,
        {
          $inc: { ratingCount: 1, ratingTotal: rating },
        },
        { upsert: false }
      );

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);


// GET /:id - Get single ride
router.get('/:id', async (req, res) => {
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

// POST / - Create new ride
router.post('/', async (req, res) => {
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

// PATCH /:id/status - Update ride status
router.patch('/:id/status', async (req, res) => {
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

// PATCH /:id/assign-driver - Assign driver to ride
router.patch('/:id/assign-driver', async (req, res) => {
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

module.exports = router;