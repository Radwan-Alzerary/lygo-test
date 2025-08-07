const express = require("express");
const http = require("http");
const path = require("path");

// Load environment variables
require("dotenv").config();

// Initialize database connection
require("./config/database"); // Assuming this connects to MongoDB
require("./model/user"); // Ensure User model is registered if needed elsewhere

// Import configurations and services
const createLogger = require("./config/logger");
const RedisConfig = require("./config/redis");
const { setupMiddleware, setupErrorHandling } = require("./middleware");
const { calculateDistance } = require("./utils/helpers");
const cors = require("cors");

// Import socket services
const CustomerSocketService = require("./services/customerSocketService");
const CaptainSocketService = require("./services/captainSocketService");
const DispatchService = require("./services/dispatchService");
const SystemService = require("./services/systemService");
const ChatService = require("./services/chatService"); // Chat service

// Import API routes
const createApiRoutes = require("./routes/api");

class RideHailingApp {
  constructor() {
    this.logger = createLogger();
    this.app = express();
    const whitelist = [
      "https://dashboard.lygo-iq.com",
      "http://localhost:3000",
    ];

    const corsOptions = {
      origin: (origin, callback) => {
        // allow requests with no origin (like mobile/native clients, curl, postman)
        if (!origin) return callback(null, true);

        if (whitelist.includes(origin)) {
          callback(null, true);
        } else {
          callback(new Error(`CORS policy: origin ${origin} not allowed`));
        }
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    };

    // … inside your RideHailingApp constructor or setupMiddleware:
    this.app.use(cors(corsOptions));
    this.app.options("*", cors(corsOptions));

    this.server = http.createServer(this.app);
    this.io = null;
    this.redisConfig = null;
    this.redisClient = null;

    // Application state
    this.onlineCustomers = {}; // Map: customerId -> socketId
    this.onlineCaptains = {};  // Map: captainId -> socketId
    this.dispatchProcesses = new Map(); // Map: rideId -> cancelDispatchFunction
    this.rideSharingMap = new Map();   // Map: captainId -> customerId

    // Services
    this.customerSocketService = null;
    this.captainSocketService = null;
    this.dispatchService = null;
    this.systemService = null;
    this.chatService = null; // Chat service instance

    this.logger.info('[System] RideHailingApp instance created.');
  }

  async initialize() {
    try {
      // Initialize Redis
      await this.initializeRedis();

      // Setup Socket.IO
      this.setupSocketIO();

      // Setup middleware
      this.setupMiddleware();

      // Setup view engine
      this.setupViewEngine();

      // Setup routes
      this.setupRoutes();

      // Initialize services
      await this.initializeServices();

      // Setup error handling
      this.setupErrorHandling();

      // Initialize system settings
      await this.initializeSystemSettings();

      this.logger.info('[System] Application initialization complete.');

    } catch (error) {
      this.logger.error('[System] Failed to initialize application:', error);
      throw error;
    }
  }

  async initializeRedis() {
    this.redisConfig = new RedisConfig(this.logger);
    this.redisClient = await this.redisConfig.initialize();
    this.logger.info('[System] Redis configuration completed.');
  }

  setupSocketIO() {
    this.io = require("socket.io")(this.server, {
      transports: ["websocket"],
      cors: {
        origin: "*", // Consider restricting in production
        methods: ["GET", "POST"],
      },
    });
    this.logger.info('[System] Socket.IO server initialized.');
  }

  setupMiddleware() {
    setupMiddleware(this.app, this.logger);
  }

  setupViewEngine() {
    this.app.set("views", path.join(__dirname, "views"));
    this.app.set("view engine", "ejs");
    this.logger.info(`[System] View engine set to 'ejs' with views directory ${path.join(__dirname, "views")}`);
  }

  setupRoutes() {
    // Load main application routes
    this.app.use(require("./routes")); // Assumes ./routes defines view routes, etc.
    this.logger.info('[System] Loaded main application routes from ./routes.');
  }

  async initializeServices() {
    /* 1. حالة مشتركة واحدة */
    this.systemService = new SystemService(this.logger);
    await this.systemService.boot?.();     // إن كان لديه bootstrap اختياري

    // Initialize chat service
    this.chatService = new ChatService(this.logger, this.redisClient);
    this.logger.info('[System] Chat service initialized successfully.');

    const shared = {
      onlineCustomers: this.onlineCustomers,
      onlineCaptains: this.onlineCaptains,
      dispatchProcesses: this.dispatchProcesses,
      rideSharingMap: this.rideSharingMap,
      redisClient: this.redisClient,
      calculateDistance,
      chatService: this.chatService // Add chat service to shared dependencies
    };

    /* 2. أنشئ Dispatcher أولاً */
    this.dispatchService = new DispatchService(this.logger, shared);

    /* 3. وفّر الدالة بعد عمل bind للسياق */
    shared.dispatchRide = this.dispatchService.dispatchRide.bind(this.dispatchService);
    
    // *** KEY FIX: Add DispatchService reference to shared dependencies ***
    shared.dispatchService = this.dispatchService;

    /* 4. أنشئ خدمات السوكت بالدالة الجاهزة */
    this.customerSocketService = new CustomerSocketService(this.io, this.logger, shared);
    await this.customerSocketService.initialize();        // <- من الأفضل await
    shared.customerSocketService = this.customerSocketService;

    this.captainSocketService = new CaptainSocketService(this.io, this.logger, shared);
    await this.captainSocketService.initialize();

    /* 5. عرّف الخدمات داخل الـ dispatcher إذا كان يحتاجها */
    this.dispatchService.setSocketServices(
      this.captainSocketService,
      this.customerSocketService
    );

    // *** VERIFICATION: Double-check that DispatchService is properly injected ***
    if (this.captainSocketService.dispatchService) {
      this.logger.info('[System] ✅ Hide Ride Feature: ENABLED - DispatchService properly injected');
    } else {
      this.logger.warn('[System] ❌ Hide Ride Feature: DISABLED - DispatchService not injected');
    }

    /* 6. API + الخلفية */
    const apiRouter = createApiRoutes(this.logger, this.dispatchService, this.chatService);
    this.app.use("/api", apiRouter);

    // Initialize DispatchService after all socket services are ready
    await this.dispatchService.initialize();
    this.dispatchService.startBackgroundDispatcher();
    
    this.logger.info("[System] All services initialized successfully.");
  }

  setupErrorHandling() {
    setupErrorHandling(this.app, this.logger);
  }

  async initializeSystemSettings() {
    await this.systemService.initializeSystemSettings();
  }

  setupGracefulShutdown() {
    this.systemService.setupGracefulShutdown(this.server, this.io, this.redisClient);
  }

  async start() {
    const PORT = process.env.PORT || 5230;

    this.server.listen(PORT, () => {
      this.logger.info(`[System] Server listening on port ${PORT}`);
      
      // Log final service status
      this.logServiceStatus();
    });

    // Setup graceful shutdown
    this.setupGracefulShutdown();

    this.logger.info('[System] Application started successfully.');
  }

  // NEW: Method to log service status for debugging
  logServiceStatus() {
    this.logger.info('[System] Final Service Status:');
    this.logger.info(`- Online Captains: ${Object.keys(this.onlineCaptains).length}`);
    this.logger.info(`- Online Customers: ${Object.keys(this.onlineCustomers).length}`);
    this.logger.info(`- Active Dispatches: ${this.dispatchProcesses.size}`);
    this.logger.info(`- Active Ride Sharing: ${this.rideSharingMap.size}`);
    
    if (this.dispatchService) {
      const dispatchStats = this.dispatchService.getDispatchStats();
      this.logger.info(`- Dispatch Settings: Initial radius ${dispatchStats.settings.initialRadiusKm}km, Max radius ${dispatchStats.settings.maxRadiusKm}km`);
      this.logger.info(`- Active Notifications: ${dispatchStats.activeNotifications}`);
    }
    
    // Verify hide ride feature
    const hideRideEnabled = this.captainSocketService?.dispatchService ? 'ENABLED' : 'DISABLED';
    this.logger.info(`- Hide Ride Feature: ${hideRideEnabled}`);
  }
}

// Application entry point
async function main() {
  const app = new RideHailingApp();

  try {
    await app.initialize();
    await app.start();
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  main();
}

module.exports = RideHailingApp;