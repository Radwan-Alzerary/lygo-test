const express = require("express");
const jwt = require("jsonwebtoken");
const Ride = require("../model/ride");
const chatRoutes = require("./chat"); // Chat routes
const paymentRoutes = require("./payments"); // Payment routes
const stateManagementRoutes = require("./stateManagement"); // State management routes

const createApiRoutes = (logger, dispatchService, chatService, paymentService, stateManagementService) => {
  const router = express.Router();

  // Middleware to inject services into request object
  router.use((req, res, next) => {
    req.chatService = chatService;
    req.dispatchService = dispatchService;
    req.paymentService = paymentService;
    req.stateManagementService = stateManagementService;
    req.logger = logger;
    next();
  });

  // Simple authentication middleware for API routes
  const authenticateToken = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
      return res.status(401).json({ 
        success: false, 
        message: 'Authorization token is missing or invalid.' 
      });
    }

    jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", (err, decoded) => {
      if (err) {
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid or expired token.' 
        });
      }
      
      req.user = {
        userId: decoded.id,
        id: decoded.id, // Add both for compatibility
        userType: decoded.userType || 'customer' // default to customer if not specified
      };
      next();
    });
  };

  // Use chat routes with authentication
  router.use('/chat', authenticateToken, chatRoutes);
  
  // Use payment routes - these are mounted under /rides/
  router.use('/rides', paymentRoutes);
  
  // Use state management routes
  router.use('/', stateManagementRoutes);

  router.post('/requestRide', async (req, res) => {
    logger.info(`[API] Received POST /api/requestRide`);
    logger.debug(`[API] Headers: ${JSON.stringify(req.headers)}`);
    logger.debug(`[API] Body: ${JSON.stringify(req.body)}`);

    const rideData = req.body;
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
      logger.warn('[API] /api/requestRide: Missing or invalid Authorization header.');
      return res.status(401).json({ error: 'Unauthorized', message: 'Authorization token is missing or invalid.' });
    }

    // Validate rideData (similar to socket validation)
    if (!rideData || !rideData.origin || !rideData.destination ||
      typeof rideData.origin.latitude !== "number" || typeof rideData.origin.longitude !== "number" ||
      typeof rideData.destination.latitude !== "number" || typeof rideData.destination.longitude !== "number") {
      logger.warn(`[API] /api/requestRide: Invalid rideData received. Data: ${JSON.stringify(rideData)}`);
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid location data provided.' });
    }

    try {
      // Verify JWT token
      jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
        if (err) {
          logger.warn(`[API] /api/requestRide: JWT verification failed. Error: ${err.message}`);
          return res.status(401).json({ error: 'Unauthorized', message: 'Invalid or expired token.' });
        }

        const customerId = decoded.id;
        logger.info(`[API] /api/requestRide: Token verified for customer ${customerId}.`);

        // Check if customer already has an active ride
        const existingRide = await Ride.findOne({
          passenger: customerId,
          status: { $in: ['requested', 'accepted', 'arrived', 'onRide'] }
        });

        if (existingRide) {
          logger.warn(`[API] Customer ${customerId} attempted API ride request while ride ${existingRide._id} is active (status: ${existingRide.status}).`);
          return res.status(409).json({ error: 'Conflict', message: `You already have an active ride (Status: ${existingRide.status}).` });
        }

        // Create a new ride instance
        logger.info(`[API] Creating ride via API for customer ${customerId}.`);
        const newRide = new Ride({
          passenger: customerId,
          driver: null,
          pickupLocation: {
            type: 'Point',
            coordinates: [rideData.origin.longitude, rideData.origin.latitude],
          },
          dropoffLocation: {
            type: 'Point',
            coordinates: [rideData.destination.longitude, rideData.destination.latitude],
          },
          fare: {
            amount: rideData.fareAmount || 6000, // Use provided or default
            currency: "IQD",
          },
          distance: rideData.distance,
          duration: rideData.duration,
          status: "requested",
          isDispatching: true, // Mark for dispatch
          notified: false,
        });

        // Save the new ride to MongoDB
        await newRide.save();
        logger.info(`[DB] Ride ${newRide._id} created successfully via API for customer ${customerId}.`);

        // Start the dispatch process (async, don't wait for it to finish)
        dispatchService.dispatchRide(newRide, rideData.origin);
        logger.info(`[Dispatch] Initiated dispatch for API-requested ride ${newRide._id}.`);

        // Respond to the API client
        res.status(201).json({ message: 'Ride requested successfully. Searching for captains.', rideId: newRide._id });

      }); // End JWT verify callback
    } catch (err) {
      logger.error("[API] /api/requestRide: Error processing request:", err);
      res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create ride due to a server issue.' });
    }
  });

  // Add more API endpoints here as needed
  // router.get('/rides/:id', async (req, res) => { ... });
  // router.post('/rides/:id/cancel', async (req, res) => { ... });

  return router;
};

module.exports = createApiRoutes;