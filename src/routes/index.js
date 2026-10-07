const { initOIDCService, getOrCreateOIDCForTenant } = require('../services/oktaService');
const { createAuthRoutes } = require('./auth');
const { createSessionRoutes } = require('./session');
const { createHealthRoutes } = require('./health');
const { createApiRoutes } = require('./api');
const { createGraphRoutes } = require('./graph');
const { createConfigRoutes } = require('./config');
const { ensureAuthenticated } = require('../middleware/authentication');
const { initTenantResolver, captureTenantFromQuery, dynamicOIDCRouter, resolveTenant } = require('../middleware/tenantResolver');
const { setDynamicCSP } = require('../middleware/securityHeaders');
const { ROUTES } = require('../config/constants');
const { showDashboard } = require('../controllers/dashboardController');

function setupRoutes(app, config, logger) {
  // Initialize OIDC service with app config
  initOIDCService(config);

  // Initialize tenant resolver with app config
  initTenantResolver(config);

  // Capture tenant from query param early (before OIDC)
  app.use(captureTenantFromQuery(config));

  // Dynamic OIDC router (handles /login and /authorization-code/callback)
  app.use(dynamicOIDCRouter(config));

  // Health check (no auth)
  app.use(ROUTES.HEALTH, createHealthRoutes());

  // Resolve tenant for all other routes
  app.use(resolveTenant(config));

  // Set dynamic CSP based on tenant's S3 config
  app.use(setDynamicCSP());

  // Auth routes (logout) - needs tenant context
  app.use(createAuthRoutes(logger, config));

  // Sessions routes (new unified structure)
  app.use(ROUTES.SESSIONS.BASE, createSessionRoutes());

  // API routes
  app.use(ROUTES.API.BASE, createApiRoutes());

  // Graph routes (ReactFlow)
  app.use(ROUTES.GRAPH, createGraphRoutes());

  // Config routes
  app.use(ROUTES.CONFIG, createConfigRoutes());

  // Dashboard (home page)
  app.get(ROUTES.HOME, ensureAuthenticated, showDashboard);

  logger.info('Routes configured');
}

module.exports = { setupRoutes };
