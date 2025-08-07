const express = require('express');
const path = require('path');
const router = express.Router();

// Admin location tracking dashboard
router.get('/admin/location-tracking', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin_location_dashboard.html'));
});

// Serve admin dashboard
router.get('/admin/dashboard/location', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'admin_location_dashboard.html'));
});

module.exports = router;
