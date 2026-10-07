/**
 * OPA API Service
 *
 * Integrates with the Okta Privileged Access API to fetch
 * teams, projects, servers, and users for dropdown population.
 *
 * Multi-tenant support: Each tenant maintains separate token and cache state.
 * Authentication Flow:
 * 1. Use API ID and Secret to request a Bearer token from /v1/teams/{team}/service_token
 * 2. Use the Bearer token for subsequent API calls
 * 3. Token expires - handle 401 by refreshing the token
 *
 * Required Service User Capabilities:
 * - groups.list
 * - team_users.list
 * - team.servers.list
 * - resource_groups.list
 * - gateways.list
 * - projects.list (or resource_admin role)
 */

const { OPA_API } = require('../config/constants');

// Per-tenant state: Map<tenantId, { token, tokenExpiresAt, tokenRequestPromise, cache }>
const tenantState = new Map();

/**
 * Get or initialize per-tenant state
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Tenant state object
 */
function getTenantState(tenantId) {
  if (!tenantState.has(tenantId)) {
    tenantState.set(tenantId, {
      token: null,
      tokenExpiresAt: null,
      tokenRequestPromise: null,
      cache: { data: new Map(), timestamps: new Map() },
    });
  }
  return tenantState.get(tenantId);
}

/**
 * Get OPA API client configuration from tenant config
 * @param {Object} tenantConfig - Tenant configuration object (includes tenantUrl)
 * @returns {Object} OPA client config with enabled flag, or {enabled: false}
 */
function getOpaApiClient(tenantConfig) {
  // tenantUrl is the OPA instance URL (e.g., "demo-blue-sky-1234.pam.okta.com")
  const tenantUrl = tenantConfig.tenantUrl;
  // teamName for API paths (/v1/teams/{teamName}/...)
  const teamName = tenantConfig.teamName;

  if (!tenantUrl || !teamName || !tenantConfig.opaApi?.keyId || !tenantConfig.opaApi?.keySecret) {
    return { enabled: false };
  }

  // Use the tenant URL directly - no more URL construction needed
  const url = `https://${tenantUrl}`;

  return {
    enabled: true,
    url,
    teamName,
    keyId: tenantConfig.opaApi.keyId,
    keySecret: tenantConfig.opaApi.keySecret,
    tenantId: tenantConfig.tenantId,
  };
}

/**
 * Check if OPA API is enabled for tenant
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {boolean} Whether OPA API is enabled
 */
function isEnabled(tenantConfig) {
  return getOpaApiClient(tenantConfig).enabled;
}

/**
 * Check if the bearer token for a tenant is valid and not expired
 * @param {string} tenantId - Tenant ID
 * @returns {boolean} Whether the token is valid
 */
function isTokenValid(tenantId) {
  const state = getTenantState(tenantId);
  if (!state.token || !state.tokenExpiresAt) {
    return false;
  }
  // Consider token expired 30 seconds before actual expiry for safety
  const bufferMs = 30 * 1000;
  return Date.now() < (state.tokenExpiresAt.getTime() - bufferMs);
}

/**
 * Request a new Bearer token from OPA API
 * @param {Object} client - OPA client config from getOpaApiClient
 * @returns {Promise<Object>} Object with token and expiresAt properties
 */
async function requestBearerToken(client) {
  if (!client.enabled) {
    throw new Error('OPA API is not configured');
  }

  const url = `${client.url}/v1/teams/${client.teamName}/service_token`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPA_API.TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        key_id: client.keyId,
        key_secret: client.keySecret,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');

      if (response.status === 401 || response.status === 403) {
        throw new Error('OPA_AUTH_FAILED: Invalid API credentials');
      }
      throw new Error(`OPA token request failed: ${response.status}`);
    }

    const data = await response.json();

    return {
      token: data.bearer_token,
      expiresAt: new Date(data.expires_at),
    };
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('OPA token request timeout');
    }

    throw error;
  }
}

/**
 * Get a valid Bearer token for tenant, refreshing if necessary
 * Uses a mutex to prevent multiple simultaneous token requests
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<string>} Valid Bearer token
 */
