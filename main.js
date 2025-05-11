const express = require("express");
const http = require("http");
const path = require("path");

const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");
const jwt = require("jsonwebtoken");
const { createClient } = require("redis");

const Ride = require("./model/ride");
const Captain = require("./model/Driver");
const SystemSetting = require("./model/systemSetting");

require("dotenv").config();
require("./config/database"); // Assuming this connects to MongoDB
require("./model/user"); // Ensure User model is registered if needed elsewhere

// --- Logger Setup ---
const winston = require('winston');
const { format } = winston;
const logger = winston.createLogger({
  level: 'info', // Log 'info' and above ('warn', 'error')
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }), // Log stack traces for errors
    format.splat(),
    format.json() // Log in JSON format
  ),
  defaultMeta: { service: 'ride-hailing-app' },
  transports: [
    // Log to the console
    new winston.transports.Console({
      format: format.combine(
        format.colorize(),
        format.simple() // Simple format for console readability
      )
    }),
    // Log to a file
    new winston.transports.File({ filename: 'app-error.log', level: 'error' }), // Log only errors to this file
    new winston.transports.File({ filename: 'app-combined.log' }), // Log everything to this file
  ],
});

logger.info('[System] Logger initialized.');

// --- Express App and HTTP Server ---
const app = express();
const server = http.createServer(app);
logger.info('[System] Express app and HTTP server created.');

// --- Socket.IO Server ---
const io = require("socket.io")(server, {
  transports: ["websocket"],
  cors: {
    origin: "*", // Consider restricting in production
    methods: ["GET", "POST"],
  },
});
logger.info('[System] Socket.IO server initialized.');

// --- Redis Client ---
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://127.0.0.1:6379", // Use environment variable
});

redisClient.on("error", (err) => {
  // Use logger for Redis errors
  logger.error("[Redis] Redis Client Error:", err);
});

redisClient.on('connect', () => {
    logger.info('[Redis] Client connecting...');
});

redisClient.on('ready', () => {
    logger.info('[Redis] Client ready.');
});

redisClient.on('reconnecting', () => {
    logger.warn('[Redis] Client reconnecting...');
});

redisClient.on('end', () => {
    logger.warn('[Redis] Client connection ended.');
});


// Use async/await for connect for cleaner startup sequence
(async () => {
  try {
    await redisClient.connect();
    logger.info("[Redis] Successfully connected to Redis.");
  } catch (err) {
    logger.error("[Redis] Failed to connect to Redis:", err);
    // Optionally exit or implement retry logic if Redis is critical
    // process.exit(1);
  }
})();


// --- Application State ---
const onlineCustomers = {}; // Map: customerId -> socketId
const onlineCaptains = {};  // Map: captainId -> socketId
const dispatchProcesses = new Map(); // Map: rideId -> cancelDispatchFunction
const rideSharingMap = new Map();   // Map: captainId -> customerId
logger.info('[State] Initialized in-memory state maps.');

// --- Helper Functions ---

// Function to find nearby captains using Redis geospatial commands
const findNearbyCaptains = async (origin, radius = 2) => {
  logger.info(`[Redis] Searching for captains near (${origin.longitude}, ${origin.latitude}) within ${radius} km.`);
  try {
    // Ensure coordinates are strings for Redis command
    const lonStr = String(origin.longitude);
    const latStr = String(origin.latitude);
    const radiusStr = String(radius);

    const commandArgs = [
      "GEORADIUS",
      "captains",
      lonStr,
      latStr,
      radiusStr,
      "km",
      "WITHCOORD", // Include coordinates in the reply
      "WITHDIST",  // Include distance in the reply
      "ASC",       // Sort by distance ascending
    ];
    logger.debug(`[Redis] Executing GEORADIUS command: ${commandArgs.join(' ')}`);

    const nearbyCaptainsRaw = await redisClient.sendCommand(commandArgs);
    logger.debug(`[Redis] GEORADIUS raw result: ${JSON.stringify(nearbyCaptainsRaw)}`);

    // Transform the result: [ ["captainId1", "distance1", ["lon1", "lat1"]], ["captainId2", ...] ]
    // We only need the captain IDs for this function's current usage.
    const captainIds = nearbyCaptainsRaw.map((captainData) => captainData[0]); // captainData is like ["captainId", "distance", ["lon", "lat"]]
    logger.info(`[Redis] Found ${captainIds.length} captains within ${radius} km: ${captainIds.join(', ')}`);
    return captainIds;
  } catch (err) {
    logger.error("[Redis] Error in findNearbyCaptains:", { origin, radius, error: err.message, stack: err.stack });
    throw err; // Re-throw to be handled by caller
  }
};

// Function to calculate the distance between two coordinates
function calculateDistance(coord1, coord2) {
  // Basic check for valid inputs
  if (!coord1 || !coord2 || typeof coord1.latitude !== 'number' || typeof coord1.longitude !== 'number' ||
      typeof coord2.latitude !== 'number' || typeof coord2.longitude !== 'number') {
      logger.warn('[Util] Invalid coordinates passed to calculateDistance:', { coord1, coord2 });
      return Infinity; // Return a large number or handle error appropriately
  }

  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(coord2.latitude - coord1.latitude);
  const dLon = toRad(coord2.longitude - coord1.longitude);

  const lat1 = toRad(coord1.latitude);
  const lat2 = toRad(coord2.latitude);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) *
      Math.sin(dLon / 2) *
      Math.cos(lat1) *
      Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c; // Distance in km
  // logger.debug(`[Util] Calculated distance between (${coord1.latitude}, ${coord1.longitude}) and (${coord2.latitude}, ${coord2.longitude}): ${distance.toFixed(2)} km`);
  return distance;
}

// --- Socket.IO Namespaces ---

