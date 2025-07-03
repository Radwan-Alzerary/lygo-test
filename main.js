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

// Import API routes
const createApiRoutes = require("./routes/api");

class RideHailingApp {
  constructor() {
    this.logger = createLogger();
    this.app = express();
        // ←── add CORS here ────────────────────────────────────────
    this.app.use(cors({
      origin: "https://api.lygo-iq.com",
      methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
      allowedHeaders: ["Content-Type","Authorization"],
      credentials: true
    }));
    this.app.options("*", cors());
    // ─────────────────────────────────────────────────────────

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

    const shared = {
      onlineCustomers: this.onlineCustomers,
      onlineCaptains: this.onlineCaptains,
      dispatchProcesses: this.dispatchProcesses,
      rideSharingMap: this.rideSharingMap,
      redisClient: this.redisClient,
      calculateDistance
    };

    /* 2. أنشئ Dispatcher أولاً */
    this.dispatchService = new DispatchService(this.logger, shared);

    /* 3. وفّر الدالة بعد عمل bind للسياق */
    shared.dispatchRide = this.dispatchService.dispatchRide.bind(this.dispatchService);

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

    /* 6. API + الخلفية */
    const apiRouter = createApiRoutes(this.logger, this.dispatchService);
    this.app.use("/api", apiRouter);

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
    });

    // Setup graceful shutdown
    this.setupGracefulShutdown();

    this.logger.info('[System] Application started successfully.');
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