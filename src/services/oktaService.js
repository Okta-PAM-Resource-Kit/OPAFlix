const { ExpressOIDC } = require('@okta/oidc-middleware');
const { ROUTES } = require('../config/constants');
const { getLogger } = require('../config/logger');

const logger = getLogger();

// Map of OIDC instances per tenant: Map<teamName, ExpressOIDC>
const oidcInstances = new Map();

// Map of OIDC ready promises per tenant: Map<teamName, Promise<ExpressOIDC>>
const oidcReadyPromises = new Map();

// App config reference (set during init)
let appConfig = null;

/**
 * Initialize the OIDC service with app config
 */
function initOIDCService(config) {
  appConfig = config;
  logger.info('OIDC service initialized');
}

/**
 * Get or create OIDC instance for a specific tenant
 * Returns a promise that resolves when the OIDC instance is ready
 */
async function getOrCreateOIDCForTenant(tenantConfig) {
  const { teamName, okta } = tenantConfig;

  // Return existing ready promise if available
  if (oidcReadyPromises.has(teamName)) {
    return oidcReadyPromises.get(teamName);
  }

  if (!appConfig) {
    throw new Error('OIDC service not initialized. Call initOIDCService first.');
  }

  if (!okta?.issuer || !okta?.clientId || !okta?.clientSecret) {
    throw new Error(`Missing Okta configuration for tenant: ${teamName}`);
  }

  // Parse scopes - handle both string and array
  const scopes = typeof okta.scopes === 'string'
    ? okta.scopes
    : (okta.scopes || ['openid', 'profile', 'email']).join(' ');

  logger.info('Creating OIDC instance for tenant', { teamName, issuer: okta.issuer });

  const oidcInstance = new ExpressOIDC({
    issuer: okta.issuer,
    client_id: okta.clientId,
    client_secret: okta.clientSecret,
    appBaseUrl: appConfig.app.baseUri,
    scope: scopes,
    routes: {
      login: {
        path: ROUTES.LOGIN,
      },
      loginCallback: {
        path: ROUTES.CALLBACK,
        afterCallback: '/auth/redirect',
      },
    },
    sessionKey: 'oidc:session',
    tokenIntrospection: false,
  });

  // Create promise that resolves when OIDC is ready
  const readyPromise = new Promise((resolve, reject) => {
    oidcInstance.on('ready', () => {
      logger.info('OIDC middleware ready for tenant', { teamName });
      resolve(oidcInstance);
    });

    oidcInstance.on('error', (err) => {
      logger.error('OIDC error for tenant', { teamName, error: err.message });
      reject(err);
    });
  });

  oidcInstances.set(teamName, oidcInstance);
  oidcReadyPromises.set(teamName, readyPromise);

  return readyPromise;
}

/**
 * Get OIDC instance for a tenant (without creating)
 */
function getOIDCForTenant(teamName) {
  return oidcInstances.get(teamName);
}

/**
 * Check if OIDC exists for tenant
 */
function hasOIDCForTenant(teamName) {
  return oidcInstances.has(teamName);
}

function getUserFromSession(req) {
  return req.session?.passport?.user || null;
}

function isTokenExpired(user) {
  if (!user?.expires_at) return true;
  // Check if token expires in less than 5 minutes
  const expiresAt = user.expires_at * 1000; // Convert to milliseconds
  const buffer = 5 * 60 * 1000; // 5 minutes
  return Date.now() > expiresAt - buffer;
}

module.exports = {
  initOIDCService,
  getOrCreateOIDCForTenant,
  getOIDCForTenant,
  hasOIDCForTenant,
  getUserFromSession,
  isTokenExpired,
};