// Customer Namespace
const customerNamespace = io.of("/customer");
customerNamespace.on("connection", (socket) => {
  logger.info(`[Socket.IO Customer] Incoming connection attempt. Socket ID: ${socket.id}`);
  const token = socket.handshake.query.token;

  if (!token) {
    logger.warn(`[Socket.IO Customer] Connection attempt without token. Socket ID: ${socket.id}. Disconnecting.`);
    socket.disconnect(true); // Force disconnect
    return;
  }

  // Verify JWT token
  jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
    if (err) {
      logger.warn(`[Socket.IO Customer] JWT verification failed for token: ${token}. Error: ${err.message}. Socket ID: ${socket.id}. Disconnecting.`);
      socket.disconnect(true);
    } else {
      const customerId = decoded.id;
      const oldSocketId = onlineCustomers[customerId];
      if (oldSocketId && oldSocketId !== socket.id) {
        logger.warn(`[Socket.IO Customer] Customer ${customerId} already connected with socket ${oldSocketId}. Disconnecting old socket.`);
        const oldSocket = customerNamespace.sockets.get(oldSocketId);
        if (oldSocket) {
          oldSocket.disconnect(true);
        }
      }
      onlineCustomers[customerId] = socket.id;
      logger.info(`[Socket.IO Customer] Customer ${customerId} successfully connected. Socket ID: ${socket.id}`);
      logger.debug(`[State] Online customers: ${JSON.stringify(onlineCustomers)}`);

      // --- Restore Ride State on Connection ---
      try {
        logger.info(`[Socket.IO Customer] Checking for existing rides for customer ${customerId}`);
        const rides = await Ride.find({
          passenger: customerId,
          status: { $in: ['requested', 'accepted', 'notApprove', 'cancelled', 'arrived', 'onRide', 'completed'] },
          // notified: { $ne: true }, // Let's send current state regardless of notified flag on reconnect
        }).populate('driver', 'name carDetails phoneNumber'); // Populate driver details if needed

        logger.info(`[DB] Found ${rides.length} relevant rides for customer ${customerId}`);

        for (const ride of rides) {
          logger.info(`[Socket.IO Customer] Processing ride ${ride._id} with status ${ride.status} for customer ${customerId}`);
          let captainInfo = null;
          if (ride.driver && ride.status !== 'requested' && ride.status !== 'notApprove' && ride.status !== 'cancelled') {
              // Driver details should be populated if driver exists and ride is active/accepted
              captainInfo = ride.driver ? { // Use populated data
                name: ride.driver.name,
                vehicle: ride.driver.carDetails,
                phoneNumber: ride.driver.phoneNumber,
              } : null; // Handle case where populate might fail or driver is null
          }

          switch (ride.status) {
            case 'requested':
              logger.info(`[Socket.IO Customer] Emitting 'ridePending' for ride ${ride._id} to customer ${customerId}`);
              socket.emit('ridePending', {
                rideId: ride._id,
                pickupLocation: ride.pickupLocation.coordinates,
                dropoffLocation: ride.dropoffLocation.coordinates,
                distance: ride.distance,
                duration: ride.duration,
                fare: ride.fare.amount,
              });
              break;
            case 'accepted':
              logger.info(`[Socket.IO Customer] Emitting 'rideAccepted' for ride ${ride._id} to customer ${customerId}`);
              socket.emit("rideAccepted", {
                rideId: ride._id,
                driverId: ride.driver?._id, // Use populated data if available
                driverInfo: captainInfo,
              });
              break;
            case 'arrived':
              logger.info(`[Socket.IO Customer] Emitting 'driverArrived' for ride ${ride._id} to customer ${customerId}`);
              socket.emit("driverArrived", {
                rideId: ride._id,
                message: "Your captain has arrived.",
              });
              break;
            case 'onRide':
              logger.info(`[Socket.IO Customer] Emitting 'rideStarted' for ride ${ride._id} to customer ${customerId}`);
              socket.emit("rideStarted", { rideId: ride._id });
              break;
            case 'completed':
              logger.info(`[Socket.IO Customer] Emitting 'rideCompleted' for ride ${ride._id} to customer ${customerId}`);
              socket.emit("rideCompleted", {
                rideId: ride._id,
                message: "Your ride has been completed. Thank you for riding with us.",
              });
              break;
            case 'notApprove':
               logger.info(`[Socket.IO Customer] Emitting 'rideNotApproved' for ride ${ride._id} to customer ${customerId}`);
               socket.emit("rideNotApproved", {
                 rideId: ride._id,
                 message: "We couldn't find a captain for your previous request.", // Adjusted message
               });
               break;
            case 'cancelled':
              logger.info(`[Socket.IO Customer] Emitting 'rideCanceled' for ride ${ride._id} to customer ${customerId}`);
              socket.emit("rideCanceled", {
                rideId: ride._id,
                message: "Your ride was cancelled.",
              });
              break;
            default:
                logger.warn(`[Socket.IO Customer] Unknown ride status "${ride.status}" for ride ${ride._id}`);
          }

          // Mark the ride as notified - Debatable: Maybe only mark if status wasn't final?
          // Or remove the notified flag altogether if state is always sent on connect.
          // For now, let's keep it to avoid potential re-notifications if logic changes.
          // if (!ride.notified) {
          //   ride.notified = true;
          //   await ride.save();
          //   logger.info(`[DB] Marked ride ${ride._id} as notified.`);
          // }
        }
      } catch (err) {
        logger.error(`[Socket.IO Customer] Error checking/notifying customer ${customerId} about rides:`, err);
      }

      // --- Listen for Ride Requests ---
      socket.on("requestRide", async (rideData) => {
        logger.info(`[Socket.IO Customer] Received 'requestRide' from customer ${customerId}. Socket ID: ${socket.id}. Data: ${JSON.stringify(rideData)}`);

        // Basic validation
        if (!rideData || !rideData.origin || !rideData.destination ||
            typeof rideData.origin.latitude !== "number" || typeof rideData.origin.longitude !== "number" ||
            typeof rideData.destination.latitude !== "number" || typeof rideData.destination.longitude !== "number") {
          logger.warn(`[Socket.IO Customer] Invalid rideData received from customer ${customerId}. Data: ${JSON.stringify(rideData)}`);
          socket.emit("rideError", { message: "Invalid location data provided. Please try again." });
          return;
        }

        try {
          // Check if customer already has an active (requested, accepted, arrived, onRide) ride
          const existingRide = await Ride.findOne({
            passenger: customerId,
            status: { $in: ['requested', 'accepted', 'arrived', 'onRide'] }
          });

          if (existingRide) {
              logger.warn(`[Socket.IO Customer] Customer ${customerId} attempted to request a ride while ride ${existingRide._id} is active (status: ${existingRide.status}).`);
              socket.emit("rideError", { message: `You already have an active ride (Status: ${existingRide.status}). Please wait or cancel it.` });
              return;
          }

          logger.info(`[Socket.IO Customer] Creating new ride for customer ${customerId}`);
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
            // TODO: Calculate fare properly based on distance/duration/base fare from SystemSetting
            fare: {
              amount: rideData.fareAmount || 6000, // Use provided or default
              currency: "IQD",
            },
            distance: rideData.distance, // Assuming client sends this
            duration: rideData.duration, // Assuming client sends this
            status: "requested",
            isDispatching: true, // Mark for dispatch immediately
            notified: false, // Reset notification status
          });

          await newRide.save();
          logger.info(`[DB] Ride ${newRide._id} created successfully for customer ${customerId}. Status: requested.`);

          // Emit confirmation back to customer
          socket.emit('ridePending', { // Send pending confirmation
            rideId         : newRide._id,
            pickupLocation : newRide.pickupLocation.coordinates,
            dropoffLocation: newRide.dropoffLocation.coordinates,
            distance       : newRide.distance,
            duration       : newRide.duration,
            fare           : newRide.fare.amount,
            message        : "Ride requested. Searching for nearby captains..."
          });

          // Start the dispatch process
          logger.info(`[Dispatch] Starting dispatch process for ride ${newRide._id}`);
          dispatchRide(newRide, rideData.origin); // Pass the origin coords

        } catch (err) {
          logger.error(`[Socket.IO Customer] Error creating/broadcasting ride for customer ${customerId}:`, err);
          socket.emit("rideError", { message: "Failed to create ride. Please try again later." });
        }
      });

      // --- Handle Disconnect ---
      socket.on("disconnect", (reason) => {
        logger.info(`[Socket.IO Customer] Customer ${customerId} disconnected. Socket ID: ${socket.id}. Reason: ${reason}`);
        // Clean up: Find the customerId associated with this socket.id and remove it
        for (let id in onlineCustomers) {
          if (onlineCustomers[id] === socket.id) {
            delete onlineCustomers[id];
            logger.info(`[State] Removed customer ${id} from onlineCustomers.`);
            logger.debug(`[State] Online customers: ${JSON.stringify(onlineCustomers)}`);
            break;
          }
        }
      });

      // --- Handle Socket Errors ---
      socket.on('error', (error) => {
        logger.error(`[Socket.IO Customer] Socket error for customer ${customerId} on socket ${socket.id}:`, error);
      });
    }
  });
});

