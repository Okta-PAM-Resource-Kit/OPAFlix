/**
 * OPA Graph Service
 *
 * Fetches OPA infrastructure data and builds topology graph
 * showing relationships between Gateways, Projects, and Servers.
 *
 * Multi-tenant support: Uses opaApiService for token management
 * and maintains per-tenant cache for graph data.
 */

const { isEnabled } = require('./opaApiService');
const { OPA_API } = require('../config/constants');
const { getLogger } = require('../config/logger');

const logger = getLogger();

// Per-tenant cache for graph data: Map<tenantId, { data, timestamp }>
const graphCacheByTenant = new Map();

// Per-tenant token state: Map<tenantId, { token, expiresAt, requestPromise }>
const tokenStateByTenant = new Map();

/**
 * Get or initialize token state for tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Token state
 */
function getTokenState(tenantId) {
  if (!tokenStateByTenant.has(tenantId)) {
    tokenStateByTenant.set(tenantId, {
      token: null,
      expiresAt: null,
      requestPromise: null,
    });
  }
  return tokenStateByTenant.get(tenantId);
}

/**
 * Get or initialize graph cache for tenant
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Cache state
 */
function getGraphCache(tenantId) {
  if (!graphCacheByTenant.has(tenantId)) {
    graphCacheByTenant.set(tenantId, {
      data: null,
      timestamp: null,
    });
  }
  return graphCacheByTenant.get(tenantId);
}

/**
 * Get OPA API client configuration from tenant config
 * @param {Object} tenantConfig - Tenant configuration (includes tenantUrl)
 * @returns {Object} Client config with enabled flag
 */
function getClientConfig(tenantConfig) {
  // tenantUrl is the OPA instance URL (e.g., "demo-blue-sky-1234.pam.okta.com")
  const tenantUrl = tenantConfig?.tenantUrl;
  // teamName for API paths (/v1/teams/{teamName}/...)
  const teamName = tenantConfig?.teamName;

  if (!tenantUrl || !teamName || !tenantConfig?.opaApi?.keyId || !tenantConfig?.opaApi?.keySecret) {
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
 * Request a new Bearer token from OPA API
 * @param {Object} client - Client config
 * @returns {Promise<Object>} Token and expiry
 */
async function requestBearerToken(client) {
  const url = `${client.url}/v1/teams/${client.teamName}/service_token`;

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
  });

  if (!response.ok) {
    throw new Error('Failed to obtain OPA Bearer token');
  }

  const data = await response.json();
  return {
    token: data.bearer_token,
    expiresAt: new Date(data.expires_at),
  };
}

/**
 * Get a valid Bearer token for tenant
 * @param {Object} client - Client config
 * @returns {Promise<string>} Bearer token
 */
async function getValidToken(client) {
  const state = getTokenState(client.tenantId);

  // Check if token is still valid (with 30s buffer)
  if (state.token && state.expiresAt && Date.now() < (state.expiresAt.getTime() - 30000)) {
    return state.token;
  }

  // If a request is in progress, wait for it
  if (state.requestPromise) {
    return state.requestPromise;
  }

  // Request new token
  state.requestPromise = requestBearerToken(client)
    .then(result => {
      state.token = result.token;
      state.expiresAt = result.expiresAt;
      return result.token;
    })
    .finally(() => {
      state.requestPromise = null;
    });

  return state.requestPromise;
}

/**
 * Make authenticated request to OPA API
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} endpoint - API endpoint
 * @returns {Promise<Object>} API response
 */
