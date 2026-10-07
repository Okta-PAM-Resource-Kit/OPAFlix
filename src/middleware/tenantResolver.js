/**
 * Tenant Resolver Middleware
 *
 * Extracts tenant URL and team name from query params or session, loads tenant config,
 * and attaches tenant context to the request.
 *
 * Architecture (simplified tenant URL-based):
 * - URL parameters: ?tenant=demo-blue-sky-1234.pam.okta.com&team=blue-sky
 * - The (tenant_url, team_name) combination uniquely identifies a tenant
 * - Preview status is derived from the URL (oktapreview.com vs okta.com)
 * - No more ?preview= parameter needed
 *
 * Supports two modes:
 * - Multi-tenant: Requires ?tenant= and ?team= parameters or cookie/session
 * - Single-tenant: Uses config from environment variables, no parameters needed
 */

const { loadTeamConfig, getSingleTenantConfig, isSingleTenantMode } = require('../services/tenantConfigService');
const { getOrCreateOIDCForTenant } = require('../services/oktaService');
const { getLogger } = require('../config/logger');

const logger = getLogger();

// App config reference
let appConfig = null;

/**
 * Initialize tenant resolver with app config
 */
function initTenantResolver(config) {
  appConfig = config;
}

/**
 * Routes that don't require full tenant resolution (but may need tenant for OIDC)
 */
const EXCLUDED_ROUTES = [
  '/health',
];

/**
 * Static file patterns that should skip tenant resolution
 * These are paths that typically serve static assets
 */
const STATIC_FILE_PATTERNS = [
  /^\/favicon\./,      // /favicon.ico, /favicon.svg, /favicon.png
  /^\/robots\.txt$/,   // /robots.txt
  /^\/sitemap\.xml$/,  // /sitemap.xml
  /^\/css\//,          // /css/*
  /^\/js\//,           // /js/*
  /^\/img\//,          // /img/*
  /^\/images\//,       // /images/*
  /^\/fonts\//,        // /fonts/*
  /^\/assets\//,       // /assets/*
  /\.(ico|png|jpg|jpeg|gif|svg|webp|woff|woff2|ttf|eot|css|js|map)$/i,  // Common static file extensions
];

/**
 * Routes that need tenant-specific OIDC
 */
const OIDC_ROUTES = [
  '/login',
  '/authorization-code',
];

/**
 * Routes that skip tenant config validation (but still resolve tenant)
 * Used for pages that need to work with incomplete configurations
 */
const SKIP_VALIDATION_ROUTES = [
  '/config',
];

/**
 * Check if route should skip tenant resolution entirely
 */
function shouldSkipTenantResolution(path) {
  // Check excluded routes
  if (EXCLUDED_ROUTES.some(route => path === route || path.startsWith(route + '/'))) {
    return true;
  }
  // Check static file patterns
  if (STATIC_FILE_PATTERNS.some(pattern => pattern.test(path))) {
    return true;
  }
  return false;
}

/**
 * Check if route is an OIDC route
 */
function isOIDCRoute(path) {
  return OIDC_ROUTES.some(route => path === route || path.startsWith(route + '/'));
}

/**
 * Check if route should skip tenant config validation
 */
function shouldSkipValidation(path) {
  return SKIP_VALIDATION_ROUTES.some(route => path === route || path.startsWith(route + '/'));
}

/**
 * Early middleware to capture tenant URL and team name from query params before OIDC
 * This runs BEFORE OIDC and stores values in cookies and session
 *
 * In single-tenant mode, this is a no-op (config comes from environment)
 * In multi-tenant mode:
 * - Always sets cookies when query params present (cookies don't create DB entries)
 * - Only writes to session if BOTH tenant AND team are set (avoids creating
 *   DB session entries for bots, crawlers, and visitors without full context)
 *
 * URL format: ?tenant=demo-blue-sky-1234.pam.okta.com&team=blue-sky
 */
function captureTenantFromQuery(config) {
  return (req, res, next) => {
    // Single-tenant mode: no need to capture from query
    if (!config.app.isMultitenant) {
      return next();
    }

    // Collect tenant/team from query params and cookies into local variables
    // Priority: query params > cookies
    const tenantUrl = req.query.tenant || req.cookies?.selectedTenant;
    const teamName = req.query.team || req.cookies?.selectedTeam;

    // Set cookies if from query params (cookies are cheap, no DB cost)
    if (req.query.tenant) {
      res.cookie('selectedTenant', req.query.tenant, {
        maxAge: 365 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: config.app.isProduction,
        sameSite: 'lax'
      });
      logger.debug('Set tenant cookie from query', { tenant: req.query.tenant, path: req.path });
    }

    if (req.query.team) {
      res.cookie('selectedTeam', req.query.team, {
        maxAge: 365 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: config.app.isProduction,
        sameSite: 'lax'
      });
      logger.debug('Set team cookie from query', { team: req.query.team, path: req.path });
    }

    // Only write to session if BOTH tenant AND team are set
    // This prevents creating DB session entries for random visitors without full context
    if (tenantUrl && teamName) {
      req.session.selectedTenant = tenantUrl;
      req.session.selectedTeam = teamName;
      logger.debug('Stored tenant/team in session', { tenantUrl, teamName, path: req.path });
    }

    next();
  };
}