// Captain Namespace
const captainNamespace = io.of("/captain");
captainNamespace.on("connection", (socket) => {
  logger.info(`[Socket.IO Captain] Incoming connection attempt. Socket ID: ${socket.id}`);
  const token = socket.handshake.query.token;

  if (!token) {
    logger.warn(`[Socket.IO Captain] Connection attempt without token. Socket ID: ${socket.id}. Disconnecting.`);
    socket.disconnect(true);
    return;
  }

  // Verify JWT token
  jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
    if (err) {
      logger.warn(`[Socket.IO Captain] JWT verification failed for token: ${token}. Error: ${err.message}. Socket ID: ${socket.id}. Disconnecting.`);
      socket.disconnect(true);
    } else {
      const captainId = decoded.id;
      const oldSocketId = onlineCaptains[captainId];
       if (oldSocketId && oldSocketId !== socket.id) {
        logger.warn(`[Socket.IO Captain] Captain ${captainId} already connected with socket ${oldSocketId}. Disconnecting old socket.`);
        const oldSocket = captainNamespace.sockets.get(oldSocketId);
        if (oldSocket) {
            oldSocket.disconnect(true);
        }
      }
      onlineCaptains[captainId] = socket.id;
      logger.info(`[Socket.IO Captain] Captain ${captainId} successfully connected. Socket ID: ${socket.id}`);
      logger.debug(`[State] Online captains: ${JSON.stringify(onlineCaptains)}`);

      // --- Restore Captain State on Connection ---
      try {
        logger.info(`[Socket.IO Captain] Checking for ongoing or assigned rides for captain ${captainId}`);
        // Find any ride the captain is actively involved in
        const ongoingRide = await Ride.findOne({
          driver: captainId,
          status: { $in: ['accepted', 'arrived', 'onRide'] },
        }).populate('passenger', 'name phoneNumber'); // Populate passenger details

        if (ongoingRide) {
          logger.info(`[DB] Found ongoing ride ${ongoingRide._id} (Status: ${ongoingRide.status}) for captain ${captainId}. Restoring state.`);
          // Add captain back to ride sharing map if needed (e.g., if server restarted)
          if (!rideSharingMap.has(captainId)) {
              rideSharingMap.set(captainId, ongoingRide.passenger._id);
              logger.info(`[State] Restored ride sharing for captain ${captainId} and customer ${ongoingRide.passenger._id}`);
          }

          // Send the current ride details to the captain
          socket.emit("restoreRide", {
            rideId: ongoingRide._id,
            pickupLocation: ongoingRide.pickupLocation.coordinates,
            dropoffLocation: ongoingRide.dropoffLocation.coordinates,
            fare: ongoingRide.fare.amount,
            distance: ongoingRide.distance,
            duration: ongoingRide.duration,
            status: ongoingRide.status,
            passengerInfo: { // Send passenger info too
                id: ongoingRide.passenger._id,
                name: ongoingRide.passenger.name,
                phoneNumber: ongoingRide.passenger.phoneNumber
            }
          });
          logger.info(`[Socket.IO Captain] Emitted 'restoreRide' for ride ${ongoingRide._id} to captain ${captainId}`);
        } else {
          logger.info(`[Socket.IO Captain] No active ride found for captain ${captainId}. Checking for pending requests in area.`);
          // If no active ride, check Redis for captain's last known location and send pending requests
          try {
             const captainLocation = await redisClient.geoPos("captains", captainId);
             if (captainLocation && captainLocation.length > 0 && captainLocation[0]) {
                const [lonStr, latStr] = captainLocation[0];
                const longitude = parseFloat(lonStr);
                const latitude = parseFloat(latStr);
                logger.info(`[Redis] Captain ${captainId} last known location: (${longitude}, ${latitude})`);

                // Find nearby 'requested' rides (limit search for efficiency)
                // Note: This might be less efficient than the dispatch loop approach.
                // Consider if this is truly necessary or if the dispatch loop handles it sufficiently.
                // For now, keeping it as per original logic.
                const pendingRides = await Ride.find({
                    status: "requested",
                    // Optional: Add geospatial query here if DB supports it and it's indexed
                    // pickupLocation: { $near: { $geometry: { type: "Point", coordinates: [longitude, latitude] }, $maxDistance: 10000 } } // 10km
                 }); // Find all requested rides - potentially inefficient

                logger.info(`[DB] Found ${pendingRides.length} rides with status 'requested'. Checking proximity for captain ${captainId}.`);

                let notifiedRideCount = 0;
                for (let ride of pendingRides) {
                  const distance = calculateDistance(
                    { latitude, longitude },
                    {
                      latitude: ride.pickupLocation.coordinates[1],
                      longitude: ride.pickupLocation.coordinates[0],
                    }
                  );
                  // Use a reasonable radius, maybe configurable
                  const notificationRadius = 10; // km
                  if (distance <= notificationRadius) {
                    notifiedRideCount++;
                    logger.info(`[Socket.IO Captain] Ride ${ride._id} is within ${notificationRadius}km (${distance.toFixed(2)}km). Emitting 'newRide' to captain ${captainId}`);
                    socket.emit("newRide", {
                      rideId: ride._id,
                      pickupLocation: ride.pickupLocation.coordinates,
                      dropoffLocation: ride.dropoffLocation.coordinates,
                      fare: ride.fare.amount,
                      distance: ride.distance,
                      duration: ride.duration,
                      // You might want passenger rating or other info here
                    });
                  }
                }
                 logger.info(`[Socket.IO Captain] Notified captain ${captainId} about ${notifiedRideCount} pending rides within ${notificationRadius}km.`);
             } else {
                logger.warn(`[Redis] No location found in Redis for captain ${captainId}. Cannot check for pending rides.`);
             }
          } catch(geoErr) {
             logger.error(`[Redis] Error fetching captain ${captainId} location or checking pending rides:`, geoErr);
          }
        }
      } catch (err) {
        logger.error(`[Socket.IO Captain] Error restoring state for captain ${captainId}:`, err);
      }

      // --- Listen for Location Updates ---
      socket.on("updateLocation", async (data) => {
        // Validate data
        if (!data || typeof data.latitude !== 'number' || typeof data.longitude !== 'number') {
            logger.warn(`[Socket.IO Captain] Received invalid location update from captain ${captainId}. Data: ${JSON.stringify(data)}`);
            // Optionally emit an error back to captain
            // socket.emit("locationError", { message: "Invalid location data format." });
            return;
        }

        logger.debug(`[Socket.IO Captain] Received 'updateLocation' from captain ${captainId}. Data: ${JSON.stringify(data)}`);
        try {
          await redisClient.geoAdd("captains", {
            longitude: data.longitude,
            latitude: data.latitude,
            member: captainId, // Use captainId as the member identifier
          });
          logger.info(`[Redis] Location updated for captain ${captainId} to (${data.longitude}, ${data.latitude})`);

          // Share location with customer if on an active ride
          if (rideSharingMap.has(captainId)) {
            const customerId = rideSharingMap.get(captainId);
            const customerSocketId = onlineCustomers[customerId];
            if (customerSocketId) {
              logger.debug(`[Socket.IO Customer] Emitting 'driverLocationUpdate' to customer ${customerId} (Socket: ${customerSocketId}) for captain ${captainId}`);
              io.of("/customer").to(customerSocketId).emit("driverLocationUpdate", {
                latitude: data.latitude,
                longitude: data.longitude,
              });
            } else {
              logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send location update from captain ${captainId}`);
            }
          }
        } catch (err) {
           logger.error(`[Redis] Error saving location to Redis for captain ${captainId}:`, err);
           socket.emit("locationError", { message: "Location update failed on server." }); // Inform captain
        }
      });

      // --- Listen for Ride Acceptance ---
      socket.on("acceptRide", async (data) => { // Assume data = { rideId: "..." } or just rideId string
        const rideId = typeof data === 'object' ? data.rideId : data; // Handle both possibilities
        if (!rideId) {
            logger.warn(`[Socket.IO Captain] Received 'acceptRide' without rideId from captain ${captainId}.`);
            socket.emit("rideError", { message: "Missing ride ID in acceptance request." });
            return;
        }

        logger.info(`[Socket.IO Captain] Received 'acceptRide' for ride ${rideId} from captain ${captainId}. Socket ID: ${socket.id}`);

        // --- Critical Section: Prevent Race Condition ---
        // Use findOneAndUpdate which is atomic. Check status is 'requested'.
        try {
          const ride = await Ride.findOneAndUpdate(
            { _id: rideId, status: "requested" }, // Atomic condition: Find ride only if status is 'requested'
            {
              $set: {
                status: "accepted",
                driver: captainId,
                isDispatching: false // Stop dispatch attempts
              }
            },
            { new: true } // Return the updated document
          ).populate('passenger', 'name phoneNumber'); // Populate passenger details

          if (ride) {
            // Successfully accepted
            logger.info(`[DB] Ride ${rideId} successfully accepted by captain ${captainId}. Status updated to 'accepted'.`);

            // --- Stop Dispatch Process ---
            if (dispatchProcesses.has(rideId.toString())) {
              logger.info(`[Dispatch] Found active dispatch process for ride ${rideId}. Cancelling.`);
              const cancelDispatch = dispatchProcesses.get(rideId.toString());
              cancelDispatch(); // Call the cancellation function
              dispatchProcesses.delete(rideId.toString()); // Clean up map
              logger.info(`[Dispatch] Dispatch process for ride ${rideId} cancelled and removed.`);
            } else {
              logger.warn(`[Dispatch] No active dispatch process found for accepted ride ${rideId}. It might have completed or been cancelled already.`);
            }

            // --- Notify Customer ---
            const customerId = ride.passenger._id; // Use populated data
            const customerSocketId = onlineCustomers[customerId];
            if (customerSocketId) {
              try {
                  // Fetch captain's full info separately (or add more fields to populate)
                  const captainInfo = await Captain.findById(captainId).select('name carDetails phoneNumber'); // Select specific fields
                  if (!captainInfo) {
                      throw new Error(`Captain ${captainId} not found in DB`);
                  }
                  logger.info(`[Socket.IO Customer] Emitting 'rideAccepted' to customer ${customerId} (Socket: ${customerSocketId}) for ride ${rideId}`);
                  io.of("/customer").to(customerSocketId).emit("rideAccepted", {
                    rideId: ride._id,
                    driverId: captainId,
                    driverInfo: { // Send relevant, non-sensitive info
                      name: captainInfo.name,
                      vehicle: captainInfo.carDetails,
                      phoneNumber: captainInfo.phoneNumber, // Consider privacy implications
                      // Add rating, eta etc. if available
                    },
                    passengerInfo: { // Send passenger info back to captain
                        id: ride.passenger._id,
                        name: ride.passenger.name,
                        phoneNumber: ride.passenger.phoneNumber
                    }
                  });
              } catch(captainErr) {
                   logger.error(`[DB] Failed to fetch captain details for captain ${captainId}:`, captainErr);
                   // Inform customer, but maybe with partial info or a generic message
                    io.of("/customer").to(customerSocketId).emit("rideAccepted", {
                        rideId: ride._id,
                        driverId: captainId,
                        driverInfo: null, // Indicate info unavailable
                         message: "Captain accepted, details loading..."
                    });
              }

            } else {
              logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send 'rideAccepted' notification for ride ${rideId}.`);
              // Ride is still accepted, customer will see it on reconnect.
            }

             // --- Start Location Sharing ---
            rideSharingMap.set(captainId, customerId);
            logger.info(`[State] Started ride sharing for captain ${captainId} and customer ${customerId}. Ride: ${rideId}`);
            logger.debug(`[State] Ride sharing map: ${JSON.stringify(Array.from(rideSharingMap.entries()))}`);

             // --- Confirm Acceptance to Captain ---
             logger.info(`[Socket.IO Captain] Emitting 'rideAcceptedConfirmation' to captain ${captainId} for ride ${rideId}`);
             socket.emit('rideAcceptedConfirmation', {
                 rideId: ride._id,
                 status: ride.status,
                 pickupLocation: ride.pickupLocation.coordinates,
                 dropoffLocation: ride.dropoffLocation.coordinates,
                 passengerInfo: { // Send passenger info to captain
                     id: ride.passenger._id,
                     name: ride.passenger.name,
                     phoneNumber: ride.passenger.phoneNumber
                 }
                 // Add fare, distance etc. if needed
             });


          } else {
            // Ride was not found with status 'requested' (already accepted, cancelled, or doesn't exist)
            logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to accept ride ${rideId}, but it was not found or status was not 'requested'.`);
            socket.emit("rideError", { message: "Ride already taken or cancelled.", rideId: rideId });
          }
        } catch (err) {
          logger.error(`[Socket.IO Captain] Error accepting ride ${rideId} for captain ${captainId}:`, err);
          socket.emit("rideError", { message: "Failed to accept ride due to a server error.", rideId: rideId });
        }
      });

      // --- Listen for Captain Canceling Ride ---
      socket.on("cancelRide", async (data) => { // data = { rideId: "..." }
        const rideId = typeof data === 'object' ? data.rideId : data;
         if (!rideId) {
            logger.warn(`[Socket.IO Captain] Received 'cancelRide' without rideId from captain ${captainId}.`);
            socket.emit("rideError", { message: "Missing ride ID in cancellation request." });
            return;
        }
        logger.info(`[Socket.IO Captain] Received 'cancelRide' for ride ${rideId} from captain ${captainId}`);

        try {
            // Find the ride, ensure captain is assigned and status allows cancellation (e.g., accepted, arrived)
            const ride = await Ride.findOne({ _id: rideId, driver: captainId });

            if (!ride) {
                logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to cancel ride ${rideId}, but ride was not found or captain not assigned.`);
                socket.emit("rideError", { message: "Cannot cancel ride. Ride not found or you are not assigned.", rideId: rideId });
                return;
            }

            // Define cancellable statuses
            const cancellableStatuses = ['accepted', 'arrived'];
            if (!cancellableStatuses.includes(ride.status)) {
                logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to cancel ride ${rideId} with status ${ride.status}, which is not allowed.`);
                socket.emit("rideError", { message: `Cannot cancel ride. Current status is '${ride.status}'.`, rideId: rideId });
                return;
            }

            logger.info(`[DB] Updating ride ${rideId} status to 'requested' due to captain cancellation by ${captainId}. Previous status: ${ride.status}`);
            // Reset ride state for re-dispatch
            ride.status = "requested";
            ride.driver = null; // Unassign driver
            ride.isDispatching = true; // Mark for re-dispatch
            ride.cancellationReason = `Cancelled by captain ${captainId} at status ${ride.status}`; // Optional: Add reason
            await ride.save();
            logger.info(`[DB] Ride ${rideId} status updated to 'requested'.`);

            // --- Stop Location Sharing ---
            if (rideSharingMap.has(captainId)) {
                rideSharingMap.delete(captainId);
                logger.info(`[State] Stopped ride sharing for captain ${captainId} due to cancellation. Ride: ${rideId}`);
                logger.debug(`[State] Ride sharing map: ${JSON.stringify(Array.from(rideSharingMap.entries()))}`);
            }

            // --- Notify Customer ---
            const customerId = ride.passenger; // Assuming passenger field holds the ID
            const customerSocketId = onlineCustomers[customerId];
            if (customerSocketId) {
                logger.info(`[Socket.IO Customer] Emitting 'rideCanceled' to customer ${customerId} (Socket: ${customerSocketId}) for ride ${rideId}`);
                io.of("/customer").to(customerSocketId).emit("rideCanceled", {
                    rideId: ride._id,
                    message: "The captain has canceled the ride. We are searching for another captain...",
                    reason: "captain_canceled" // Provide a code
                });
            } else {
                logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send 'rideCanceled' notification for ride ${rideId}.`);
            }

            // --- Confirm Cancellation to Captain ---
            logger.info(`[Socket.IO Captain] Emitting 'rideCancelledConfirmation' to captain ${captainId} for ride ${rideId}`);
            socket.emit("rideCancelledConfirmation", { rideId: ride._id, message: "Ride successfully cancelled." });


            // --- Restart Dispatch Process ---
            logger.info(`[Dispatch] Restarting dispatch process for cancelled ride ${rideId}`);
            const originCoords = {
                latitude: ride.pickupLocation.coordinates[1],
                longitude: ride.pickupLocation.coordinates[0],
            };
            dispatchRide(ride, originCoords); // Re-dispatch the ride

        } catch (err) {
            logger.error(`[Socket.IO Captain] Error cancelling ride ${rideId} for captain ${captainId}:`, err);
            socket.emit("rideError", { message: "Failed to cancel ride due to a server error.", rideId: rideId });
        }
      });

      // --- Listen for Captain Arriving ---
      socket.on("arrived", async (data) => { // data = { rideId: "..." }
         const rideId = typeof data === 'object' ? data.rideId : data;
         if (!rideId) {
            logger.warn(`[Socket.IO Captain] Received 'arrived' without rideId from captain ${captainId}.`);
            socket.emit("rideError", { message: "Missing ride ID in arrival notification." });
            return;
        }
        logger.info(`[Socket.IO Captain] Received 'arrived' for ride ${rideId} from captain ${captainId}`);

        try {
            // Update ride status only if it's currently 'accepted' and assigned to this captain
            const ride = await Ride.findOneAndUpdate(
                { _id: rideId, driver: captainId, status: "accepted" },
                { $set: { status: "arrived" } },
                { new: true } // Return updated document
            );

            if (ride) {
                logger.info(`[DB] Ride ${rideId} status updated to 'arrived' by captain ${captainId}.`);

                // --- Notify Customer ---
                const customerId = ride.passenger;
                const customerSocketId = onlineCustomers[customerId];
                if (customerSocketId) {
                    logger.info(`[Socket.IO Customer] Emitting 'driverArrived' to customer ${customerId} (Socket: ${customerSocketId}) for ride ${rideId}`);
                    io.of("/customer").to(customerSocketId).emit("driverArrived", {
                        rideId: ride._id,
                        message: "Your captain has arrived at the pickup location.",
                    });
                } else {
                    logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send 'driverArrived' notification for ride ${rideId}.`);
                }

                // --- Confirm Status Update to Captain ---
                logger.info(`[Socket.IO Captain] Emitting 'rideStatusUpdate' (arrived) to captain ${captainId} for ride ${rideId}`);
                socket.emit("rideStatusUpdate", { rideId: ride._id, status: "arrived" });

            } else {
                // Ride not found, not assigned to captain, or status wasn't 'accepted'
                 logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to mark ride ${rideId} as 'arrived', but condition failed (not found, wrong captain, or status not 'accepted').`);
                 // Check current status if possible
                 const currentRide = await Ride.findById(rideId);
                 const errorMsg = currentRide ? `Cannot mark as arrived. Current status is '${currentRide.status}'.` : "Ride not found or you are not assigned.";
                 socket.emit("rideError", { message: errorMsg, rideId: rideId });
            }
        } catch (err) {
            logger.error(`[Socket.IO Captain] Error marking ride ${rideId} as arrived for captain ${captainId}:`, err);
            socket.emit("rideError", { message: "Failed to mark ride as arrived due to a server error.", rideId: rideId });
        }
      });

      // --- Listen for Starting Ride ---
      socket.on("startRide", async (data) => { // data = { rideId: "..." }
         const rideId = typeof data === 'object' ? data.rideId : data;
         if (!rideId) {
            logger.warn(`[Socket.IO Captain] Received 'startRide' without rideId from captain ${captainId}.`);
            socket.emit("rideError", { message: "Missing ride ID in start ride request." });
            return;
        }
        logger.info(`[Socket.IO Captain] Received 'startRide' for ride ${rideId} from captain ${captainId}`);

        try {
             // Update ride status only if it's currently 'arrived' and assigned to this captain
            const ride = await Ride.findOneAndUpdate(
                { _id: rideId, driver: captainId, status: "arrived" },
                { $set: { status: "onRide", rideStartTime: new Date() } }, // Record start time
                { new: true }
            );

            if (ride) {
                logger.info(`[DB] Ride ${rideId} status updated to 'onRide' by captain ${captainId}.`);

                // --- Notify Customer ---
                const customerId = ride.passenger;
                const customerSocketId = onlineCustomers[customerId];
                if (customerSocketId) {
                    logger.info(`[Socket.IO Customer] Emitting 'rideStarted' to customer ${customerId} (Socket: ${customerSocketId}) for ride ${rideId}`);
                    io.of("/customer").to(customerSocketId).emit("rideStarted", {
                        rideId: ride._id,
                        message: "Your ride has started.",
                    });
                } else {
                    logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send 'rideStarted' notification for ride ${rideId}.`);
                }

                 // --- Confirm Status Update to Captain ---
                logger.info(`[Socket.IO Captain] Emitting 'rideStatusUpdate' (onRide) to captain ${captainId} for ride ${rideId}`);
                // Use specific event or generic status update
                // socket.emit("rideStatusUpdate", { rideId: ride._id, status: "onRide" });
                socket.emit("rideStartedConfirmation", { rideId: ride._id, status: "onRide" }); // More specific confirmation

            } else {
                // Ride not found, not assigned to captain, or status wasn't 'arrived'
                logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to start ride ${rideId}, but condition failed (not found, wrong captain, or status not 'arrived').`);
                const currentRide = await Ride.findById(rideId);
                const errorMsg = currentRide ? `Cannot start ride. Current status is '${currentRide.status}'.` : "Ride not found or you are not assigned.";
                socket.emit("rideError", { message: errorMsg, rideId: rideId });
            }
        } catch (err) {
            logger.error(`[Socket.IO Captain] Error starting ride ${rideId} for captain ${captainId}:`, err);
            socket.emit("rideError", { message: "Failed to start ride due to a server error.", rideId: rideId });
        }
      });

      // --- Listen for Ending Ride ---
      socket.on("endRide", async (data) => { // data = { rideId: "..." }
         const rideId = typeof data === 'object' ? data.rideId : data;
         if (!rideId) {
            logger.warn(`[Socket.IO Captain] Received 'endRide' without rideId from captain ${captainId}.`);
            socket.emit("rideError", { message: "Missing ride ID in end ride request." });
            return;
        }
        logger.info(`[Socket.IO Captain] Received 'endRide' for ride ${rideId} from captain ${captainId}`);

        try {
            // Update ride status only if it's currently 'onRide' and assigned to this captain
            const ride = await Ride.findOneAndUpdate(
                { _id: rideId, driver: captainId, status: "onRide" },
                {
                    $set: {
                        status: "completed",
                        rideEndTime: new Date(),
                        isDispatching: false // Ensure dispatching is off
                    }
                },
                { new: true }
            );

            if (ride) {
                logger.info(`[DB] Ride ${rideId} status updated to 'completed' by captain ${captainId}.`);

                // --- Notify Customer ---
                const customerId = ride.passenger;
                const customerSocketId = onlineCustomers[customerId];
                if (customerSocketId) {
                     logger.info(`[Socket.IO Customer] Emitting 'rideCompleted' to customer ${customerId} (Socket: ${customerSocketId}) for ride ${rideId}`);
                    io.of("/customer").to(customerSocketId).emit("rideCompleted", {
                        rideId: ride._id,
                        message: "Your ride has been completed. Thank you for riding with us!",
                        fare: ride.fare.amount, // Send final fare
                        // Add distance, duration etc if needed
                    });
                } else {
                     logger.warn(`[Socket.IO Customer] Customer ${customerId} is offline. Cannot send 'rideCompleted' notification for ride ${rideId}.`);
                }

                // --- Confirm Status Update to Captain ---
                logger.info(`[Socket.IO Captain] Emitting 'rideStatusUpdate' (completed) to captain ${captainId} for ride ${rideId}`);
                socket.emit("rideStatusUpdate", {
                    rideId: ride._id,
                    status: "completed",
                    message: "Ride successfully completed."
                });

                // --- Clean Up State ---
                if (rideSharingMap.has(captainId)) {
                    rideSharingMap.delete(captainId);
                    logger.info(`[State] Stopped ride sharing for captain ${captainId} after ride completion. Ride: ${rideId}`);
                    logger.debug(`[State] Ride sharing map: ${JSON.stringify(Array.from(rideSharingMap.entries()))}`);
                }

                // Optionally, remove captain's location from Redis if they are now considered 'off-duty' until next update
                // Be careful with this - only remove if they explicitly go offline or inactive
                // await redisClient.zRem("captains", captainId);
                // logger.info(`[Redis] Removed captain ${captainId} from active captains set after ride completion.`);

            } else {
                // Ride not found, not assigned to captain, or status wasn't 'onRide'
                logger.warn(`[Socket.IO Captain] Captain ${captainId} tried to end ride ${rideId}, but condition failed (not found, wrong captain, or status not 'onRide').`);
                const currentRide = await Ride.findById(rideId);
                const errorMsg = currentRide ? `Cannot end ride. Current status is '${currentRide.status}'.` : "Ride not found or you are not assigned.";
                socket.emit("rideError", { message: errorMsg, rideId: rideId });
            }
        } catch (err) {
             logger.error(`[Socket.IO Captain] Error ending ride ${rideId} for captain ${captainId}:`, err);
            socket.emit("rideError", { message: "Failed to end ride due to a server error.", rideId: rideId });
        }
      });

      // --- Handle Disconnect ---
      socket.on("disconnect", (reason) => {
        logger.info(`[Socket.IO Captain] Captain ${captainId} disconnected. Socket ID: ${socket.id}. Reason: ${reason}`);
        // Clean up: Find the captainId associated with this socket.id and remove it
        for (let id in onlineCaptains) {
          if (onlineCaptains[id] === socket.id) {
            delete onlineCaptains[id];
            logger.info(`[State] Removed captain ${id} from onlineCaptains.`);
            logger.debug(`[State] Online captains: ${JSON.stringify(onlineCaptains)}`);
            // Decide if captain's location should be removed from Redis on disconnect
            // redisClient.zRem("captains", id).catch(err => logger.error(`[Redis] Error removing captain ${id} from Redis on disconnect:`, err));
            break;
          }
        }
         // Clean up ride sharing map if the disconnected captain was in it
         if (rideSharingMap.has(captainId)) {
             const customerId = rideSharingMap.get(captainId);
             rideSharingMap.delete(captainId);
             logger.warn(`[State] Captain ${captainId} disconnected during active ride sharing with customer ${customerId}. Ride sharing stopped.`);
             logger.debug(`[State] Ride sharing map: ${JSON.stringify(Array.from(rideSharingMap.entries()))}`);
             // Optionally notify the customer that the captain went offline
             // const customerSocketId = onlineCustomers[customerId];
             // if (customerSocketId) { io.of("/customer").to(customerSocketId).emit("captainOffline"); }
         }
      });

       // --- Handle Socket Errors ---
       socket.on('error', (error) => {
        logger.error(`[Socket.IO Captain] Socket error for captain ${captainId} on socket ${socket.id}:`, error);
      });
    }
  });
});

