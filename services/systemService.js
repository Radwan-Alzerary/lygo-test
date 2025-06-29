const SystemSetting = require("../model/systemSetting");

class SystemService {
  constructor(logger) {
    this.logger = logger;
  }

  async initializeSystemSettings() {
    try {
      const count = await SystemSetting.countDocuments();
      
      if (count === 0) {
        this.logger.warn("[DB] No SystemSetting document found. Creating default.");
        const systemSetting = new SystemSetting({
          name: "main",
          screenImg: "img/background.png",
          // Add other default settings: base_fare, price_per_km, etc.
          baseFare: 3000,
          pricePerKm: 500,
          currency: "IQD",
        });
        
        await systemSetting.save();
        this.logger.info("[DB] Default SystemSetting document created successfully.");
      } else {
        this.logger.info("[DB] SystemSetting document(s) found.");
      }
    } catch (err) {
      this.logger.error("[DB] Error checking or creating SystemSetting document:", err);
      throw err;
    }
  }

  setupGracefulShutdown(server, io, redisClient) {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        this.logger.warn(`[System] Received ${signal}. Shutting down gracefully...`);
        
        // 1. Stop accepting new connections
        server.close(async (err) => {
          if (err) {
            this.logger.error('[System] Error closing HTTP server:', err);
            process.exit(1);
          }
          this.logger.info('[System] HTTP server closed.');

          // 2. Close Socket.IO connections
          this.logger.info('[System] Closing Socket.IO connections...');
          io.close((err) => {
            if (err) {
              this.logger.error('[System] Error closing Socket.IO:', err);
            } else {
              this.logger.info('[System] Socket.IO connections closed.');
            }

            // 3. Close Redis connection
            this.logger.info('[System] Closing Redis connection...');
            redisClient.quit()
              .then(() => this.logger.info('[Redis] Redis client quit successfully.'))
              .catch(redisErr => this.logger.error('[Redis] Error quitting Redis client:', redisErr))
              .finally(() => {
                // 4. Close Database connection (if mongoose connection is accessible)
                // require('../config/database').closeConnection(); // Assuming you have a close function
                this.logger.info('[System] Database connection should be closed here if managed.');

                this.logger.info('[System] Graceful shutdown complete.');
                process.exit(0);
              });
          });
        });

        // Force shutdown after a timeout if graceful shutdown hangs
        setTimeout(() => {
          this.logger.error('[System] Graceful shutdown timed out. Forcing exit.');
          process.exit(1);
        }, 10000); // 10 seconds timeout
      });
    });
  }
}

module.exports = SystemService;