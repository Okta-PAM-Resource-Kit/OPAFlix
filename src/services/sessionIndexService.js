/**
 * Session Index Service - Multi-Tenant
 *
 * Maintains per-tenant session indices for fast search and pagination.
 * In multi-tenant mode, indices are persisted to the database (session_indices table).
 * In single-tenant mode, indices are stored in-memory only.
 * Uses on-demand staleness checks instead of periodic polling.
 */

const { isDatabaseEnabled, query } = require('./databaseService');
const { getLogger } = require('../config/logger');
const { listSessions } = require('./s3Service');
const { enrichSessionWithMetadata, toStorageFormat, sortSessionsByDate } = require('./fileParser');
const { calculatePagination, getPageSlice, getPageNumbers } = require('../utils/paginationHelper');

const logger = getLogger();

// Per-tenant indices: Map<tenantId, { ssh: [], rdp: [], lastUpdated, isBuilding, buildProgress, lastError }>
const tenantIndices = new Map();

// Pending rebuild promises: Map<teamId, Promise> - allows concurrent callers to wait for ongoing builds
const pendingRebuilds = new Map();

// Configuration
let staleThresholdMinutes = 5;
const REFRESH_DEBOUNCE_SECONDS = 30;

/**
 * Initialize service with config
 */
function initialize(config) {
  if (config?.sessionIndexStaleMinutes) {
    staleThresholdMinutes = config.sessionIndexStaleMinutes;
  }
  if (config?.sessionIndexRefreshMinutes) {
    staleThresholdMinutes = config.sessionIndexRefreshMinutes;
  }

  const mode = isDatabaseEnabled() ? 'multi-tenant (database persistence)' : 'single-tenant (in-memory only)';
  logger.info('Session index service initialized', { staleThresholdMinutes, mode });
}

/**
 * Get or create team index structure
 * @param {string} teamId - Team ID (or tenantId in single-tenant mode for backward compat)
 */
function getTenantIndexState(teamId) {
  if (!tenantIndices.has(teamId)) {
    tenantIndices.set(teamId, {
      ssh: [],
      rdp: [],
      lastUpdated: null,
      isBuilding: false,
      buildProgress: { current: 0, total: 0, phase: 'idle' },
      lastError: null,
      lastErrorTime: null,
      lastRefreshTriggered: null,
    });
  }
  return tenantIndices.get(teamId);
}

/**
 * Check if index is stale for team
 * @param {string} teamId - Team ID
 * @param {Object} tenantConfig - Optional tenant config with per-tenant refresh settings
 * @returns {boolean} True if index is stale or doesn't exist
 */
function isStale(teamId, tenantConfig = null) {
  const state = tenantIndices.get(teamId);
  if (!state?.lastUpdated) return true;
  // Use per-tenant setting if available, otherwise global default
  const maxAgeMinutes = parseInt(tenantConfig?.opaflix?.sessionIndexRefreshMinutes, 10) || staleThresholdMinutes;
  const ageMs = Date.now() - state.lastUpdated.getTime();
  return ageMs > maxAgeMinutes * 60 * 1000;
}

/**
 * Get refresh status for team
 * @param {string} teamId - Team ID
 * @param {Object} tenantConfig - Optional tenant config with per-tenant refresh settings
 * @returns {object} Refresh status object
 */
function getRefreshStatus(teamId, tenantConfig = null) {
  const state = tenantIndices.get(teamId);
  if (!state) {
    return {
      lastUpdated: null,
      isStale: true,
      isBuilding: false,
      buildProgress: { current: 0, total: 0, phase: 'idle' },
      sessionCount: 0,
      lastError: null,
      lastErrorTime: null,
    };
  }
  const sessionCount = state.ssh.length + state.rdp.length;

  return {
    // If we have sessions but no lastUpdated timestamp, use current time as fallback
    lastUpdated: state.lastUpdated || (sessionCount > 0 ? new Date() : null),
    isStale: isStale(teamId, tenantConfig),
    isBuilding: state.isBuilding,
    buildProgress: state.buildProgress,
    sessionCount: sessionCount,
    lastError: state.lastError,
    lastErrorTime: state.lastErrorTime,
  };
}