// --- Ride Dispatching Logic ---
async function dispatchRide(ride, origin) {
  const rideId = ride._id.toString();
  logger.info(`[Dispatch] Starting dispatch for ride ${rideId}. Origin: (${origin.longitude}, ${origin.latitude})`);

  let radius = 2; // Starting radius in km
  const maxRadius = 10; // Maximum search radius
  const radiusIncrement = 1; // Radius increment in km (was 0.5, increased for faster expansion)
  const notificationTimeout = 15 * 1000; // Time to wait for a captain to accept (15 seconds)
  const maxDispatchTime = 5 * 60 * 1000; // Max time to search (5 minutes) - was 10
  const graceAfterMaxRadius    = 30 * 1000;  // ← NEW – 30 s extra wait

  const dispatchStartTime = Date.now();

  let cancelDispatch = false;
  let accepted = false; // Flag to track if ride was accepted within the loop

  // Cancellation function for this specific dispatch process
  const cancelFunc = () => {
    logger.warn(`[Dispatch] Cancellation requested externally for ride ${rideId}.`);
    cancelDispatch = true;
  };
  dispatchProcesses.set(rideId, cancelFunc);
  logger.debug(`[Dispatch] Registered cancellation function for ride ${rideId}`);

  try {
    // Keep track of captains already notified in this dispatch cycle to avoid spamming
    const notifiedCaptains = new Set();

    while (!cancelDispatch && !accepted && radius <= maxRadius) {
      // Check for overall timeout
      if (Date.now() - dispatchStartTime >= maxDispatchTime) {
        logger.warn(`[Dispatch] Max dispatch time (${maxDispatchTime / 1000}s) exceeded for ride ${rideId}.`);
        cancelDispatch = true; // Mark for cancellation, status update happens after loop
        break; // Exit the while loop
      }

      // Check if the ride object still exists and is 'requested' before searching
      const currentRideState = await Ride.findById(rideId).select('status');
      if (!currentRideState || currentRideState.status !== 'requested') {
          logger.warn(`[Dispatch] Ride ${rideId} is no longer in 'requested' state (current: ${currentRideState?.status}). Stopping dispatch.`);
          cancelDispatch = true;
          break;
      }


      logger.info(`[Dispatch] Ride ${rideId}: Searching radius ${radius} km.`);
      const nearbyCaptainIds = await findNearbyCaptains(origin, radius);

      if (nearbyCaptainIds.length > 0) {
        let newCaptainsFoundInRadius = false;
        for (const captainId of nearbyCaptainIds) {
          if (cancelDispatch || accepted) break; // Exit loop early if cancelled or accepted

          // Check if captain is online and *not* already notified in this cycle
          if (onlineCaptains[captainId] && !notifiedCaptains.has(captainId)) {
            newCaptainsFoundInRadius = true;
            notifiedCaptains.add(captainId); // Mark as notified for this cycle
            const captainSocketId = onlineCaptains[captainId];

            logger.info(`[Dispatch] Ride ${rideId}: Notifying captain ${captainId} (Socket: ${captainSocketId})`);
            io.of("/captain").to(captainSocketId).emit("newRide", {
              rideId: ride._id,
              pickupLocation: ride.pickupLocation.coordinates,
              dropoffLocation: ride.dropoffLocation.coordinates,
              fare: ride.fare.amount,
              distance: ride.distance,
              duration: ride.duration,
              // Add passenger rating etc. if available
            });

            // --- Asynchronous Wait and Check ---
            // Start a timer, but don't block the main loop for other captains in the same radius
            // Check ride status *after* the timeout for *this specific captain*
            // This part is tricky. The original code waited synchronously which is bad.
            // A better approach:
            // 1. Notify all captains in the current radius.
            // 2. Wait for a *short* period (e.g., notificationTimeout).
            // 3. Check if the ride status changed to 'accepted'.

            // Let's stick closer to the original logic for now but acknowledge its flaw:
            // Waiting 10s sequentially per captain is very slow.
            // A better real-world system uses a "broadcast and wait" or assigns to one captain at a time with shorter timeouts.

            // *** Simplified (but still sequential) wait for demonstration ***
             logger.debug(`[Dispatch] Ride ${rideId}: Waiting ${notificationTimeout / 1000}s for captain ${captainId} to potentially accept.`);
             await new Promise((resolve) => setTimeout(resolve, notificationTimeout));

             // Check if the ride was accepted *during* the wait
             const updatedRide = await Ride.findById(rideId).select('status driver'); // Select only needed fields
             if (updatedRide && updatedRide.status === "accepted") {
               accepted = true; // Mark as accepted
               logger.info(`[Dispatch] Ride ${rideId} was accepted by captain ${updatedRide.driver} during wait period.`);
               // No need to set cancelDispatch=true here, the 'accepted' flag stops the outer loop
               break; // Exit the inner captain loop
             } else {
                 logger.info(`[Dispatch] Ride ${rideId}: Captain ${captainId} did not accept within ${notificationTimeout / 1000}s (or ride status changed). Current status: ${updatedRide?.status}`);
             }
             // --- End Simplified Wait ---
          }
        } // End captain loop

        // If we found new captains in this radius, wait a bit before expanding radius further
        // This gives notified captains a chance to accept without immediately widening the search.
        if (newCaptainsFoundInRadius && !accepted && !cancelDispatch) {
            logger.debug(`[Dispatch] Ride ${rideId}: Pausing briefly after notifying captains in radius ${radius}km.`);
            await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds

            // Re-check if accepted during the pause
             const updatedRide = await Ride.findById(rideId).select('status');
             if (updatedRide && updatedRide.status === "accepted") {
               accepted = true;
               logger.info(`[Dispatch] Ride ${rideId} was accepted during pause.`);
             }
        }

      } else {
        logger.info(`[Dispatch] Ride ${rideId}: No captains found within radius ${radius} km.`);
      }

      // Increase radius only if not accepted and not cancelled
      if (!accepted && !cancelDispatch) {
        radius += radiusIncrement;
        logger.info(`[Dispatch] Ride ${rideId}: Increasing search radius to ${radius} km.`);
        // Optional: Add a small delay before the next radius search
        // await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } // End while loop

    // --- Handle Dispatch Outcome ---
    // Check *after* the loop finishes
    const finalRideState = await Ride.findById(rideId); // Get the latest state

     if (accepted) {
        // Ride was accepted by someone, log success. State changes handled in 'acceptRide'
        logger.info(`[Dispatch] Ride ${rideId} successfully accepted by captain ${finalRideState?.driver}. Dispatch process complete.`);
     } else if (cancelDispatch) {
        // Dispatch was cancelled externally (e.g., accepted via API/another process) or timed out
        logger.warn(`[Dispatch] Dispatch for ride ${rideId} was cancelled or timed out.`);
        // If timeout occurred specifically, mark as notApprove
        if (Date.now() - dispatchStartTime >= maxDispatchTime && finalRideState && finalRideState.status === 'requested') {
            logger.warn(`[Dispatch] Ride ${rideId} timed out. Updating status to 'notApprove'.`);
            finalRideState.status = "notApprove";
            finalRideState.isDispatching = false;
            await finalRideState.save();
            logger.info(`[DB] Ride ${rideId} status updated to 'notApprove'.`);

            // Notify customer
            const customerSocketId = onlineCustomers[finalRideState.passenger];
            if (customerSocketId) {
                 logger.info(`[Socket.IO Customer] Emitting 'rideNotApproved' (timeout) to customer ${finalRideState.passenger} for ride ${rideId}`);
                 io.of("/customer").to(customerSocketId).emit("rideNotApproved", {
                    rideId: ride._id,
                    message: "We couldn't find a nearby captain in time. Please try requesting again.",
                 });
            }
        }
     } /******************************************************************
     *  ⭕  Max radius reached — wait a final 30 s before giving up   *
     ******************************************************************/
    else if (radius > maxRadius && !cancelDispatch && !accepted) {
      logger.warn(
        `[Dispatch] Ride ${rideId}: reached max radius (${maxRadius} km). ` +
        `Holding for an extra ${graceAfterMaxRadius / 1000}s before aborting.`,
      );
    
      // non‑blocking sleep, polling every 5 s in case someone accepts
      const pollInterval = 5 * 1000;
      const giveUpAt     = Date.now() + graceAfterMaxRadius;
    
      while (Date.now() < giveUpAt && !accepted && !cancelDispatch) {
        await new Promise(res => setTimeout(res, pollInterval));
    
        const stillRequested = await Ride.findById(rideId).select('status driver');
        if (stillRequested?.status === 'accepted') {
          accepted = true;
          logger.info(
            `[Dispatch] Ride ${rideId} was accepted by captain ` +
            `${stillRequested.driver} during grace period.`,
          );
        }
      }
    
      if (!accepted && !cancelDispatch) {
        logger.warn(
          `[Dispatch] Ride ${rideId}: no acceptance after extra 30 s. ` +
          `Updating status to 'notApprove'.`,
        );
    
        const rideDoc = await Ride.findById(rideId);
        if (rideDoc && rideDoc.status === 'requested') {
          rideDoc.status        = 'notApprove';
          rideDoc.isDispatching = false;
          await rideDoc.save();
          logger.info(`[DB] Ride ${rideId} status updated to 'notApprove'.`);
    
          const custSock = onlineCustomers[rideDoc.passenger];
          if (custSock) {
            io.of('/customer').to(custSock).emit('rideNotApproved', {
              rideId : rideDoc._id,
              message:
                'لم نعثر على كابتن قريب في الوقت الحالي، الرجاء المحاولة مرة أخرى لاحقاً.',
            });
          }
        }
      }
    }
     else {
         // Should not happen if logic is correct
         logger.warn(`[Dispatch] Ride ${rideId}: Dispatch loop ended with unexpected state (not accepted, not cancelled, radius <= maxRadius). Final Status: ${finalRideState?.status}`);
     }

  } catch (err) {
    logger.error(`[Dispatch] Error during dispatch process for ride ${rideId}:`, err);
    // Attempt to mark ride as failed or log the issue without crashing
    try {
        const rideToUpdate = await Ride.findById(rideId);
        if (rideToUpdate && rideToUpdate.status === 'requested') {
            rideToUpdate.status = 'failed'; // Or keep requested and retry?
            rideToUpdate.isDispatching = false;
            rideToUpdate.cancellationReason = `Dispatch error: ${err.message}`;
            await rideToUpdate.save();
            logger.info(`[DB] Marked ride ${rideId} as 'failed' due to dispatch error.`);
            // Notify customer?
        }
    } catch (saveErr) {
        logger.error(`[Dispatch] Failed to update ride ${rideId} status after dispatch error:`, saveErr);
    }
  } finally {
    // --- Clean up Dispatch Process ---
    if (dispatchProcesses.has(rideId)) {
      dispatchProcesses.delete(rideId);
      logger.info(`[Dispatch] Cleaned up dispatch process entry for ride ${rideId}.`);
      logger.debug(`[Dispatch] Active dispatch processes: ${Array.from(dispatchProcesses.keys())}`);
    }
  }
}

// --- Middleware and Express Setup ---
const corsOptions = {
  // Be more specific in production, e.g., env variables
  origin: [
    /^(http:\/\/.+:8080)$/, // Common dev ports
    /^(http:\/\/.+:8085)$/,
    /^(http:\/\/.+:80)$/,   // Standard HTTP
    /^(http:\/\/.+:3001)$/, // React dev
    /^(http:\/\/.+:3000)$/, // Other common dev
    /^(http:\/\/.+:5000)$/, // Flask/Python dev
    /^(http:\/\/.+:5001)$/, // This server's typical port
    'http://localhost:5001', // Explicit localhost
    // Add your production frontend URL(s) here
    // e.g., 'https://your-frontend.com'
  ],
  credentials: true,
  // "Access-Control-Allow-Credentials": true, // This is handled by `credentials: true`
};

app.use(cors(corsOptions));
logger.info('[System] CORS middleware configured.');
app.use(compression());
logger.info('[System] Compression middleware enabled.');
// Morgan logging - Use 'tiny' or 'short' in production for less verbosity
// Pipe Morgan output through Winston
app.use(morgan('dev', { stream: { write: message => logger.info(`[HTTP] ${message.trim()}`) } }));
logger.info('[System] Morgan HTTP logging middleware enabled (dev format).');
app.use(express.static(path.join(__dirname, "public")));
logger.info(`[System] Serving static files from ${path.join(__dirname, "public")}`);
app.use(express.json()); // For parsing application/json
logger.info('[System] Express JSON body parser middleware enabled.');
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
logger.info('[System] Express URL-encoded body parser middleware enabled.');
app.use(cookieParser());
logger.info('[System] Cookie parser middleware enabled.');
app.use(flash()); // For flash messages (often used with sessions/views)
logger.info('[System] Connect-flash middleware enabled.');

// View Engine Setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");
logger.info(`[System] View engine set to 'ejs' with views directory ${path.join(__dirname, "views")}`);

// --- Routes ---
// Separate API routes from view routes if possible
app.use(require("./routes")); // Assumes ./routes defines view routes, etc.
logger.info('[System] Loaded main application routes from ./routes.');

// --- REST API Endpoint Example ---
const apiRouter = express.Router(); // Use a dedicated router for API

apiRouter.post('/requestRide', async (req, res) => {
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
          dispatchRide(newRide, rideData.origin);
          logger.info(`[Dispatch] Initiated dispatch for API-requested ride ${newRide._id}.`);

          // Respond to the API client
          res.status(201).json({ message: 'Ride requested successfully. Searching for captains.', rideId: newRide._id });

      }); // End JWT verify callback
  } catch (err) {
    logger.error("[API] /api/requestRide: Error processing request:", err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to create ride due to a server issue.' });
  }
});