/**
 * Dynamic OIDC router middleware
 * Routes OIDC requests to the appropriate tenant's OIDC instance
 */
function dynamicOIDCRouter(config) {
  return async (req, res, next) => {
    // Only handle OIDC routes
    if (!isOIDCRoute(req.path)) {
      return next();
    }

    // Check for OAuth errors in the callback URL before OIDC middleware processes it
    // This provides user-friendly error messages instead of generic "Unauthorized"
    if (req.path === '/authorization-code/callback' && req.query.error) {
      // Normalize query params to strings (prevent type confusion if arrays are passed)
      const errorCode = Array.isArray(req.query.error)
        ? req.query.error[0]
        : req.query.error;
      const errorDescription = Array.isArray(req.query.error_description)
        ? req.query.error_description[0]
        : (req.query.error_description || 'Authentication failed');

      logger.warn('OAuth callback error', {
        error: errorCode,
        description: errorDescription,
        path: req.path,
      });

      // Map common OAuth errors to user-friendly messages
      let userMessage = errorDescription;
      let title = 'Authentication Failed';

      if (errorCode === 'access_denied') {
        title = 'Access Denied';
        if (errorDescription.includes('not assigned')) {
          userMessage = `${errorDescription} Please contact your administrator to request access.`;
        }
      } else if (errorCode === 'invalid_scope') {
        title = 'Invalid Configuration';
        userMessage = `${errorDescription} The application requested invalid permissions.\n\nPlease contact your administrator.`;
      } else if (errorCode === 'server_error') {
        title = 'Server Error';
        userMessage = `${errorDescription} The authentication server encountered an error.\n\nPlease try again later.`;
      }

      return res.status(403).render('error', {
        title,
        status: 403,
        message: userMessage,
        code: errorCode,
        showLogin: true,
      });
    }

    try {
      let tenantConfig;

      // Single-tenant mode: use config from environment
      if (!config.app.isMultitenant) {
        tenantConfig = getSingleTenantConfig();
        if (!tenantConfig) {
          logger.error('Single-tenant config not available');
          return res.status(500).render('error', {
            title: 'Configuration Error',
            statusCode: 500,
            message: 'Application not configured.\n\nPlease check environment variables.',
            showLogin: false,
          });
        }
      } else {
        // Multi-tenant mode: from session or cookies (cookies as fallback for OIDC flow)
        const tenantUrl = req.session?.selectedTenant || req.cookies?.selectedTenant;
        const teamName = req.session?.selectedTeam || req.cookies?.selectedTeam;

        if (!tenantUrl || !teamName) {
          logger.warn('No tenant/team for OIDC route', { path: req.path, tenantUrl, teamName });
          return res.status(400).render('teamSelect', {
            title: 'Select Team',
            layout: false,
          });
        }

        // Load team config to get OIDC settings
        tenantConfig = await loadTeamConfig(tenantUrl, teamName);
      }

      // Get or create OIDC instance for this tenant (await ready state)
      const oidc = await getOrCreateOIDCForTenant(tenantConfig);

      // Store tenant info in session for after callback (only in multi-tenant mode)
      if (config.app.isMultitenant) {
        req.session.oidcTenantUrl = tenantConfig.tenantUrl;
        req.session.oidcTeamName = tenantConfig.teamName;
      }

      // Route to the OIDC instance's router
      return oidc.router(req, res, next);

    } catch (error) {
      logger.error('Failed to handle OIDC route', {
        error: error.message,
        path: req.path,
        tenantUrl: req.session?.selectedTenant,
        teamName: req.session?.selectedTeam,
        isMultitenant: config.app.isMultitenant,
      });

      const errorMessage = config.app.isMultitenant
        ? 'Failed to initialize authentication.\n\nPlease try again.'
        : 'Application configuration error.\n\nPlease check environment variables.';

      return res.status(500).render('error', {
        title: 'Authentication Error',
        statusCode: 500,
        message: errorMessage,
        showLogin: false,
      });
    }
  };
}

/**
 * Middleware to resolve and attach tenant context to request
 * This runs AFTER authentication for protected routes
 */
