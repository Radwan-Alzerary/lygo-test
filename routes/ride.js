const express = require("express");
const router = express.Router();
const Ride = require("../model/ride");
const rideSetting = require("../model/rideSetting");
const { calculateRideFare, calculateDistance, estimateDuration } = require("../utils/fareCalculator");

// Create a new ride
router.post("/rides", async (req, res) => {
  try {
    const {
      passenger,
      pickupLocation,
      dropoffLocation,
      fare,
      distance,
      duration,
    } = req.body;

    const newRide = new Ride({
      passenger: req.user.id,
      pickupLocation,
      dropoffLocation,
      fare,
      distance,
      duration,
    });

    const savedRide = await newRide.save();

    // Send a socket message to all captains
    req.io.emit("newRide", savedRide);

    res.status(201).json(savedRide);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to create ride", error: error.message });
  }
});
// Get all rides for a customer or driver
router.get("/rides", async (req, res) => {
  try {
    const userType = req.user.role; // Assuming you have a role field in the user model
    let rides;

    if (userType === "customer") {
      rides = await Ride.find({ passenger: req.user.id });
    } else if (userType === "driver") {
      rides = await Ride.find({ driver: req.user.id });
    } else {
      return res.status(403).json({ message: "Access denied" });
    }

    res.status(200).json(rides);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to fetch rides", error: error.message });
  }
});

router.get("/reqestRide", async (req, res) => {
  // Get all rides
  try {
    const rides = await Ride.find({ status:"requested"}).populate("passenger");
    console.log(rides)
    res.status(200).json(rides);
  } catch (error) {
    res.status(500).json({ error: "Error fetching rides" });
  }
});

// Update ride status or details
router.patch("/rides/:id", async (req, res) => {
  try {
    const updatedRide = await Ride.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    if (!updatedRide) {
      return res.status(404).json({ message: "Ride not found" });
    }

    res.status(200).json(updatedRide);
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to update ride", error: error.message });
  }
});

// Route to check if the user has an active ride
router.get("/active", async (req, res) => {
  try {
    // Assuming `req.user.id` contains the user ID from the decoded JWT
    const userId = req.user.id;
    // Find a ride that is not yet completed (e.g., status is not 'completed' or 'cancelled')
    const activeRide = await Ride.findOne({
      passenger: userId,
      status: { $in: ["requested", "accepted", "in-progress"] },
    });

    if (activeRide) {
      return res.json({
        activeRide: {
          origin: activeRide.pickupLocation.coordinates,
          destination: activeRide.dropoffLocation.coordinates,
          distance: activeRide.distance,
          duration: activeRide.duration,
          originPlaceName: activeRide.originPlaceName,
          destinationPlaceName: activeRide.destinationPlaceName,
        },
      });
    } else {
      return res.json({ activeRide: null });
    }
  } catch (error) {
    console.error("Error checking active ride:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Delete a ride
router.delete("/rides/:id", async (req, res) => {
  try {
    const deletedRide = await Ride.findByIdAndDelete(req.params.id);

    if (!deletedRide) {
      return res.status(404).json({ message: "Ride not found" });
    }

    res.status(200).json({ message: "Ride deleted successfully" });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Failed to delete ride", error: error.message });
  }
});

router.post('/estimate', async (req, res) => {
  try {
    const { pickupLocation, dropoffLocation, vehicleType, paymentMethod, isShared, priority, scheduledTime, customerType } = req.body;

    if (
      !pickupLocation?.coordinates ||
      !Array.isArray(pickupLocation.coordinates) ||
      pickupLocation.coordinates.length !== 2 ||
      !dropoffLocation?.coordinates ||
      !Array.isArray(dropoffLocation.coordinates) ||
      dropoffLocation.coordinates.length !== 2
    ) {
      return res.status(400).json({
        success: false,
        message: 'pickupLocation and dropoffLocation with valid coordinates are required'
      });
    }

    // 1. Calculate distance & duration
    const distance = calculateDistance(pickupLocation.coordinates, dropoffLocation.coordinates);
    const duration = estimateDuration(distance);

    // 2. Build rideDetails for fare calculation
    const rideDetails = {
      distance,
      duration,
      pickupLocation,
      dropoffLocation,
      vehicleType: vehicleType || 'standard',
      paymentMethod: paymentMethod || 'cash',
      isShared: Boolean(isShared),
      priority: priority || 'normal',
      scheduledTime,
      customerType: customerType || 'regular'
    };

    // 3. Fetch your fare settings (fallback to defaults if none)
    const settingsDoc = await rideSetting.findOne({}).lean();
    const settings = settingsDoc || {};

    // 4. Run fare calculation
    const fareResult = calculateRideFare(rideDetails, settings, { breakdown: true });

    // 5. Send response
    res.json({
      success: true,
      data: {
        distance: Number(distance.toFixed(2)),   // km
        duration,                                 // minutes
        fare: fareResult
      }
    });
  } catch (err) {
    console.error('[Route][calculate-fare] Error:', err);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: err.message
    });
  }
});


module.exports = router;