// Mount the API router
app.use('/api', apiRouter); // Prefix all API routes with /api
logger.info('[System] Mounted API router at /api.');


// --- System Initialization Checks ---
SystemSetting.countDocuments()
  .then((count) => {
    if (count === 0) {
        logger.warn("[DB] No SystemSetting document found. Creating default.");
        const systemSetting = new SystemSetting({
            name: "main",
            screenImg: "img/background.png",
            // Add other default settings: base_fare, price_per_km, etc.
            baseFare: 3000,
            pricePerKm: 500,
            currency: "IQD",
        });
        return systemSetting.save();
    } else {
        logger.info("[DB] SystemSetting document(s) found.");
        return null; // Return null promise if no save needed
    }
  })
  .then((savedSetting) => {
      if(savedSetting) {
          logger.info("[DB] Default SystemSetting document created successfully.");
      }
  })
  .catch((err) =>
    logger.error("[DB] Error checking or creating SystemSetting document:", err)
  );

// --- Background Ride Dispatcher (Redundant Check) ---
// This interval checks for rides that might have been created but missed the initial dispatch call
// (e.g., during a server restart or if the direct call failed silently).
// It also helps restart dispatch if `isDispatching` was somehow stuck on true for a 'requested' ride.
const dispatchCheckInterval = 30 * 1000; // Check every 30 seconds
logger.info(`[Dispatch] Background dispatcher check interval set to ${dispatchCheckInterval / 1000}s.`);

