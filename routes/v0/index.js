const express = require('express');
const router = express.Router();

// Import all route modules
const dashboardRoutes = require('./dashboard');
const settingsRoutes = require('./settings');
const driverRoutes = require('./drivers');
const customerRoutes = require('./customers');
const rideRoutes = require('./rides');
const analyticsRoutes = require('./analytics');
const financialRoutes = require('./financial');
const healthRoutes = require('./health');
const advertisements = require('./advertisements');
// Use route modules
router.use('/dashboard', dashboardRoutes);
router.use('/settings', settingsRoutes);
router.use('/drivers', driverRoutes);
router.use('/customers', customerRoutes);
router.use('/rides', rideRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/financial', financialRoutes);
router.use('/health', healthRoutes);
router.use("/advertisements", advertisements);

module.exports = router;