async function getValidToken(tenantConfig) {
  const client = getOpaApiClient(tenantConfig);
  if (!client.enabled) {
    throw new Error('OPA API not configured');
  }

  const state = getTenantState(client.tenantId);

  // If token is still valid, return it
  if (isTokenValid(client.tenantId)) {
    return state.token;
  }

  // If a token request is already in progress, wait for it
  if (state.tokenRequestPromise) {
    return state.tokenRequestPromise;
  }

  // Start a new token request
  state.tokenRequestPromise = requestBearerToken(client)
    .then(result => {
      state.token = result.token;
      state.tokenExpiresAt = result.expiresAt;
      return result.token;
    })
    .finally(() => {
      state.tokenRequestPromise = null;
    });

  return state.tokenRequestPromise;
}

/**
 * Invalidate the bearer token for a tenant
 * @param {string} tenantId - Tenant ID
 */
function invalidateToken(tenantId) {
  const state = getTenantState(tenantId);
  state.token = null;
  state.tokenExpiresAt = null;
}

/**
 * Get cached data or fetch from API (tenant-specific)
 * @param {string} tenantId - Tenant ID
 * @param {string} cacheKey - Cache key
 * @param {Function} fetchFn - Function to fetch data if not cached
 * @returns {Promise<any>} Cached or fetched data
 */
async function getCachedOrFetch(tenantId, cacheKey, fetchFn) {
  const state = getTenantState(tenantId);
  const cache = state.cache;
  const now = Date.now();
  const timestamp = cache.timestamps.get(cacheKey);

  if (timestamp && now - timestamp < OPA_API.CACHE_TTL_MS) {
    return cache.data.get(cacheKey);
  }

  const data = await fetchFn();
  cache.data.set(cacheKey, data);
  cache.timestamps.set(cacheKey, now);
  return data;
}

/**
 * Make an authenticated request to the OPA API
 * @param {Object} tenantConfig - Tenant configuration object
 * @param {string} endpoint - API endpoint (without base URL)
 * @param {boolean} retry - Whether this is a retry after token refresh
 * @returns {Promise<Object>} API response
 */
async function makeRequest(tenantConfig, endpoint, retry = false) {
  const client = getOpaApiClient(tenantConfig);

  if (!client.enabled) {
    throw new Error('OPA API is not configured');
  }

  // Get a valid token
  const token = await getValidToken(tenantConfig);

  const url = `${client.url}${endpoint}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OPA_API.TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        // Not JSON
      }

      // Check if this is an authentication error (token expired) vs authorization error (permission denied)
      const isAuthError = errorData.type === 'authentication_error';
      const isAuthzError = errorData.type === 'authorization_error';

      // Only retry on authentication errors (expired token), not authorization errors (missing permissions)
      if (response.status === 401 && isAuthError && !retry) {
        invalidateToken(client.tenantId);
        return makeRequest(tenantConfig, endpoint, true);
      }

      // Provide more specific error messages
      if (isAuthzError) {
        throw new Error(`OPA_PERMISSION_DENIED: ${errorData.message || 'Missing required capability'}`);
      }
      if (isAuthError) {
        throw new Error('OPA_AUTH_FAILED');
      }
      throw new Error(`OPA API error: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      throw new Error('OPA API request timeout');
    }

    throw error;
  }
}

/**
 * Fetch all servers for the tenant
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<Array<string>>} List of server hostnames
 */
async function getServers(tenantConfig) {
  if (!isEnabled(tenantConfig)) return [];

  try {
    const client = getOpaApiClient(tenantConfig);
    return await getCachedOrFetch(client.tenantId, 'servers', async () => {
      const endpoint = `/v1/teams/${client.teamName}/all_servers`;
      const response = await makeRequest(tenantConfig, endpoint);

      // Extract unique hostnames
      const servers = (response.list || [])
        .map(s => s.hostname)
        .filter(Boolean)
        .sort();

      // Remove duplicates
      return [...new Set(servers)];
    });
  } catch (error) {
    return [];
  }
}

/**
 * Fetch all active users for the tenant
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<Array<string>>} List of usernames
 */
async function getUsers(tenantConfig) {
  if (!isEnabled(tenantConfig)) return [];

  try {
    const client = getOpaApiClient(tenantConfig);
    return await getCachedOrFetch(client.tenantId, 'users', async () => {
      const endpoint = `/v1/teams/${client.teamName}/users?status=ACTIVE&count=200`;
      const response = await makeRequest(tenantConfig, endpoint);

      // Extract unique usernames
      const users = (response.list || [])
        .map(u => u.name)
        .filter(Boolean)
        .sort();

      return [...new Set(users)];
    });
  } catch (error) {
    return [];
  }
}

/**
 * Fetch all groups (teams) for the tenant
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<Array<string>>} List of group names
 */