setInterval(async () => {
  logger.debug('[Dispatch Interval] Checking for requested rides needing dispatch...');
  try {
    // Find rides that are 'requested' but NOT currently being handled by an active dispatch process
    const ridesToDispatch = await Ride.find({
        status: 'requested',
        _id: { $nin: Array.from(dispatchProcesses.keys()) } // Find rides not in the active dispatch map
    });

    if (ridesToDispatch.length > 0) {
        logger.info(`[Dispatch Interval] Found ${ridesToDispatch.length} requested rides potentially needing dispatch: ${ridesToDispatch.map(r => r._id).join(', ')}`);
        for (const ride of ridesToDispatch) {
            // Double check if a process was somehow created just now
            if (dispatchProcesses.has(ride._id.toString())) {
                logger.warn(`[Dispatch Interval] Dispatch process for ride ${ride._id} already exists. Skipping.`);
                continue;
            }

            logger.info(`[Dispatch Interval] Initiating dispatch for ride ${ride._id}`);
            // It's generally safer to let dispatchRide manage the 'isDispatching' flag.
            // ride.isDispatching = true; // Mark it here if needed, but dispatchRide should handle it
            // await ride.save();

            const originCoords = {
                latitude: ride.pickupLocation.coordinates[1],
                longitude: ride.pickupLocation.coordinates[0],
            };
            dispatchRide(ride, originCoords); // Start dispatch
        }
    } else {
         logger.debug('[Dispatch Interval] No requested rides found needing dispatch initiation.');
    }
  } catch (err) {
    logger.error("[Dispatch Interval] Error checking for dispatchable rides:", err);
  }
}, dispatchCheckInterval);


