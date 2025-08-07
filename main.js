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
const PaymentService = require("./services/paymentService"); // Payment service
const StateManagementService = require("./services/stateManagementService"); // State management service
const LocationTrackingService = require("./services/locationTrackingService"); // Location tracking service
const AdminSocketService = require("./services/adminSocketService"); // Admin socket service

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
    this.paymentService = null; // Payment service instance
    this.stateManagementService = null; // State management service instance
    this.locationTrackingService = null; // Location tracking service instance
    this.adminSocketService = null; // Admin socket service instance

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

      // Initialize services first
      await this.initializeServices();

      // Setup routes after services are initialized
      this.setupRoutes();

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
    // Add middleware to inject services into request context
    this.app.use((req, res, next) => {
      req.paymentService = this.paymentService;
      req.chatService = this.chatService;
      req.financialAccountService = this.financialAccountService;
      req.stateManagementService = this.stateManagementService;
      next();
    });

    // Add services to app.locals for API access
    this.app.locals.locationTrackingService = this.locationTrackingService;
    this.app.locals.adminSocketService = this.adminSocketService;

    // Load main application routes
    this.app.use(require("./routes")); // Assumes ./routes defines view routes, etc.
    this.logger.info('[System] Loaded main application routes from ./routes with service injection.');
  }

  async initializeServices() {
    /* 1. حالة مشتركة واحدة */
    this.systemService = new SystemService(this.logger);
    await this.systemService.boot?.();     // إن كان لديه bootstrap اختياري

    // Initialize chat service
    this.chatService = new ChatService(this.logger, this.redisClient);
    this.logger.info('[System] Chat service initialized successfully.');

    // Initialize payment service
    this.paymentService = new PaymentService(this.logger, this.redisClient);
    this.logger.info('[System] Payment service initialized successfully.');

    // Initialize financial account service
    const FinancialAccountService = require('./services/financialAccountService');
    this.financialAccountService = new FinancialAccountService(this.logger);
    this.logger.info('[System] Financial account service initialized successfully.');

    // Initialize main vault system
    try {
      const vaultInit = await this.financialAccountService.initializeMainVaultSystem();
      if (vaultInit.created) {
        this.logger.info('[System] 🏦 Main vault system created successfully');
      } else {
        this.logger.info('[System] 🏦 Main vault system already operational');
      }
      this.logger.info(`[System] 💰 Main vault balance: ${vaultInit.balance} IQD`);
    } catch (error) {
      this.logger.warn('[System] ⚠️  Main vault initialization warning:', error.message);
      this.logger.info('[System] 🔄 Main vault will be created when first needed');
    }

    // Initialize state management service
    this.stateManagementService = new StateManagementService(this.logger, this.redisClient);
    this.logger.info('[System] State management service initialized successfully.');

    // Initialize location tracking service
    this.locationTrackingService = new LocationTrackingService(this.logger, this.redisClient);
    this.logger.info('[System] Location tracking service initialized successfully.');

    const shared = {
      onlineCustomers: this.onlineCustomers,
      onlineCaptains: this.onlineCaptains,
      dispatchProcesses: this.dispatchProcesses,
      rideSharingMap: this.rideSharingMap,
      redisClient: this.redisClient,
      calculateDistance,
      chatService: this.chatService, // Add chat service to shared dependencies
      paymentService: this.paymentService, // Add payment service to shared dependencies
      financialAccountService: this.financialAccountService, // Add financial account service to shared dependencies
      stateManagementService: this.stateManagementService, // Add state management service to shared dependencies
      locationTrackingService: this.locationTrackingService // Add location tracking service to shared dependencies
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

    // Initialize admin socket service for location tracking
    this.adminSocketService = new AdminSocketService(this.io, this.logger, shared);
    await this.adminSocketService.initialize();
    this.logger.info('[System] Admin socket service initialized successfully.');

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
    const apiRouter = createApiRoutes(this.logger, this.dispatchService, this.chatService, this.paymentService, this.stateManagementService);
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
    
    // Chat system status
    const chatEnabled = this.chatService ? 'ENABLED' : 'DISABLED';
    this.logger.info(`- Chat System: ${chatEnabled}`);
    
    // Payment system status
    const paymentEnabled = this.paymentService ? 'ENABLED' : 'DISABLED';
    this.logger.info(`- Payment System: ${paymentEnabled}`);
    
    // Main Vault System status
    if (this.paymentService) {
      this.logger.info(`- Main Vault System: ENABLED`);
      this.logMainVaultStatus();
    }
    
    if (this.chatService) {
      this.logger.info('  ✅ Chat features available:');
      this.logger.info('    - Real-time messaging');
      this.logger.info('    - Quick messages (Customer: 5, Driver: 6)');
      this.logger.info('    - Typing indicators');
      this.logger.info('    - Message read receipts');
      this.logger.info('    - Chat history & Redis caching');
      this.logger.info('    - Rate limiting (30 msg/min)');
    }

    if (this.paymentService) {
      this.logger.info('  ✅ Payment features available:');
      this.logger.info('    - POST /api/rides/payment/ (Captain payment submission)');
      this.logger.info('    - GET /api/rides/payments/history (Payment history)');
      this.logger.info('    - GET /api/rides/payments/stats (Payment statistics)');
      this.logger.info('    - GET /api/vault/stats (Main vault statistics - Admin only)');
      this.logger.info('    - GET /api/vault/balance (Main vault balance - Admin only)');
      this.logger.info('    - Socket: submitPayment (New captain payment flow)');
      this.logger.info('    - Socket: vault_deduction (Main vault deduction notifications)');
      this.logger.info('    - Ride state: awaiting_payment supported');
      this.logger.info('    - Automatic commission calculation (15%)');
      this.logger.info('    - Main vault deduction (20% on ride acceptance)');
      this.logger.info('    - Captain earnings tracking');
      this.logger.info('    - Extra amount transfer (Captain -> Customer)');
      this.logger.info('    - Commission transfer (Captain -> Admin)');
      this.logger.info('    - Main vault transfer (Captain -> System)');
      this.logger.info('    - Payment dispute handling');
    }

    // State management system status
    const stateManagementEnabled = this.stateManagementService ? 'ENABLED' : 'DISABLED';
    this.logger.info(`- State Management System: ${stateManagementEnabled}`);
    
    // Location tracking system status
    const locationTrackingEnabled = this.locationTrackingService ? 'ENABLED' : 'DISABLED';
    this.logger.info(`- Location Tracking System: ${locationTrackingEnabled}`);
    
    if (this.locationTrackingService) {
      const trackingStats = this.locationTrackingService.getTrackingStats();
      this.logger.info('  📍 Location tracking features available:');
      this.logger.info(`    - Active tracking sessions: ${trackingStats.activeSessions}`);
      this.logger.info(`    - Tracked captains: ${trackingStats.trackedCaptains}`);
      this.logger.info('    - Real-time captain location monitoring');
      this.logger.info('    - Admin location tracking dashboard');
      this.logger.info('    - Socket namespace: /admin for tracking connections');
    }

    // Admin socket system status
    const adminSocketEnabled = this.adminSocketService ? 'ENABLED' : 'DISABLED';
    this.logger.info(`- Admin Socket System: ${adminSocketEnabled}`);
    
    if (this.adminSocketService) {
      const adminStats = this.adminSocketService.getAdminStats();
      this.logger.info('  👨‍💼 Admin socket features available:');
      this.logger.info(`    - Connected admins: ${adminStats.totalConnected}`);
      this.logger.info(`    - Active tracking sessions: ${adminStats.tracking}`);
      this.logger.info('    - Real-time location broadcasting');
      this.logger.info('    - JWT authentication for admin connections');
      this.logger.info('    - Role-based access control');
    }
    
    if (this.stateManagementService) {
      this.logger.info('  ✅ State management features available:');
      this.logger.info('    - Ride state backup/restore');
      this.logger.info('    - Trip planning backup/restore');
      this.logger.info('    - Automatic state cleanup (every 6 hours)');
      this.logger.info('    - Redis caching for quick access');
      this.logger.info('    - Promo code validation');
      this.logger.info('    - Active ride restoration');
    }
  }

  // NEW: Method to log main vault status
  async logMainVaultStatus() {
    try {
      if (this.paymentService && this.paymentService.getMainVaultStats) {
        const vaultStats = await this.paymentService.getMainVaultStats();
        this.logger.info('  🏦 Main Vault Status:');
        this.logger.info(`    - Current Balance: ${vaultStats.balance} ${vaultStats.currency}`);
        this.logger.info(`    - Deduction Rate: ${(vaultStats.deductionRate * 100).toFixed(1)}% (from ride settings)`);
        this.logger.info(`    - Vault Enabled: ${vaultStats.enabled ? 'YES' : 'NO'}`);
        this.logger.info(`    - Total Deductions: ${vaultStats.totalDeductions} ${vaultStats.currency} (${vaultStats.totalTransactions} transactions)`);
        this.logger.info(`    - Today's Deductions: ${vaultStats.dailyDeductions} ${vaultStats.currency} (${vaultStats.dailyTransactions} transactions)`);
        this.logger.info(`    - Status: OPERATIONAL ✅`);
      } else {
        this.logger.info('  🏦 Main Vault Status: INITIALIZING...');
      }
    } catch (error) {
      this.logger.warn('  🏦 Main Vault Status: ERROR - Will be created when needed');
      this.logger.debug('Main vault error details:', error.message);
    }
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