/**
 * Load index from database
 * Returns null if database is disabled or no data exists
 * @param {string} tenantId - Tenant ID
 */
async function loadIndexFromDatabase(tenantId) {
  // Skip database load in single-tenant mode
  if (!isDatabaseEnabled()) {
    logger.debug('Skipping database load (single-tenant mode)');
    return null;
  }

  try {
    const result = await query(
      `SELECT session_type, index_data, last_refreshed
       FROM session_indices
       WHERE tenant_id = $1`,
      [tenantId]
    );

    if (result.rows.length === 0) return null;

    const index = { ssh: [], rdp: [], lastUpdated: null };
    for (const row of result.rows) {
      // Rebuild derived fields from minimal stored data
      const sessions = (row.index_data?.sessions || []).map(s => {
        // Parse dates
        const session = {
          ...s,
          timestamp: s.timestamp ? new Date(s.timestamp) : null,
          lastModified: s.lastModified ? new Date(s.lastModified) : null,
        };
        // Enrich with derived fields (fileId, displayTimestamp, displaySize)
        const enriched = enrichSessionWithMetadata(session);
        // Rebuild searchable text
        enriched.searchableText = buildSearchableText(enriched);
        return enriched;
      });
      index[row.session_type] = sessions;
      if (row.last_refreshed) {
        const refreshed = new Date(row.last_refreshed);
        if (!index.lastUpdated || refreshed > index.lastUpdated) {
          index.lastUpdated = refreshed;
        }
      }
    }

    logger.debug('Loaded index from database', { tenantId, sshCount: index.ssh.length, rdpCount: index.rdp.length });
    return index;
  } catch (error) {
    logger.error('Failed to load index from database', { tenantId, error: error.message });
    return null;
  }
}

/**
 * Save index to database
 * No-op if database is disabled
 * @param {string} tenantId - Tenant ID
 * @param {Object} index - Index data
 */
async function saveIndexToDatabase(tenantId, index) {
  // Skip database save in single-tenant mode
  if (!isDatabaseEnabled()) {
    logger.debug('Skipping database save (single-tenant mode)');
    return;
  }

  try {
    for (const type of ['ssh', 'rdp']) {
      // Convert to minimal storage format (removes derived/redundant fields)
      const minimalSessions = index[type].map(toStorageFormat);
      await query(
        `INSERT INTO session_indices (tenant_id, session_type, index_data, session_count, last_refreshed)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_id, session_type)
         DO UPDATE SET index_data = $3, session_count = $4, last_refreshed = NOW()`,
        [tenantId, type, JSON.stringify({ sessions: minimalSessions }), index[type].length]
      );
    }
    logger.debug('Saved index to database', { tenantId });
  } catch (error) {
    logger.error('Failed to save index to database', { tenantId, error: error.message });
  }
}

/**
 * Build searchable text for a session
 */
