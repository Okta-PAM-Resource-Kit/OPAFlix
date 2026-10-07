/**
 * Tenant Config Service
 *
 * Handles tenant configuration loading and caching.
 * In single-tenant mode, returns config from environment variables.
 * In multi-tenant mode, loads from database with caching.
 *
 * Simplified tenant URL-based architecture:
 * - Tenants are identified by (tenant_url, team_name) combination
 * - Single tenants table with unique key on (tenant_url, team_name)
 * - Preview status is derived from the URL (contains "oktapreview.com")
 */

const { isDatabaseEnabled, query } = require('./databaseService');
const { getLogger } = require('../config/logger');

const logger = getLogger();

// In-memory cache: Map<cacheKey, { config, expiresAt }>
// Cache key format: "tenantUrl:teamName"
const configCache = new Map();
let cacheTtlMs = 5 * 60 * 1000; // Default 5 minutes

// Single-tenant config from environment
let singleTenantConfig = null;

/**
 * Generate cache key for team config
 * @param {string} tenantUrl - OPA tenant URL (e.g., "demo-blue-sky-1234.pam.okta.com")
 * @param {string} teamName - Team name within the tenant
 * @returns {string} Cache key
 */
function getCacheKey(tenantUrl, teamName) {
  return `${tenantUrl}:${teamName}`;
}

/**
 * Initialize tenant config service
 * @param {Object} appConfig - Application configuration
 */
function initialize(appConfig) {
  cacheTtlMs = (appConfig.configCacheTtlMinutes || 5) * 60 * 1000;

  // Store single-tenant config if provided
  if (appConfig.singleTenantConfig) {
    singleTenantConfig = appConfig.singleTenantConfig;
    logger.info('Tenant config service initialized (single-tenant mode)', {
      tenantUrl: singleTenantConfig.tenantUrl,
      teamName: singleTenantConfig.teamName,
    });
  } else {
    logger.info('Tenant config cache initialized (multi-tenant mode)', {
      ttlMinutes: appConfig.configCacheTtlMinutes || 5,
    });
  }
}

// Alias for backward compatibility
function initCache(appConfig) {
  initialize(appConfig);
}

/**
 * Get tenant by URL and team name (single query in simplified schema)
 * @param {string} tenantUrl - OPA tenant URL (e.g., "demo-blue-sky-1234.pam.okta.com")
 * @param {string} teamName - Team name within the tenant
 * @returns {Promise<Object|null>} Tenant record or null if not found
 */