async function makeGraphRequest(tenantConfig, endpoint) {
  const client = getClientConfig(tenantConfig);

  if (!client.enabled) {
    throw new Error('OPA API is not configured');
  }

  const token = await getValidToken(client);
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
      throw new Error(`OPA API error: ${response.status} - ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Fetch gateway status
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} gatewayId - Gateway ID
 * @returns {Promise<Object|null>} Gateway status or null
 */
async function getGatewayStatus(tenantConfig, gatewayId) {
  const client = getClientConfig(tenantConfig);
  if (!client.enabled) return null;

  try {
    const endpoint = `/v1/teams/${client.teamName}/gateways/${gatewayId}/status`;
    return await makeGraphRequest(tenantConfig, endpoint);
  } catch (error) {
    logger.debug('Failed to fetch gateway status', { gatewayId, error: error.message });
    return null;
  }
}

/**
 * Fetch gateways with full details including labels and status
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<Array>} Array of gateway objects
 */
async function getGatewaysWithDetails(tenantConfig, errors = []) {
  const client = getClientConfig(tenantConfig);
  if (!client.enabled) return [];

  try {
    const endpoint = `/v1/teams/${client.teamName}/gateways?count=200`;
    const response = await makeGraphRequest(tenantConfig, endpoint);

    // Threshold for considering a gateway as inactive (90 days)
    const STALE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    // Filter out gateways that:
    // 1. Have refuse_connections = true
    // 2. Have not been seen within the threshold (inactive/stale)
    const gateways = (response.list || [])
      .filter(g => {
        // Exclude gateways refusing connections
        if (g.refuse_connections === true) return false;

        // Exclude stale gateways (not seen within threshold)
        if (g.last_seen) {
          const lastSeenTime = new Date(g.last_seen).getTime();
          if (now - lastSeenTime > STALE_THRESHOLD_MS) return false;
        }

        return true;
      })
      .map(g => ({
        id: g.id,
        name: g.name,
        labels: g.labels || {},
        description: g.description || '',
        accessAddress: g.access_address || '',
        defaultAddress: g.default_address || '',
        cloudProvider: g.cloud_provider || '',
        lastSeen: g.last_seen || '',
      }));

    // Fetch status for each gateway in parallel
    const statusPromises = gateways.map(g => getGatewayStatus(tenantConfig, g.id));
    const statuses = await Promise.all(statusPromises);

    // Merge status data into gateways
    gateways.forEach((g, i) => {
      const status = statuses[i];
      if (status) {
        g.status = status.status || '';
        g.statusUpdatedAt = status.updated_at || '';
        g.totalStorageBytes = status.total_storage_bytes || 0;
        g.usedStorageBytes = status.used_storage_bytes || 0;
      }
    });

    return gateways;
  } catch (error) {
    const errorInfo = {
      type: 'gateways',
      message: error.message,
      endpoint: `/v1/teams/${client.teamName}/gateways`,
    };
    logger.warn('Failed to fetch gateways', { ...errorInfo, tenantId: client.tenantId });
    errors.push(errorInfo);
    return [];
  }
}

/**
 * Fetch projects with full details including gateway_selector
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<Array>} Array of project objects
 */
async function getProjectsWithDetails(tenantConfig, errors = []) {
  const client = getClientConfig(tenantConfig);
  if (!client.enabled) return [];

  try {
    // First get resource groups
    const rgEndpoint = `/v1/teams/${client.teamName}/resource_groups`;
    const rgResponse = await makeGraphRequest(tenantConfig, rgEndpoint);
    const resourceGroups = rgResponse.list || [];

    const allProjects = [];

    // Fetch projects from each resource group
    for (const rg of resourceGroups) {
      try {
        const endpoint = `/v1/teams/${client.teamName}/resource_groups/${rg.id}/projects`;
        const response = await makeGraphRequest(tenantConfig, endpoint);

        (response.list || []).forEach(p => {
          allProjects.push({
            id: p.id,
            name: p.name,
            gatewaySelector: p.gateway_selector || '',
            resourceGroupId: rg.id,
            resourceGroupName: rg.name,
          });
        });
      } catch (error) {
        logger.warn('Failed to fetch projects for resource group', {
          resourceGroup: rg.name,
          error: error.message,
        });
      }
    }

    return allProjects;
  } catch (error) {
    const errorInfo = {
      type: 'projects',
      message: error.message,
      endpoint: `/v1/teams/${client.teamName}/resource_groups`,
    };
    logger.warn('Failed to fetch projects', { ...errorInfo, tenantId: client.tenantId });
    errors.push(errorInfo);
    return [];
  }
}

/**
 * Fetch servers with full details including project
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<Array>} Array of server objects
 */
async function getServersWithDetails(tenantConfig, errors = []) {
  const client = getClientConfig(tenantConfig);
  if (!client.enabled) return [];

  try {
    const endpoint = `/v1/teams/${client.teamName}/all_servers`;
    const response = await makeGraphRequest(tenantConfig, endpoint);

    return (response.list || []).map(s => ({
      id: s.id,
      hostname: s.hostname,
      projectName: s.project_name || s.project || '',
      os: s.os || '',
      osType: s.os_type || '',
      state: s.state || '',
      name: s.name || s.hostname || '',
      accessAddress: s.access_address || '',
      altNames: s.alt_names || s.alternative_names || [],
      cloudProvider: s.cloud_provider || '',
      agentVersion: s.sftd_version || s.agent_version || '',
      labels: s.labels || {},
      lastSeen: s.last_seen || '',
    }));
  } catch (error) {
    const errorInfo = {
      type: 'servers',
      message: error.message,
      endpoint: `/v1/teams/${client.teamName}/all_servers`,
    };
    logger.warn('Failed to fetch servers', { ...errorInfo, tenantId: client.tenantId });
    errors.push(errorInfo);
    return [];
  }
}

/**
 * Parse gateway_selector string into label criteria
 * Input: "REGION=WEST-EU,TEAM=MARKETING"
 * Output: { REGION: "WEST-EU", TEAM: "MARKETING" }
 * @param {string} selectorString - Gateway selector string
 * @returns {Object} Parsed label criteria
 */
function parseGatewaySelector(selectorString) {
  if (!selectorString || typeof selectorString !== 'string') {
    return {};
  }

  const criteria = {};
  const pairs = selectorString.split(',');

  for (const pair of pairs) {
    const [key, value] = pair.split('=').map(s => s.trim());
    if (key && value) {
      criteria[key] = value;
    }
  }

  return criteria;
}

/**
 * Check if gateway labels match project selector criteria
 * Returns true if gateway has ALL labels specified in selector
 * @param {Object} gatewayLabels - Gateway labels object
 * @param {Object} selectorCriteria - Parsed selector criteria
 * @returns {boolean} Whether gateway matches selector
 */
function gatewayMatchesSelector(gatewayLabels, selectorCriteria) {
  if (!gatewayLabels || Object.keys(selectorCriteria).length === 0) {
    return false;
  }

  // Gateway must have ALL labels specified in selector
  for (const [key, value] of Object.entries(selectorCriteria)) {
    if (gatewayLabels[key] !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Build relationships between gateways, projects, and servers
 * @param {Array} gateways - Gateways array
 * @param {Array} projects - Projects array
 * @param {Array} servers - Servers array
 * @returns {Object} Relationships object
 */
function buildRelationships(gateways, projects, servers) {
  const relationships = {
    gatewayToProjects: new Map(), // gateway.id -> [project.id, ...]
    projectToServers: new Map(),   // project.name -> [server.id, ...]
    projectToGateways: new Map(),  // project.id -> [gateway.id, ...]
    orphanedProjects: [],          // Projects with no matching gateway
    orphanedServers: [],           // Servers with no project
  };

  // Match projects to gateways
  for (const project of projects) {
    const selectorCriteria = parseGatewaySelector(project.gatewaySelector);
    const matchingGateways = [];

    if (Object.keys(selectorCriteria).length > 0) {
      for (const gateway of gateways) {
        if (gatewayMatchesSelector(gateway.labels, selectorCriteria)) {
          matchingGateways.push(gateway.id);

          // Add to gateway -> projects mapping
          if (!relationships.gatewayToProjects.has(gateway.id)) {
            relationships.gatewayToProjects.set(gateway.id, []);
          }
          relationships.gatewayToProjects.get(gateway.id).push(project.id);
        }
      }
    }

    if (matchingGateways.length === 0) {
      relationships.orphanedProjects.push(project.id);
    }

    relationships.projectToGateways.set(project.id, matchingGateways);
  }

  // Match servers to projects
  for (const server of servers) {
    if (server.projectName) {
      const project = projects.find(p => p.name === server.projectName);
      if (project) {
        if (!relationships.projectToServers.has(project.name)) {
          relationships.projectToServers.set(project.name, []);
        }
        relationships.projectToServers.get(project.name).push(server.id);
      } else {
        relationships.orphanedServers.push(server.id);
      }
    } else {
      relationships.orphanedServers.push(server.id);
    }
  }

  return relationships;
}

/**
 * Sanitize text for Mermaid diagram (escape special characters)
 * @param {string} text - Text to sanitize
 * @returns {string} Sanitized text
 */
function sanitizeForMermaid(text) {
  if (!text) return '';
  return text
    .replace(/"/g, '\'')
    .replace(/[<>]/g, '')
    .replace(/[\r\n]/g, ' ')
    .substring(0, 50); // Limit length
}

/**
 * Format labels for display
 * @param {Object} labels - Labels object
 * @returns {string} Formatted labels string
 */
function formatLabels(labels) {
  if (!labels || Object.keys(labels).length === 0) {
    return 'No labels';
  }

  return Object.entries(labels)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/**
 * Generate Mermaid diagram syntax from topology
 * @param {Object} topology - Infrastructure topology
 * @returns {string} Mermaid diagram syntax
 */
function generateMermaidDiagram(topology) {
  const { gateways, projects, servers, relationships } = topology;
  const lines = [];

  lines.push('graph TB');

  // Sort gateways and projects alphabetically by name
  const sortedGateways = [...gateways].sort((a, b) => a.name.localeCompare(b.name));
  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  // Add subgraphs for better organization
  // Gateways subgraph
  if (sortedGateways.length > 0) {
    lines.push('    subgraph Gateways["Gateways"]');
    for (const gw of sortedGateways) {
      const labels = formatLabels(gw.labels);
      const safeName = sanitizeForMermaid(gw.name);
      const safeLabels = sanitizeForMermaid(labels);
      lines.push(`        GW_${gw.id}["${safeName}<br/><small>${safeLabels}</small>"]`);
    }
    lines.push('    end');
  }

  // Split projects into connected (have matching gateway) and orphaned (no matching gateway) for styling
  const connectedProjects = projects.filter(p => !relationships.orphanedProjects.includes(p.id));
  const orphanedProjects = projects.filter(p => relationships.orphanedProjects.includes(p.id));

  // All Projects in single subgraph (sorted alphabetically)
  if (sortedProjects.length > 0) {
    lines.push('    subgraph Projects["Projects"]');
    for (const proj of sortedProjects) {
      const safeName = sanitizeForMermaid(proj.name);
      const selector = proj.gatewaySelector
        ? sanitizeForMermaid(`Selector: ${proj.gatewaySelector}`)
        : 'No selector';
      lines.push(`        P_${proj.id}["${safeName}<br/><small>${selector}</small>"]`);
    }
    lines.push('    end');
  }

  // Servers subgraph
  if (servers.length > 0) {
    lines.push('    subgraph Servers["Servers"]');
    for (const srv of servers) {
      const safeName = sanitizeForMermaid(srv.hostname);
      lines.push(`        S_${srv.id}["${safeName}"]`);
    }
    lines.push('    end');
  }

  // Add edges: Gateway -> Project
  for (const [gatewayId, projectIds] of relationships.gatewayToProjects) {
    for (const projectId of projectIds) {
      lines.push(`    GW_${gatewayId} --> P_${projectId}`);
    }
  }

  // Add edges: Project -> Server
  for (const project of projects) {
    const serverIds = relationships.projectToServers.get(project.name) || [];
    for (const serverId of serverIds) {
      lines.push(`    P_${project.id} --> S_${serverId}`);
    }
  }

  // Style nodes
  lines.push('');
  lines.push('    %% Styling');

  for (const gw of gateways) {
    lines.push(`    style GW_${gw.id} fill:#4CAF50,color:#fff`);
  }

  // Style connected projects (blue)
  for (const proj of connectedProjects) {
    lines.push(`    style P_${proj.id} fill:#2196F3,color:#fff`);
  }

  // Style orphaned projects (purple - no gateway match)
  for (const proj of orphanedProjects) {
    lines.push(`    style P_${proj.id} fill:#9C27B0,color:#fff`);
  }

  for (const srv of servers) {
    lines.push(`    style S_${srv.id} fill:#FF9800,color:#fff`);
  }

  return lines.join('\n');
}

