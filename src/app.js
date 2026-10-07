const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const cookieParser = require('cookie-parser');
const { engine } = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const lusca = require('lusca');

const { setupSecurityHeaders } = require('./middleware/securityHeaders');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { setupRoutes } = require('./routes');
const { getPoolForSessionStore } = require('./services/databaseService');

function createApp(config, logger) {
  const app = express();

  // Set asset version for cache busting (available to all templates and controllers)
  const packageJson = require('../package.json');
  app.locals.assetVersion = packageJson.version;

  // Helper function for controllers to generate versioned asset URLs
  app.locals.assetUrl = (path) => `${path}?v=${app.locals.assetVersion}`;

  // Trust proxy in production (for secure cookies behind reverse proxy)
  if (config.app.isProduction) {
    app.set('trust proxy', 1);
  }

  // View engine setup
  app.engine('hbs', engine({
    extname: '.hbs',
    defaultLayout: 'main',
    layoutsDir: path.join(__dirname, 'views/layouts'),
    partialsDir: path.join(__dirname, 'views/partials'),
    helpers: {
      // Asset helper for cache busting - appends version query param
      asset: function(path) {
        const version = app.locals.assetVersion || '1.0.0';
        return new Handlebars.SafeString(`${path}?v=${version}`);
      },
      formatDate: (date) => {
        if (!date) return 'N/A';
        return new Date(date).toLocaleString();
      },
      formatDuration: (seconds) => {
        if (!seconds) return 'N/A';
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}m ${secs}s`;
      },
      formatSize: (bytes) => {
        if (!bytes) return 'N/A';
        const mb = bytes / (1024 * 1024);
        return `${mb.toFixed(2)} MB`;
      },
      eq: (a, b) => a === b,
      substring: (str, start, end) => {
        if (!str) return '';
        return String(str).substring(start, end).toUpperCase();
      },
      year: () => new Date().getFullYear(),
      // JSON stringify for safe embedding in script tags (handles undefined as null)
      json: (value) => JSON.stringify(value === undefined ? null : value),
    },
  }));
  app.set('view engine', 'hbs');
  app.set('views', path.join(__dirname, 'views'));

  // Security headers
  setupSecurityHeaders(app);

  // Cookie parsing (for persistent tenant selection)
  app.use(cookieParser());

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  // Static files
  app.use(express.static(path.join(__dirname, '../public')));

  // Session configuration
  const sessionConfig = {
    secret: config.app.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.app.isProduction,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  };

  // Use PostgreSQL session store in multi-tenant mode
  const pool = getPoolForSessionStore();
  if (pool) {
    sessionConfig.store = new pgSession({
      pool: pool,
      tableName: 'user_sessions',
      createTableIfMissing: true,
      pruneSessionInterval: 3600, // Prune expired sessions every hour
    });
  }

  app.use(session(sessionConfig));

  // CSRF protection middleware
  app.use(lusca.csrf({
    header: 'x-csrf-token',  // Check this header for token
  }));

  // Make user and app config available to all views
  app.use((req, res, next) => {
    res.locals.user = req.session?.passport?.user || null;
    res.locals.isAuthenticated = !!res.locals.user;
    res.locals.isMultitenant = config.app.isMultitenant;
    // Make CSRF token available to all views
    res.locals.csrfToken = req.csrfToken();
    next();
  });

  // Setup all routes (includes tenant resolution middleware)
  setupRoutes(app, config, logger);

  // 404 handler
  app.use(notFoundHandler);

  // Error handler
  app.use(errorHandler(logger));

  return app;
}

module.exports = { createApp };