async function getTenantByUrlAndTeam(tenantUrl, teamName) {
  if (!isDatabaseEnabled()) {
    // Single-tenant mode - return synthetic tenant if matches
    if (singleTenantConfig &&
        singleTenantConfig.tenantUrl === tenantUrl &&
        singleTenantConfig.teamName === teamName) {
      return {
        id: singleTenantConfig.tenantId,
        tenant_url: singleTenantConfig.tenantUrl,
        team_name: singleTenantConfig.teamName,
        is_active: true,
      };
    }
    return null;
  }

  const result = await query(
    'SELECT id, tenant_url, team_name, is_active FROM tenants WHERE tenant_url = $1 AND team_name = $2',
    [tenantUrl, teamName]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

/**
 * Get all tenant configurations from tenant_configs table
 * @param {string} tenantId - Tenant UUID
 * @returns {Promise<Object>} Nested config object
 */
async function getTenantConfig(tenantId) {
  if (!isDatabaseEnabled()) {
    throw new Error('getTenantConfig called in single-tenant mode');
  }

  const result = await query(
    'SELECT config_key, config_value FROM tenant_configs WHERE tenant_id = $1',
    [tenantId]
  );

  // Build nested config object from dot-notation keys
  const config = {};
  for (const row of result.rows) {
    const keys = row.config_key.split('.');
    let current = config;

    for (let i = 0; i < keys.length - 1; i++) {
      if (!current[keys[i]]) current[keys[i]] = {};
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = row.config_value;
  }

  return config;
}

/**
 * Validate tenant config has required fields
 *
 * AWS credentials are conditional:
 * - If Roles Anywhere is configured (trustAnchorArn + profileArn + certificate + privateKey), no static keys needed
 * - Otherwise, accessKeyId and secretAccessKey are required
 */
function validateTenantConfig(config, tenantUrl, teamName) {
  // Always required fields
  const required = [
    'okta.issuer',
    'okta.clientId',
    'okta.clientSecret',
    'aws.region',
    'aws.bucket',
  ];

  for (const key of required) {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value?.[k];
    }
    if (!value) {
      throw new Error(`Missing required config: ${key} for team ${teamName} (tenant: ${tenantUrl})`);
    }
  }

  // Check AWS authentication - either Roles Anywhere OR static credentials
  const hasRolesAnywhere = config.aws?.rolesAnywhereTrustAnchorArn &&
                           config.aws?.rolesAnywhereProfileArn &&
                           config.aws?.rolesAnywhereCertificate &&
                           config.aws?.rolesAnywherePrivateKey;

  const hasStaticCredentials = config.aws?.accessKeyId && config.aws?.secretAccessKey;

  if (!hasRolesAnywhere && !hasStaticCredentials) {
    throw new Error(
      `Missing AWS credentials for team ${teamName} (tenant: ${tenantUrl}). ` +
      'Provide either IAM Roles Anywhere configuration (trustAnchorArn, profileArn, certificate, privateKey) ' +
      'or static credentials (accessKeyId, secretAccessKey).'
    );
  }
}

/**
 * Load tenant configuration with caching
 * @param {string} tenantUrl - OPA tenant URL (e.g., "demo-blue-sky-1234.pam.okta.com")
 * @param {string} teamName - Team name within the tenant
 * @param {Object} options - Additional options
 * @param {boolean} options.skipValidation - Skip config validation (for config page)
 * @returns {Promise<Object>} Tenant configuration
 */
async function loadTeamConfig(tenantUrl, teamName, options = {}) {
  // Single-tenant mode: return config from environment
  if (!isDatabaseEnabled()) {
    if (!singleTenantConfig) {
      throw new Error('Single-tenant configuration not initialized');
    }
    logger.debug('Returning single-tenant config from environment');
    return singleTenantConfig;
  }

  // Multi-tenant mode: load from database with caching
  const cacheKey = getCacheKey(tenantUrl, teamName);

  // Check cache first
  const cached = configCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logger.debug('Tenant config cache hit', { tenantUrl, teamName });
    return cached.config;
  }

  logger.debug('Tenant config cache miss, loading from database', { tenantUrl, teamName });

  // Get tenant by URL and team name (single query)
  const tenant = await getTenantByUrlAndTeam(tenantUrl, teamName);
  if (!tenant) {
    throw new Error(`Team not found: ${teamName} in tenant ${tenantUrl}`);
  }

  if (!tenant.is_active) {
    throw new Error(`Team is inactive: ${teamName} (tenant: ${tenantUrl})`);
  }

  // Get config
  const config = await getTenantConfig(tenant.id);

  // Validate required fields (skip for config page)
  if (!options.skipValidation) {
    validateTenantConfig(config, tenantUrl, teamName);
  }

  // Build full config object (tenantId is the single identifier now)
  const fullConfig = {
    tenantId: tenant.id,
    tenantUrl: tenant.tenant_url,
    teamName: tenant.team_name,
    ...config,
  };

  // Cache result
  configCache.set(cacheKey, {
    config: fullConfig,
    expiresAt: Date.now() + cacheTtlMs,
  });

  logger.info('Tenant config loaded', { tenantUrl, teamName, tenantId: tenant.id });

  return fullConfig;
}

/**
 * Clear team config cache
 * @param {string} tenantUrl - Tenant URL (optional, clears all if not provided)
 * @param {string} teamName - Team name (optional, clears all for tenant if not provided)
 */
function clearCache(tenantUrl = null, teamName = null) {
  if (tenantUrl !== null && teamName !== null) {
    // Clear specific cache entry
    const cacheKey = getCacheKey(tenantUrl, teamName);
    configCache.delete(cacheKey);
    logger.debug('Cleared cache for team', { tenantUrl, teamName });
  } else if (tenantUrl !== null) {
    // Clear all entries for this tenant URL
    const prefix = `${tenantUrl}:`;
    for (const key of configCache.keys()) {
      if (key.startsWith(prefix)) {
        configCache.delete(key);
      }
    }
    logger.debug('Cleared cache for tenant', { tenantUrl });
  } else {
    configCache.clear();
    logger.debug('Cleared all team config cache');
  }
}

/**
 * List all active tenants
 * @returns {Promise<Array>} List of tenant records
 */
async function listActiveTenants() {
  if (!isDatabaseEnabled()) {
    // Single-tenant mode: return single tenant
    if (singleTenantConfig) {
      return [{ tenant_url: singleTenantConfig.tenantUrl }];
    }
    return [];
  }

  const result = await query(
    'SELECT tenant_url FROM tenants WHERE is_active = true ORDER BY tenant_url',
    []
  );
  return result.rows;
}

/**
 * List all active teams for a tenant URL
 * @param {string} tenantUrl - Tenant URL
 * @returns {Promise<Array>} List of team records
 */
async function listActiveTeams(tenantUrl) {
  if (!isDatabaseEnabled()) {
    // Single-tenant mode: return single team if URL matches
    if (singleTenantConfig && singleTenantConfig.tenantUrl === tenantUrl) {
      return [{ team_name: singleTenantConfig.teamName }];
    }
    return [];
  }

  const result = await query(
    'SELECT team_name FROM tenants WHERE tenant_url = $1 AND is_active = true ORDER BY team_name',
    [tenantUrl]
  );
  return result.rows;
}

/**
 * Update tenant configuration
 * Only allows updates to aws.* and opaApi.* keys (not okta.*)
 * @param {string} tenantId - Tenant UUID
 * @param {Object} updates - Key-value pairs to update (dot notation keys)
 * @returns {Promise<Object>} Updated config
 */
async function updateTenantConfig(tenantId, updates) {
  if (!isDatabaseEnabled()) {
    throw new Error('Configuration updates are not available in single-tenant mode. Update environment variables and restart the application.');
  }

  // Validate: only allow aws.* and opaApi.* keys
  const allowedPrefixes = ['aws.', 'opaApi.'];
  const forbiddenPrefixes = ['okta.'];

  for (const key of Object.keys(updates)) {
    // Check if key is forbidden
    if (forbiddenPrefixes.some(prefix => key.startsWith(prefix))) {
      throw new Error(`Cannot modify Okta configuration: ${key}`);
    }

    // Check if key is allowed
    if (!allowedPrefixes.some(prefix => key.startsWith(prefix))) {
      throw new Error(`Invalid config key: ${key}. Only aws.* and opaApi.* keys are allowed.`);
    }
  }

  // Get tenant info for cache clearing
  const tenantResult = await query(
    'SELECT tenant_url, team_name FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant not found');
  }
  const { team_name: teamName, tenant_url: tenantUrl } = tenantResult.rows[0];

  // Update each key using UPSERT
  for (const [key, value] of Object.entries(updates)) {
    // Only update if value is not empty (empty string means keep existing)
    if (value !== '' && value !== null && value !== undefined) {
      await query(
        `INSERT INTO tenant_configs (tenant_id, config_key, config_value, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (tenant_id, config_key)
         DO UPDATE SET config_value = $3, updated_at = CURRENT_TIMESTAMP`,
        [tenantId, key, value]
      );
      logger.debug('Updated tenant config', { tenantId, key });
    }
  }

  // Update tenant's updated_at timestamp
  await query('UPDATE tenants SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [tenantId]);

  // Clear cache for this tenant
  clearCache(tenantUrl, teamName);
  logger.info('Tenant config updated', { tenantId, tenantUrl, teamName, keysUpdated: Object.keys(updates).length });

  // Return fresh config
  return loadTeamConfig(tenantUrl, teamName);
}

/**
 * Delete specific tenant configuration keys
 * @param {string} tenantId - Tenant UUID
 * @param {Array<string>} keys - Array of config keys to delete (dot notation)
 * @returns {Promise<number>} Number of keys deleted
 */
async function deleteTenantConfigKeys(tenantId, keys) {
  if (!isDatabaseEnabled()) {
    throw new Error('Configuration updates are not available in single-tenant mode.');
  }

  if (!keys || keys.length === 0) {
    return 0;
  }

  // Validate: only allow aws.* and opaApi.* keys
  const allowedPrefixes = ['aws.', 'opaApi.'];
  const forbiddenPrefixes = ['okta.'];

  for (const key of keys) {
    if (forbiddenPrefixes.some(prefix => key.startsWith(prefix))) {
      throw new Error(`Cannot delete Okta configuration: ${key}`);
    }
    if (!allowedPrefixes.some(prefix => key.startsWith(prefix))) {
      throw new Error(`Invalid config key: ${key}. Only aws.* and opaApi.* keys are allowed.`);
    }
  }

  // Get tenant info for cache clearing
  const tenantResult = await query(
    'SELECT tenant_url, team_name FROM tenants WHERE id = $1',
    [tenantId]
  );
  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant not found');
  }
  const { team_name: teamName, tenant_url: tenantUrl } = tenantResult.rows[0];

  // Delete the keys
  const result = await query(
    'DELETE FROM tenant_configs WHERE tenant_id = $1 AND config_key = ANY($2)',
    [tenantId, keys]
  );

  // Update tenant's updated_at timestamp
  await query('UPDATE tenants SET updated_at = CURRENT_TIMESTAMP WHERE id = $1', [tenantId]);

  // Clear cache for this tenant
  clearCache(tenantUrl, teamName);
  logger.info('Tenant config keys deleted', { tenantId, tenantUrl, teamName, keysDeleted: keys });

  return result.rowCount;
}

/**
 * Check if running in single-tenant mode
 */
function isSingleTenantMode() {
  return !isDatabaseEnabled();
}

/**
 * Get single-tenant config (for direct access when needed)
 */
function getSingleTenantConfig() {
  return singleTenantConfig;
}

module.exports = {
  initialize,
  initCache,
  getTenantByUrlAndTeam,
  getTenantConfig,
  loadTeamConfig,
  validateTenantConfig,
  clearCache,
  listActiveTenants,
  listActiveTeams,
  updateTenantConfig,
  deleteTenantConfigKeys,
  isSingleTenantMode,
  getSingleTenantConfig,
};