/**
 * Fetch complete OPA infrastructure topology
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<Object>} Topology data with gateways, projects, servers, relationships
 */
async function getInfrastructureTopology(tenantConfig) {
  if (!isEnabled(tenantConfig)) {
    throw new Error('OPA API is not configured');
  }

  const tenantId = tenantConfig.tenantId;
  const cache = getGraphCache(tenantId);

  // Check cache
  if (cache.data && cache.timestamp) {
    const age = Date.now() - cache.timestamp;
    if (age < OPA_API.CACHE_TTL_MS) {
      logger.debug('Returning cached graph data', { tenantId });
      return cache.data;
    }
  }

  logger.info('Fetching infrastructure topology from OPA API', { tenantId });

  // Track errors from fetch operations
  const errors = [];

  // Fetch all data in parallel
  const [gateways, projects, servers] = await Promise.all([
    getGatewaysWithDetails(tenantConfig, errors),
    getProjectsWithDetails(tenantConfig, errors),
    getServersWithDetails(tenantConfig, errors),
  ]);

  // Build relationships
  const relationships = buildRelationships(gateways, projects, servers);

  const topology = {
    gateways,
    projects,
    servers,
    relationships,
    errors,
  };

  // Cache the result (only if no errors)
  if (errors.length === 0) {
    cache.data = topology;
    cache.timestamp = Date.now();
  }

  logger.info('Infrastructure topology fetched', {
    tenantId,
    gatewayCount: gateways.length,
    projectCount: projects.length,
    serverCount: servers.length,
    errorCount: errors.length,
  });

  return topology;
}

