const express = require("express");
const path = require("path");
const cors = require("cors");
const morgan = require("morgan");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const flash = require("connect-flash");

const setupMiddleware = (app, logger) => {
  // CORS configuration
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
  };

  app.use(cors(corsOptions));
  logger.info('[System] CORS middleware configured.');

  app.use(compression());
  logger.info('[System] Compression middleware enabled.');

  // Morgan logging - Use 'tiny' or 'short' in production for less verbosity
  // Pipe Morgan output through Winston
  app.use(morgan('dev', { stream: { write: message => logger.info(`[HTTP] ${message.trim()}`) } }));
  logger.info('[System] Morgan HTTP logging middleware enabled (dev format).');

  app.use(express.static(path.join(__dirname, "..", "public")));
  logger.info(`[System] Serving static files from ${path.join(__dirname, "..", "public")}`);

  app.use(express.json()); // For parsing application/json
  logger.info('[System] Express JSON body parser middleware enabled.');

  app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
  logger.info('[System] Express URL-encoded body parser middleware enabled.');

  app.use(cookieParser());
  logger.info('[System] Cookie parser middleware enabled.');

  app.use(flash()); // For flash messages (often used with sessions/views)
  logger.info('[System] Connect-flash middleware enabled.');

  return app;
};

// Global Error Handling Middleware (Last Middleware)
const setupErrorHandling = (app, logger) => {
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
};

module.exports = {
  setupMiddleware,
  setupErrorHandling
};