// --- Global Error Handling Middleware (Last Middleware) ---
app.use((err, req, res, next) => {
    logger.error('[Express Error Handler] Unhandled error:', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        ip: req.ip,
    });

    // Avoid sending stack trace in production
    const statusCode = err.status || 500;
    res.status(statusCode).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
    });
});


// --- Start Server ---
const PORT = process.env.PORT || 5230;
server.listen(PORT, () => {
  logger.info(`[System] Server listening on port ${PORT}`);
});

// --- Graceful Shutdown ---
const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
signals.forEach(signal => {
    process.on(signal, async () => {
        logger.warn(`[System] Received ${signal}. Shutting down gracefully...`);
        // 1. Stop accepting new connections (server.close does this)
        server.close(async (err) => {
            if (err) {
                logger.error('[System] Error closing HTTP server:', err);
                process.exit(1); // Force exit if server close fails
            }
            logger.info('[System] HTTP server closed.');

            // 2. Close Socket.IO connections
             logger.info('[System] Closing Socket.IO connections...');
             io.close((err) => {
                 if (err) {
                     logger.error('[System] Error closing Socket.IO:', err);
                 } else {
                     logger.info('[System] Socket.IO connections closed.');
                 }

                 // 3. Close Redis connection
                 logger.info('[System] Closing Redis connection...');
                 redisClient.quit()
                    .then(() => logger.info('[Redis] Redis client quit successfully.'))
                    .catch(redisErr => logger.error('[Redis] Error quitting Redis client:', redisErr))
                    .finally(() => {
                        // 4. Close Database connection (if mongoose connection is accessible)
                        // require('./config/database').closeConnection(); // Assuming you have a close function
                        logger.info('[System] Database connection should be closed here if managed.');

                        logger.info('[System] Graceful shutdown complete.');
                        process.exit(0); // Exit successfully
                    });
             });
        });

        // Force shutdown after a timeout if graceful shutdown hangs
        setTimeout(() => {
            logger.error('[System] Graceful shutdown timed out. Forcing exit.');
            process.exit(1);
        }, 10000); // 10 seconds timeout
    });
});