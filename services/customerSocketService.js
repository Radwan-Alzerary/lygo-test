const jwt = require("jsonwebtoken");
const Ride = require("../model/ride");

class CustomerSocketService {
  constructor(io, logger, dependencies) {
    this.io = io;
    this.logger = logger;
    this.onlineCustomers = dependencies.onlineCustomers;
    this.onlineCaptains = dependencies.onlineCaptains;
    this.dispatchProcesses = dependencies.dispatchProcesses;
    this.rideSharingMap = dependencies.rideSharingMap;
    this.dispatchRide = dependencies.dispatchRide;
    this.calculateDistance = dependencies.calculateDistance;
    
    this.customerNamespace = null;
  }

  initialize() {
    // Customer Namespace
    this.customerNamespace = this.io.of("/customer");
    this.customerNamespace.on("connection", (socket) => this.handleConnection(socket));
    this.logger.info('[CustomerSocketService] Customer namespace initialized.');
  }

  handleConnection(socket) {
    this.logger.info(`[Socket.IO Customer] Incoming connection attempt. Socket ID: ${socket.id}`);
    const token = socket.handshake.query.token;

    if (!token) {
      this.logger.warn(`[Socket.IO Customer] Connection attempt without token. Socket ID: ${socket.id}. Disconnecting.`);
      socket.disconnect(true);
      return;
    }

    // Verify JWT token
    jwt.verify(token, process.env.JWT_SECRET || "kishan sheth super secret key", async (err, decoded) => {
      if (err) {
        this.logger.warn(`[Socket.IO Customer] JWT verification failed for token: ${token}. Error: ${err.message}. Socket ID: ${socket.id}. Disconnecting.`);
        socket.disconnect(true);
      } else {
        await this.handleAuthenticated(socket, decoded);
      }
    });
  }

  async handleAuthenticated(socket, decoded) {
    const customerId = decoded.id;
    const oldSocketId = this.onlineCustomers[customerId];
    
    if (oldSocketId && oldSocketId !== socket.id) {
      this.logger.warn(`[Socket.IO Customer] Customer ${customerId} already connected with socket ${oldSocketId}. Disconnecting old socket.`);
      const oldSocket = this.customerNamespace.sockets.get(oldSocketId);
      if (oldSocket) {
        oldSocket.disconnect(true);
      }
    }
    
    this.onlineCustomers[customerId] = socket.id;
    this.logger.info(`[Socket.IO Customer] Customer ${customerId} successfully connected. Socket ID: ${socket.id}`);
    this.logger.debug(`[State] Online customers: ${JSON.stringify(this.onlineCustomers)}`);

    // Restore ride state on connection
    await this.restoreRideState(socket, customerId);

    // Setup event listeners
    this.setupEventListeners(socket, customerId);
  }

