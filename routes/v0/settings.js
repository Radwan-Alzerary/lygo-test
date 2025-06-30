const express = require('express');
const router = express.Router();
const RideSetting = require('../../model/rideSetting');

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

// GET / - Get ride settings
router.get('/', async (req, res) => {
  try {
    // Get the default settings or create them if they don't exist
    let settings = await RideSetting.findOne({ name: 'default' });
    
    if (!settings) {
      // Create default settings
      settings = new RideSetting(defaultSettings);
      await settings.save();
    }

    res.json(settings);
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT / - Update ride settings
router.put('/', async (req, res) => {
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

// POST /reset - Reset settings to defaults
router.post('/reset', async (req, res) => {
  try {
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

module.exports = router;