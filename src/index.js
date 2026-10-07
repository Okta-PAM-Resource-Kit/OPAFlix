require('dotenv').config();

const { getConfig } = require('./config/environment');
const { createLogger } = require('./config/logger');
const { createApp } = require('./app');
const sessionIndexService = require('./services/sessionIndexService');
const { initDatabase, ensureTables, closeDatabase, isDatabaseEnabled } = require('./services/databaseService');
const { initialize: initTenantConfig } = require('./services/tenantConfigService');

// Singleton for app instance and initialization
let appInstance = null;
let initPromise = null;
let appLogger = null;

/**
 * Initialize the application (database, services, Express app)
 * Returns the Express app instance
 */
async function initializeApp() {
  if (appInstance) return appInstance;

  // Load and validate configuration
  const config = getConfig();

  // Initialize logger
  appLogger = createLogger(config);

  const mode = config.app.isMultitenant ? 'multi-tenant' : 'single-tenant';
  appLogger.info(`Initializing Opaflix in ${mode} mode`, { env: config.app.nodeEnv });

  // Initialize database (only in multi-tenant mode)
  if (config.app.isMultitenant) {
    initDatabase(config);
    appLogger.info('Database connection pool initialized');

    // Ensure database tables exist (auto-migration)
    await ensureTables();
    appLogger.info('Database tables verified');
  } else {
    // Initialize database service in disabled mode
    initDatabase(config);
    appLogger.info('Database disabled (single-tenant mode)');
  }

  // Initialize tenant config service (handles both modes)
  initTenantConfig(config);

  // Initialize session index service
  sessionIndexService.initialize(config);

  // Create Express app
  appInstance = createApp(config, appLogger);

  // Store config in app for access in routes
  appInstance.set('config', config);

  appLogger.info('Application initialized successfully');

  return appInstance;
}

/**
 * Start the HTTP server (for local development)
 */
async function startServer() {
  try {
    const app = await initializeApp();
    const config = getConfig();

    const server = app.listen(config.app.port, () => {
      const mode = config.app.isMultitenant ? 'multi-tenant' : 'single-tenant';
      appLogger.info(`Server listening on port ${config.app.port}`, {
        baseUri: config.app.baseUri,
        port: config.app.port,
        mode,
      });
    });

    // Graceful shutdown
    const shutdown = async (signal) => {
      appLogger.info(`Received ${signal}, shutting down gracefully`);

      server.close(async (err) => {
        if (err) {
          appLogger.error('Error during server shutdown', { error: err.message });
          process.exit(1);
        }

        // Save session index
        try {
          await sessionIndexService.shutdown();
        } catch (err) {
          appLogger.error('Error saving session index', { error: err.message });
        }

        // Cleanup database connections (only if enabled)
        if (isDatabaseEnabled()) {
          try {
            await closeDatabase();
          } catch (err) {
            appLogger.error('Error closing database', { error: err.message });
          }
        }

        appLogger.info('Server shutdown complete');
        process.exit(0);
      });

      // Force exit after timeout
      setTimeout(() => {
        appLogger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 10000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (err) => {
      appLogger.error('Uncaught exception', { error: err.message, stack: err.stack });
      shutdown('uncaughtException');
    });

    process.on('unhandledRejection', (reason, promise) => {
      appLogger.error('Unhandled rejection', { reason, promise });
    });

  } catch (error) {
    const errorLogger = appLogger || console;
    errorLogger.error('Failed to start server', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Export handler for Vercel serverless
module.exports = async (req, res) => {
  if (!initPromise) {
    initPromise = initializeApp();
  }
  const app = await initPromise;
  return app(req, res);
};

// For local development: start HTTP server
if (require.main === module) {
  startServer();
}