  async restoreRideState(socket, customerId) {
    try {
      this.logger.info(`[Socket.IO Customer] Checking for existing rides for customer ${customerId}`);
      const rides = await Ride.find({
        passenger: customerId,
        status: { $in: ['requested', 'accepted', 'notApprove', 'cancelled', 'arrived', 'onRide', 'completed'] },
      }).populate('driver', 'name carDetails phoneNumber');

      this.logger.info(`[DB] Found ${rides.length} relevant rides for customer ${customerId}`);

      for (const ride of rides) {
        this.logger.info(`[Socket.IO Customer] Processing ride ${ride._id} with status ${ride.status} for customer ${customerId}`);
        let captainInfo = null;
        
        if (ride.driver && ride.status !== 'requested' && ride.status !== 'notApprove' && ride.status !== 'cancelled') {
          captainInfo = ride.driver ? {
            name: ride.driver.name,
            vehicle: ride.driver.carDetails,
            phoneNumber: ride.driver.phoneNumber,
          } : null;
        }

        this.emitRideStatus(socket, ride, captainInfo);
      }
    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error checking/notifying customer ${customerId} about rides:`, err);
    }
  }

  emitRideStatus(socket, ride, captainInfo) {
    const rideId = ride._id;
    
    switch (ride.status) {
      case 'requested':
        this.logger.info(`[Socket.IO Customer] Emitting 'ridePending' for ride ${rideId}`);
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
        this.logger.info(`[Socket.IO Customer] Emitting 'rideAccepted' for ride ${rideId}`);
        socket.emit("rideAccepted", {
          rideId: ride._id,
          driverId: ride.driver?._id,
          driverInfo: captainInfo,
        });
        break;
      case 'arrived':
        this.logger.info(`[Socket.IO Customer] Emitting 'driverArrived' for ride ${rideId}`);
        socket.emit("driverArrived", {
          rideId: ride._id,
          message: "Your captain has arrived.",
        });
        break;
      case 'onRide':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideStarted' for ride ${rideId}`);
        socket.emit("rideStarted", { rideId: ride._id });
        break;
      case 'completed':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideCompleted' for ride ${rideId}`);
        socket.emit("rideCompleted", {
          rideId: ride._id,
          message: "Your ride has been completed. Thank you for riding with us.",
        });
        break;
      case 'notApprove':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideNotApproved' for ride ${rideId}`);
        socket.emit("rideNotApproved", {
          rideId: ride._id,
          message: "We couldn't find a captain for your previous request.",
        });
        break;
      case 'cancelled':
        this.logger.info(`[Socket.IO Customer] Emitting 'rideCanceled' for ride ${rideId}`);
        socket.emit("rideCanceled", {
          rideId: ride._id,
          message: "Your ride was cancelled.",
        });
        break;
      default:
        this.logger.warn(`[Socket.IO Customer] Unknown ride status "${ride.status}" for ride ${rideId}`);
    }
  }

  setupEventListeners(socket, customerId) {
    // Listen for ride requests
    socket.on("requestRide", async (rideData) => {
      await this.handleRideRequest(socket, customerId, rideData);
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      this.handleDisconnect(socket, customerId, reason);
    });

    // Handle socket errors
    socket.on('error', (error) => {
      this.logger.error(`[Socket.IO Customer] Socket error for customer ${customerId} on socket ${socket.id}:`, error);
    });
  }

  async handleRideRequest(socket, customerId, rideData) {
    this.logger.info(`[Socket.IO Customer] Received 'requestRide' from customer ${customerId}. Socket ID: ${socket.id}. Data: ${JSON.stringify(rideData)}`);

    // Basic validation
    if (!rideData || !rideData.origin || !rideData.destination ||
        typeof rideData.origin.latitude !== "number" || typeof rideData.origin.longitude !== "number" ||
        typeof rideData.destination.latitude !== "number" || typeof rideData.destination.longitude !== "number") {
      this.logger.warn(`[Socket.IO Customer] Invalid rideData received from customer ${customerId}. Data: ${JSON.stringify(rideData)}`);
      socket.emit("rideError", { message: "Invalid location data provided. Please try again." });
      return;
    }

    try {
      // Check if customer already has an active ride
      const existingRide = await Ride.findOne({
        passenger: customerId,
        status: { $in: ['requested', 'accepted', 'arrived', 'onRide'] }
      });

      if (existingRide) {
        this.logger.warn(`[Socket.IO Customer] Customer ${customerId} attempted to request a ride while ride ${existingRide._id} is active (status: ${existingRide.status}).`);
        socket.emit("rideError", { message: `You already have an active ride (Status: ${existingRide.status}). Please wait or cancel it.` });
        return;
      }

      this.logger.info(`[Socket.IO Customer] Creating new ride for customer ${customerId}`);
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
          amount: rideData.fareAmount || 6000,
          currency: "IQD",
        },
        distance: rideData.distance,
        duration: rideData.duration,
        status: "requested",
        isDispatching: true,
        notified: false,
      });

      await newRide.save();
      this.logger.info(`[DB] Ride ${newRide._id} created successfully for customer ${customerId}. Status: requested.`);

      // Emit confirmation back to customer
      socket.emit('ridePending', {
        rideId: newRide._id,
        pickupLocation: newRide.pickupLocation.coordinates,
        dropoffLocation: newRide.dropoffLocation.coordinates,
        distance: newRide.distance,
        duration: newRide.duration,
        fare: newRide.fare.amount,
        message: "Ride requested. Searching for nearby captains..."
      });

      // Start the dispatch process
      this.logger.info(`[Dispatch] Starting dispatch process for ride ${newRide._id}`);
      this.dispatchRide(newRide, rideData.origin);

    } catch (err) {
      this.logger.error(`[Socket.IO Customer] Error creating/broadcasting ride for customer ${customerId}:`, err);
      socket.emit("rideError", { message: "Failed to create ride. Please try again later." });
    }
  }

  handleDisconnect(socket, customerId, reason) {
    this.logger.info(`[Socket.IO Customer] Customer ${customerId} disconnected. Socket ID: ${socket.id}. Reason: ${reason}`);
    
    // Clean up: Find the customerId associated with this socket.id and remove it
    for (let id in this.onlineCustomers) {
      if (this.onlineCustomers[id] === socket.id) {
        delete this.onlineCustomers[id];
        this.logger.info(`[State] Removed customer ${id} from onlineCustomers.`);
        this.logger.debug(`[State] Online customers: ${JSON.stringify(this.onlineCustomers)}`);
        break;
      }
    }
  }

  // Method to emit events to customers (called from other services)
  emitToCustomer(customerId, event, data) {
    const customerSocketId = this.onlineCustomers[customerId];
    if (customerSocketId) {
      this.customerNamespace.to(customerSocketId).emit(event, data);
      return true;
    }
    return false;
  }
}

module.exports = CustomerSocketService;