async function getGroups(tenantConfig) {
  if (!isEnabled(tenantConfig)) return [];

  try {
    const client = getOpaApiClient(tenantConfig);
    return await getCachedOrFetch(client.tenantId, 'groups', async () => {
      const endpoint = `/v1/teams/${client.teamName}/groups?count=200`;
      const response = await makeRequest(tenantConfig, endpoint);

      // Extract unique group names
      const groups = (response.list || [])
        .map(g => g.name)
        .filter(Boolean)
        .sort();

      return [...new Set(groups)];
    });
  } catch (error) {
    return [];
  }
}

/**
 * Fetch all resource groups for the tenant
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<Array<Object>>} List of resource groups with id and name
 */
async function getResourceGroups(tenantConfig) {
  if (!isEnabled(tenantConfig)) return [];

  try {
    const client = getOpaApiClient(tenantConfig);
    return await getCachedOrFetch(client.tenantId, 'resourceGroups', async () => {
      const endpoint = `/v1/teams/${client.teamName}/resource_groups`;
      const response = await makeRequest(tenantConfig, endpoint);

      return (response.list || [])
        .map(rg => ({ id: rg.id, name: rg.name }))
        .filter(rg => rg.id && rg.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  } catch (error) {
    return [];
  }
}

/**
 * Fetch all projects across all resource groups for the tenant
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<Array<string>>} List of project names
 */
async function getProjects(tenantConfig) {
  if (!isEnabled(tenantConfig)) return [];

  try {
    const client = getOpaApiClient(tenantConfig);
    return await getCachedOrFetch(client.tenantId, 'projects', async () => {
      const resourceGroups = await getResourceGroups(tenantConfig);
      const allProjects = new Set();

      // Fetch projects from each resource group
      for (const rg of resourceGroups) {
        try {
          const endpoint = `/v1/teams/${client.teamName}/resource_groups/${rg.id}/projects`;
          const response = await makeRequest(tenantConfig, endpoint);

          (response.list || []).forEach(p => {
            if (p.name) allProjects.add(p.name);
          });
        } catch (error) {
          // Continue fetching other resource groups
        }
      }

      return [...allProjects].sort();
    });
  } catch (error) {
    return [];
  }
}

/**
 * Fetch all gateways for the tenant
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<Array<string>>} List of gateway names
 */
async function getGateways(tenantConfig) {
  if (!isEnabled(tenantConfig)) return [];

  try {
    const client = getOpaApiClient(tenantConfig);
    return await getCachedOrFetch(client.tenantId, 'gateways', async () => {
      const endpoint = `/v1/teams/${client.teamName}/gateways?count=200`;
      const response = await makeRequest(tenantConfig, endpoint);

      const gateways = (response.list || [])
        .map(g => g.name)
        .filter(Boolean)
        .sort();

      return [...new Set(gateways)];
    });
  } catch (error) {
    return [];
  }
}

/**
 * Fetch all filter options for dropdown population
 * @param {Object} tenantConfig - Tenant configuration object
 * @returns {Promise<Object>} Object with servers, users, projects arrays
 */
async function getAllFilterOptions(tenantConfig) {
  if (!isEnabled(tenantConfig)) {
    return {
      enabled: false,
      servers: [],
      users: [],
      projects: [],
      gateways: [],
    };
  }

  try {
    // Fetch all data in parallel
    const [servers, users, projects, gateways] = await Promise.all([
      getServers(tenantConfig),
      getUsers(tenantConfig),
      getProjects(tenantConfig),
      getGateways(tenantConfig),
    ]);

    return {
      enabled: true,
      servers,
      users,
      projects,
      gateways,
    };
  } catch (error) {
    return {
      enabled: true,
      error: 'Failed to load filter options',
      servers: [],
      users: [],
      projects: [],
      gateways: [],
    };
  }
}

/**
 * Clear the cache for a specific tenant or all tenants
 * @param {string} tenantId - Optional tenant ID. If not provided, clears all caches
 */
function clearCache(tenantId = null) {
  if (tenantId) {
    const state = getTenantState(tenantId);
    state.cache.data.clear();
    state.cache.timestamps.clear();
  } else {
    for (const state of tenantState.values()) {
      state.cache.data.clear();
      state.cache.timestamps.clear();
    }
  }
}

module.exports = {
  isEnabled,
  getServers,
  getUsers,
  getGroups,
  getProjects,
  getGateways,
  getAllFilterOptions,
  clearCache,
};