function buildSearchableText(session) {
  return [session.serverName, session.username, session.projectName, session.type, session.displayTimestamp]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * Fetch all sessions of a type from S3
 * @param {object} tenantConfig - Tenant configuration
 * @param {string} type - Session type ('ssh' or 'rdp')
 * @param {object} state - Tenant index state (for progress tracking)
 */
async function fetchAllSessions(tenantConfig, type, state) {
  const allSessions = [];
  let continuationToken = null;
  let pageCount = 0;

  do {
    const result = await listSessions(tenantConfig, type, continuationToken);
    pageCount++;

    const enrichedSessions = result.sessions.map(session => {
      const enriched = enrichSessionWithMetadata(session);
      enriched.searchableText = buildSearchableText(enriched);
      return enriched;
    });

    allSessions.push(...enrichedSessions);
    continuationToken = result.nextToken;

    // Update progress
    if (state) {
      state.buildProgress.current = allSessions.length;
      state.buildProgress.phase = `fetching ${type}`;
    }

    if (pageCount % 10 === 0) {
      logger.debug(`Indexed ${allSessions.length} ${type} sessions for tenant`, { tenantId: tenantConfig.tenantId });
    }
  } while (continuationToken);

  return allSessions;
}

/**
 * Internal rebuild logic
 * @param {string} tenantId - Tenant ID
 * @param {Object} tenantConfig - Tenant configuration
 * @param {Object} state - Index state
 */
async function doRebuildIndex(tenantId, tenantConfig, state) {
  state.isBuilding = true;
  state.buildProgress = { current: 0, total: 0, phase: 'starting' };
  // Clear previous error when starting a new rebuild
  state.lastError = null;
  state.lastErrorTime = null;
  logger.info('Starting index rebuild', { tenantId });

  try {
    // Fetch SSH sessions with progress tracking
    state.buildProgress.phase = 'fetching ssh';
    const sshSessions = await fetchAllSessions(tenantConfig, 'ssh', state);

    // Fetch RDP sessions with progress tracking
    state.buildProgress.phase = 'fetching rdp';
    const rdpSessions = await fetchAllSessions(tenantConfig, 'rdp', state);

    // Finalize
    state.buildProgress.phase = 'finalizing';
    state.ssh = sortSessionsByDate(sshSessions, 'desc');
    state.rdp = sortSessionsByDate(rdpSessions, 'desc');
    state.lastUpdated = new Date();
    state.buildProgress = {
      current: state.ssh.length + state.rdp.length,
      total: state.ssh.length + state.rdp.length,
      phase: 'complete'
    };

    logger.info('Index rebuild complete', { tenantId, sshCount: state.ssh.length, rdpCount: state.rdp.length });

    await saveIndexToDatabase(tenantId, state);
    return { success: true, sshCount: state.ssh.length, rdpCount: state.rdp.length };
  } catch (error) {
    logger.error('Index rebuild failed', { tenantId, error: error.message });
    state.buildProgress.phase = 'error';
    state.lastError = error.message;
    state.lastErrorTime = new Date();
    throw error;
  } finally {
    state.isBuilding = false;
    pendingRebuilds.delete(tenantId);
  }
}

/**
 * Rebuild index for a tenant
 * If a rebuild is already in progress, returns the existing promise so callers can wait
 * @param {string} tenantId - Tenant ID
 * @param {Object} tenantConfig - Tenant configuration
 */
async function rebuildIndex(tenantId, tenantConfig) {
  // If there's already a pending rebuild, wait for it instead of returning early
  const pending = pendingRebuilds.get(tenantId);
  if (pending) {
    logger.debug('Index rebuild already in progress, waiting for completion', { tenantId });
    return pending;
  }

  const state = getTenantIndexState(tenantId);

  // Double-check isBuilding flag (should match pending, but be defensive)
  if (state.isBuilding) {
    logger.debug('Index rebuild already in progress (isBuilding flag)', { tenantId });
    // No pending promise available, return early indication
    return { alreadyInProgress: true };
  }

  // Start the rebuild and store the promise
  const rebuildPromise = doRebuildIndex(tenantId, tenantConfig, state);
  pendingRebuilds.set(tenantId, rebuildPromise);

  return rebuildPromise;
}

/**
 * Check if enough time has passed since last refresh trigger (debounce)
 * @param {Object} state - Tenant index state
 * @returns {boolean} True if a new refresh should be triggered
 */
function shouldTriggerRefresh(state) {
  if (state.isBuilding) return false;

  const timeSinceLastTrigger = state.lastRefreshTriggered
    ? Date.now() - state.lastRefreshTriggered.getTime()
    : Infinity;

  return timeSinceLastTrigger > REFRESH_DEBOUNCE_SECONDS * 1000;
}

/**
 * Ensure index is loaded for tenant
 * Returns immediately with existing data if available, always triggers background refresh (debounced)
 * @param {string} tenantId - Tenant ID
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<{state: Object, refreshTriggered: boolean}>}
 */
async function ensureIndex(tenantId, tenantConfig) {
  const state = getTenantIndexState(tenantId);
  let refreshTriggered = false;

  // If we have in-memory data, return it immediately
  if (state.lastUpdated) {
    // Always trigger background refresh (debounced) for stale-while-revalidate pattern
    if (shouldTriggerRefresh(state)) {
      state.lastRefreshTriggered = new Date();
      refreshTriggered = true;
      logger.debug('Triggering background refresh on page load', { tenantId });
      rebuildIndex(tenantId, tenantConfig).catch(err => {
        logger.error('Background index refresh failed', { tenantId, error: err.message });
      });
    }
    return { ...state, refreshTriggered };
  }

  // Try loading from database first (only in multi-tenant mode)
  const dbIndex = await loadIndexFromDatabase(tenantId);
  if (dbIndex && dbIndex.lastUpdated) {
    state.ssh = dbIndex.ssh;
    state.rdp = dbIndex.rdp;
    state.lastUpdated = dbIndex.lastUpdated;

    // Trigger background refresh (debounced) after loading from DB
    if (shouldTriggerRefresh(state)) {
      state.lastRefreshTriggered = new Date();
      refreshTriggered = true;
      logger.debug('Triggering background refresh after DB load', { tenantId });
      rebuildIndex(tenantId, tenantConfig).catch(err => {
        logger.error('Background index refresh failed', { tenantId, error: err.message });
      });
    }
    return { ...state, refreshTriggered };
  }

  // No data available - must build fresh index (blocking on first load)
  await rebuildIndex(tenantId, tenantConfig);
  state.lastRefreshTriggered = new Date();
  // Just built fresh, no need to poll (refreshTriggered = false)
  return { ...state, refreshTriggered: false };
}

/**
 * Apply advanced filters
 */
function applyAdvancedFilters(sessions, filters) {
  if (!filters || Object.keys(filters).length === 0) return sessions;

  return sessions.filter(session => {
    if (filters.server && !session.serverName?.toLowerCase().includes(filters.server.toLowerCase())) return false;
    if (filters.username && !session.username?.toLowerCase().includes(filters.username.toLowerCase())) return false;
    if (filters.project && !session.projectName?.toLowerCase().includes(filters.project.toLowerCase())) return false;

    if (filters.dateFrom || filters.dateTo) {
      const sessionDate = session.timestamp ? new Date(session.timestamp) : null;
      if (!sessionDate) return false;
      if (filters.dateFrom && sessionDate < new Date(filters.dateFrom)) return false;
      if (filters.dateTo && sessionDate > new Date(filters.dateTo)) return false;
    }

    return true;
  });
}

/**
 * Sort sessions
 */
function sortSessions(sessions, field, order) {
  return [...sessions].sort((a, b) => {
    let valA = a[field];
    let valB = b[field];

    if (field === 'timestamp' || field === 'lastModified') {
      valA = valA ? new Date(valA).getTime() : 0;
      valB = valB ? new Date(valB).getTime() : 0;
    } else if (field === 'size') {
      valA = valA || 0;
      valB = valB || 0;
    } else if (typeof valA === 'string') {
      valA = valA.toLowerCase();
      valB = (valB || '').toLowerCase();
    }

    if (valA < valB) return order === 'asc' ? -1 : 1;
    if (valA > valB) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

/**
 * Get paged results for tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} type - Session type ('ssh', 'rdp', or 'all')
 * @param {number} page - Page number (1-based)
 * @param {number} pageSize - Page size
 * @param {string} searchQuery - Search query
 * @param {string} sortField - Sort field
 * @param {string} sortOrder - Sort order ('asc' or 'desc')
 * @param {Object} advancedFilters - Advanced filters
 */
async function getPagedResults(tenantId, tenantConfig, type, page, pageSize, searchQuery = '', sortField = 'timestamp', sortOrder = 'desc', advancedFilters = {}) {
  const { refreshTriggered, ...state } = await ensureIndex(tenantId, tenantConfig);

  let sessions;
  if (type === 'ssh') {
    sessions = [...state.ssh];
  } else if (type === 'rdp') {
    sessions = [...state.rdp];
  } else {
    sessions = [...state.ssh, ...state.rdp];
    sessions = sortSessions(sessions, 'timestamp', 'desc');
  }

  if (searchQuery?.trim()) {
    const query = searchQuery.toLowerCase().trim();
    sessions = sessions.filter(s => s.searchableText?.includes(query));
  }

  sessions = applyAdvancedFilters(sessions, advancedFilters);

  if (sortField !== 'timestamp' || sortOrder !== 'desc') {
    sessions = sortSessions(sessions, sortField, sortOrder);
  }

  const totalCount = sessions.length;
  const pagination = calculatePagination(totalCount, page, pageSize);
  const pagedSessions = getPageSlice(sessions, pagination.currentPage, pageSize);
  pagination.pageNumbers = getPageNumbers(pagination.currentPage, pagination.totalPages);

  return { sessions: pagedSessions, pagination, totalCount, refreshTriggered };
}

/**
 * Get stats for tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} tenantConfig - Optional tenant config with per-tenant settings
 */
function getStats(tenantId, tenantConfig = null) {
  const state = tenantIndices.get(tenantId);
  if (!state) {
    return {
      sshCount: 0,
      rdpCount: 0,
      totalCount: 0,
      lastUpdated: null,
      isBuilding: false,
      isStale: true,
      buildProgress: { current: 0, total: 0, phase: 'idle' },
    };
  }
  return {
    sshCount: state.ssh.length,
    rdpCount: state.rdp.length,
    totalCount: state.ssh.length + state.rdp.length,
    lastUpdated: state.lastUpdated,
    isBuilding: state.isBuilding,
    isStale: isStale(tenantId, tenantConfig),
    buildProgress: state.buildProgress,
  };
}

/**
 * Check if index is ready for tenant
 * @param {string} tenantId - Tenant ID
 */
function isReady(tenantId) {
  const state = tenantIndices.get(tenantId);
  return state?.lastUpdated !== null;
}

/**
 * Get unique filter options from session data
 * Extracts servers, usernames, and projects from indexed sessions
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Filter options with servers, users, projects arrays
 */
function getFilterOptions(tenantId) {
  const state = tenantIndices.get(tenantId);
  if (!state) {
    return {
      servers: [],
      users: [],
      projects: [],
    };
  }

  // Combine all sessions (ssh + rdp)
  const allSessions = [...state.ssh, ...state.rdp];

  // Extract unique values, filter out nulls/empty, and sort
  const servers = [...new Set(allSessions.map(s => s.serverName).filter(Boolean))].sort();
  const users = [...new Set(allSessions.map(s => s.username).filter(Boolean))].sort();
  const projects = [...new Set(allSessions.map(s => s.projectName).filter(Boolean))].sort();

  return {
    servers,
    users,
    projects,
  };
}

/**
 * Shutdown - save indices to database (only in multi-tenant mode)
 */
async function shutdown() {
  if (!isDatabaseEnabled()) {
    logger.info('Session index service shut down (in-memory indices discarded)');
    return;
  }

  // Save all indices to database
  for (const [tenantId, state] of tenantIndices) {
    if (state.lastUpdated) {
      await saveIndexToDatabase(tenantId, state);
    }
  }

  logger.info('Session index service shut down');
}

module.exports = {
  initialize,
  ensureIndex,
  rebuildIndex,
  getPagedResults,
  getStats,
  getRefreshStatus,
  getFilterOptions,
  isStale,
  isReady,
  shutdown,
};