/**
 * Generate Cytoscape.js elements from topology
 * @param {Object} topology - Infrastructure topology
 * @returns {Object} { nodes: [], edges: [] }
 */
function generateCytoscapeElements(topology) {
  const { gateways, projects, servers, relationships } = topology;
  const nodes = [];
  const edges = [];

  // Sort gateways and projects alphabetically
  const sortedGateways = [...gateways].sort((a, b) => a.name.localeCompare(b.name));
  const sortedProjects = [...projects].sort((a, b) => a.name.localeCompare(b.name));

  // Add gateway nodes
  for (const gw of sortedGateways) {
    nodes.push({
      data: {
        id: `gw-${gw.id}`,
        gatewayId: gw.id,
        label: gw.name,
        type: 'gateway',
        labels: gw.labels,
        accessAddress: gw.accessAddress,
        defaultAddress: gw.defaultAddress,
        cloudProvider: gw.cloudProvider,
        description: gw.description,
        lastSeen: gw.lastSeen,
        status: gw.status,
        statusUpdatedAt: gw.statusUpdatedAt,
        totalStorageBytes: gw.totalStorageBytes,
        usedStorageBytes: gw.usedStorageBytes,
      }
    });
  }

  // Add project nodes with parent group (only projects that have servers)
  const projectsWithServers = sortedProjects.filter(proj => {
    const serverIds = relationships.projectToServers.get(proj.name) || [];
    return serverIds.length > 0;
  });

  for (const proj of projectsWithServers) {
    const isOrphaned = relationships.orphanedProjects.includes(proj.id);
    nodes.push({
      data: {
        id: `proj-${proj.id}`,
        projectId: proj.id,
        label: proj.name,
        type: isOrphaned ? 'project-orphan' : 'project',
        gatewaySelector: proj.gatewaySelector,
        resourceGroupName: proj.resourceGroupName,
      }
    });
  }

  // Track project IDs that have servers (for filtering edges)
  const projectIdsWithServers = new Set(projectsWithServers.map(p => p.id));

  // Add server nodes (sorted alphabetically)
  const sortedServers = [...servers].sort((a, b) => a.hostname.localeCompare(b.hostname));
  for (const srv of sortedServers) {
    nodes.push({
      data: {
        id: `srv-${srv.id}`,
        serverId: srv.id,
        label: srv.hostname,
        type: 'server',
        name: srv.name,
        accessAddress: srv.accessAddress,
        altNames: srv.altNames,
        os: srv.os,
        osType: srv.osType,
        cloudProvider: srv.cloudProvider,
        agentVersion: srv.agentVersion,
        projectName: srv.projectName,
        state: srv.state,
        labels: srv.labels,
        lastSeen: srv.lastSeen,
      }
    });
  }

  // Add gateway -> project edges (only for projects with servers)
  for (const [gatewayId, projectIds] of relationships.gatewayToProjects) {
    for (const projectId of projectIds) {
      if (projectIdsWithServers.has(projectId)) {
        edges.push({
          data: {
            id: `gw-${gatewayId}-proj-${projectId}`,
            source: `gw-${gatewayId}`,
            target: `proj-${projectId}`,
          }
        });
      }
    }
  }

  // Add project -> server edges
  for (const proj of projectsWithServers) {
    const serverIds = relationships.projectToServers.get(proj.name) || [];
    for (const serverId of serverIds) {
      edges.push({
        data: {
          id: `proj-${proj.id}-srv-${serverId}`,
          source: `proj-${proj.id}`,
          target: `srv-${serverId}`,
        }
      });
    }
  }

  return { nodes, edges };
}

/**
 * Clear the graph cache for a tenant or all tenants
 * @param {string} tenantId - Optional tenant ID
 */
function clearGraphCache(tenantId = null) {
  if (tenantId) {
    graphCacheByTenant.delete(tenantId);
    tokenStateByTenant.delete(tenantId);
  } else {
    graphCacheByTenant.clear();
    tokenStateByTenant.clear();
  }
}

module.exports = {
  getInfrastructureTopology,
  generateMermaidDiagram,
  generateCytoscapeElements,
  parseGatewaySelector,
  gatewayMatchesSelector,
  clearGraphCache,
};
