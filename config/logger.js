const winston = require('winston');
const { format } = winston;

const createLogger = () => {
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
  return logger;
};

module.exports = createLogger;