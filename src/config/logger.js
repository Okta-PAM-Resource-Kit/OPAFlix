const winston = require('winston');

let logger = null;

function createLogger(config) {
  if (logger) {
    return logger;
  }

  const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    config.app.isProduction
      ? winston.format.json()
      : winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      )
  );

  logger = winston.createLogger({
    level: config.logging.level,
    format: logFormat,
    defaultMeta: { service: 'opaflix' },
    transports: [
      new winston.transports.Console({
        handleExceptions: true,
      }),
    ],
    exitOnError: false,
  });

  return logger;
}

function getLogger() {
  if (!logger) {
    // Create a basic logger if not initialized
    logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      transports: [new winston.transports.Console()],
    });
  }
  return logger;
}

module.exports = { createLogger, getLogger };
