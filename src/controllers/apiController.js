/**
 * API Controller
 *
 * Handles API endpoints for fetching data from external services.
 */

const { clearCache: clearOpaApiCache } = require('../services/opaApiService');
const { clearGraphCache } = require('../services/opaGraphService');
const { rebuildIndex, getRefreshStatus, isStale, getFilterOptions: getSessionFilterOptions } = require('../services/sessionIndexService');
const { getLogger } = require('../config/logger');

/**
 * Format time ago string
 * @param {Date} date - Date to format
 * @returns {string} Human-readable time ago string
 */
function formatTimeAgo(date) {
  if (!date) return null;

  const now = new Date();
  const diffMs = now - date;
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  } else if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  } else {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  }
}

/**
 * Get filter options for dropdown population
 * Uses session data (not OPA API) for filter options
 * @route GET /api/filter-options
 */
async function getFilterOptions(req, res, next) {
  const logger = getLogger();

  try {
    const { tenantContext } = req;
    const tenantId = tenantContext.tenantId;

    // Get filter options from session index (in-memory)
    const options = getSessionFilterOptions(tenantId);

    logger.debug('Filter options fetched from sessions', {
      servers: options.servers?.length || 0,
      users: options.users?.length || 0,
      projects: options.projects?.length || 0,
    });

    res.status(200).json({
      enabled: true,
      ...options,
    });
  } catch (error) {
    logger.error('Failed to fetch filter options', {
      error: error.message,
      stack: error.stack,
    });

    // Return graceful fallback instead of error
    res.status(200).json({
      enabled: true,
      error: 'Failed to load filter options',
      servers: [],
      users: [],
      projects: [],
    });
  }
}

/**
 * Refresh sessions cache for current tenant (non-blocking)
 * @route POST /api/refresh/sessions
 */
async function refreshSessions(req, res, next) {
  const logger = getLogger();

  try {
    const { tenantContext } = req;
    const tenantId = tenantContext.tenantId;

    logger.info('Starting background session refresh', { tenantId });

    // Start rebuild in background, return immediately
    rebuildIndex(tenantId, tenantContext.config).catch(err => {
      logger.error('Background session refresh failed', { tenantId, error: err.message });
    });

    res.status(200).json({
      success: true,
      message: 'Refresh started',
    });
  } catch (error) {
    logger.error('Failed to start session refresh', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to start session refresh',
    });
  }
}

/**
 * Get refresh status for current tenant
 * @route GET /api/refresh/status
 */
async function getRefreshStatusEndpoint(req, res, next) {
  const logger = getLogger();

  try {
    const { tenantContext } = req;
    const tenantId = tenantContext.tenantId;

    const status = getRefreshStatus(tenantId, tenantContext.config);

    res.status(200).json({
      lastUpdated: status.lastUpdated,
      lastUpdatedAgo: formatTimeAgo(status.lastUpdated),
      isStale: status.isStale,
      isBuilding: status.isBuilding,
      progress: status.buildProgress,
      sessionCount: status.sessionCount,
      lastError: status.lastError,
      lastErrorTime: status.lastErrorTime,
      lastErrorAgo: formatTimeAgo(status.lastErrorTime),
    });
  } catch (error) {
    logger.error('Failed to get refresh status', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      error: 'Failed to get refresh status',
    });
  }
}

/**
 * Refresh graph cache for current tenant
 * @route POST /api/refresh/graph
 */
async function refreshGraph(req, res, next) {
  const logger = getLogger();

  try {
    const { tenantContext } = req;
    const tenantId = tenantContext.tenantId;

    logger.info('Refreshing graph cache', { tenantId });

    // Clear OPA API cache and graph cache for this tenant
    clearOpaApiCache(tenantId);
    clearGraphCache(tenantId);

    logger.info('Graph cache refreshed', { tenantId });

    res.status(200).json({
      success: true,
      message: 'Graph cache refreshed',
    });
  } catch (error) {
    logger.error('Failed to refresh graph cache', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to refresh graph cache',
    });
  }
}

module.exports = {
  getFilterOptions,
  refreshSessions,
  refreshGraph,
  getRefreshStatus: getRefreshStatusEndpoint,
};