function resolveTenant(config) {
  return async (req, res, next) => {
    try {
      // Skip for excluded routes
      if (shouldSkipTenantResolution(req.path)) {
        return next();
      }

      // Skip for OIDC routes (handled by dynamicOIDCRouter)
      if (isOIDCRoute(req.path)) {
        return next();
      }

      let tenantConfig;

      // Single-tenant mode: use config from environment directly
      if (!config.app.isMultitenant) {
        tenantConfig = getSingleTenantConfig();
        if (!tenantConfig) {
          logger.error('Single-tenant config not available');
          return res.status(500).render('error', {
            title: 'Configuration Error',
            statusCode: 500,
            message: 'Application not configured.\n\nPlease check environment variables.',
            showLogin: false,
          });
        }

        // Attach tenant context to request
        req.tenantContext = {
          tenantId: tenantConfig.tenantId,
          tenantUrl: tenantConfig.tenantUrl,
          teamName: tenantConfig.teamName,
          config: tenantConfig,
        };

        // No res.locals.tenant in single-tenant mode (no team selector needed)
        return next();
      }

      // Multi-tenant mode: resolve tenant URL and team from query > cookie > session
      const tenantUrl = req.query.tenant || req.cookies?.selectedTenant || req.session?.selectedTenant;
      const teamName = req.query.team || req.cookies?.selectedTeam || req.session?.selectedTeam;

      if (!tenantUrl || !teamName) {
        // No tenant/team selected - show team selection page
        logger.info('No tenant/team specified in request', {
          path: req.path,
          ip: req.ip,
          userId: req.user?.email,
          tenantUrl,
          teamName,
        });

        return res.status(400).render('teamSelect', {
          title: 'Select Team',
          layout: false,
        });
      }

      // Load team config from database using (tenantUrl, teamName) as key
      // Skip validation for config page so users can view/edit incomplete configs
      const skipValidation = shouldSkipValidation(req.path);
      tenantConfig = await loadTeamConfig(tenantUrl, teamName, { skipValidation });

      // Store in session and cookie if from query param
      if (req.query.tenant && req.query.tenant !== req.session?.selectedTenant) {
        req.session.selectedTenant = tenantUrl;
        // Set persistent cookie (1 year)
        res.cookie('selectedTenant', tenantUrl, {
          maxAge: 365 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          secure: config.app.isProduction,
          sameSite: 'lax'
        });
      }
      if (req.query.team && req.query.team !== req.session?.selectedTeam) {
        req.session.selectedTeam = teamName;
        res.cookie('selectedTeam', teamName, {
          maxAge: 365 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          secure: config.app.isProduction,
          sameSite: 'lax'
        });
        logger.info('Team selected', {
          tenantUrl,
          teamName,
          userId: req.user?.email,
          tenantId: tenantConfig.tenantId,
        });
      }

      // Attach tenant context to request
      req.tenantContext = {
        tenantId: tenantConfig.tenantId,
        tenantUrl: tenantConfig.tenantUrl,
        teamName: tenantConfig.teamName,
        config: tenantConfig,
      };

      // Make tenant info available in views (only in multi-tenant mode)
      res.locals.tenant = {
        tenantUrl: tenantConfig.tenantUrl,
        teamName: tenantConfig.teamName,
      };

      next();
    } catch (error) {
      logger.error('Failed to resolve tenant', {
        error: error.message,
        tenantUrl: req.query.tenant || req.cookies?.selectedTenant || req.session?.selectedTenant,
        teamName: req.query.team || req.cookies?.selectedTeam || req.session?.selectedTeam,
        path: req.path,
        isMultitenant: config.app.isMultitenant,
      });

      // Determine appropriate error message
      let message;
      const requestedTenant = req.query.tenant || req.cookies?.selectedTenant || req.session?.selectedTenant;
      const requestedTeam = req.query.team || req.cookies?.selectedTeam || req.session?.selectedTeam;

      // Determine if we should show the config button
      let showConfigButton = false;
      let configUrl = '/config';

      if (!config.app.isMultitenant) {
        // Single-tenant mode error messages
        if (error.message.includes('not found')) {
          message = 'Application configuration not found.\n\nPlease check environment variables.';
        } else if (error.message.includes('Missing required config')) {
          message = 'Application configuration is incomplete.\n\nPlease check environment variables.';
          showConfigButton = true;
        } else {
          message = 'Application configuration error.\n\nPlease contact your administrator.';
        }
      } else {
        // Multi-tenant mode error messages
        configUrl = `/config?tenant=${encodeURIComponent(requestedTenant || '')}&team=${encodeURIComponent(requestedTeam || '')}`;
        if (error.message.includes('Tenant not found')) {
          message = `Tenant "${requestedTenant}" not found.\n\nPlease check the tenant URL and try again.`;
          // Clear invalid tenant from session and cookies so user can try again
          delete req.session.selectedTenant;
          delete req.session.selectedTeam;
          res.clearCookie('selectedTenant');
          res.clearCookie('selectedTeam');
        } else if (error.message.includes('Team not found')) {
          message = `Team "${requestedTeam}" not found in tenant "${requestedTenant}".\n\nPlease check the team name and try again.`;
          // Clear only the team
          delete req.session.selectedTeam;
          res.clearCookie('selectedTeam');
        } else if (error.message.includes('inactive')) {
          message = 'This tenant or team is currently inactive.\n\nPlease contact your administrator.';
        } else if (error.message.includes('Missing required config')) {
          message = 'Team configuration is incomplete.\n\nPlease configure it.';
          showConfigButton = true;
        } else {
          message = 'Invalid or inactive tenant/team';
        }
      }

      return res.status(400).render('error', {
        title: config.app.isMultitenant ? 'Team Error' : 'Configuration Error',
        statusCode: 400,
        message,
        showLogin: false,
        showConfigButton,
        configUrl,
      });
    }
  };
}

module.exports = {
  initTenantResolver,
  captureTenantFromQuery,
  dynamicOIDCRouter,
  resolveTenant,
};
