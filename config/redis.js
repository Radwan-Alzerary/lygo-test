const { createClient } = require("redis");

class RedisConfig {
  constructor(logger) {
    this.logger = logger;
    this.client = null;
  }

  async initialize() {
    this.client = createClient({
      url: process.env.REDIS_URL || "redis://127.0.0.1:6379",
    });

    // Setup event listeners
    this.client.on("error", (err) => {
      this.logger.error("[Redis] Redis Client Error:", err);
    });

    this.client.on('connect', () => {
      this.logger.info('[Redis] Client connecting...');
    });

    this.client.on('ready', () => {
      this.logger.info('[Redis] Client ready.');
    });

    this.client.on('reconnecting', () => {
      this.logger.warn('[Redis] Client reconnecting...');
    });

    this.client.on('end', () => {
      this.logger.warn('[Redis] Client connection ended.');
    });

    // Connect to Redis
    try {
      await this.client.connect();
      this.logger.info("[Redis] Successfully connected to Redis.");
      return this.client;
    } catch (err) {
      this.logger.error("[Redis] Failed to connect to Redis:", err);
      throw err;
    }
  }

  getClient() {
    return this.client;
  }

  async close() {
    if (this.client) {
      try {
        await this.client.quit();
        this.logger.info('[Redis] Redis client quit successfully.');
      } catch (err) {
        this.logger.error('[Redis] Error quitting Redis client:', err);
        throw err;
      }
    }
  }
}

module.exports = RedisConfig;