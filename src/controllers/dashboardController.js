const { getStats, getPagedResults, ensureIndex } = require('../services/sessionIndexService');

/**
 * Format storage size with appropriate unit (MB, GB, or TB)
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size string
 */
function formatStorageSize(bytes) {
  const MB = 1024 * 1024;
  const GB = 1024 * MB;
  const TB = 1024 * GB;

  if (bytes >= TB) {
    return `${(bytes / TB).toFixed(2)} TB`;
  } else if (bytes >= GB) {
    return `${(bytes / GB).toFixed(2)} GB`;
  } else {
    return `${(bytes / MB).toFixed(2)} MB`;
  }
}

async function showDashboard(req, res, next) {
  try {
    const { tenantContext } = req;
    const tenantId = tenantContext.tenantId;

    // Ensure index is loaded first (this must happen before getStats)
    const indexState = await ensureIndex(tenantId, tenantContext.config);

    // Get recent sessions (all types, sorted by timestamp desc)
    const { sessions: recentSessions } = await getPagedResults(
      tenantId,
      tenantContext.config,
      'all', // all types
      1,     // page 1
      10,    // 10 recent sessions
      '',    // no search query
      'timestamp',
      'desc'
    );

    // Get stats from the session index (now that index is loaded)
    const stats = getStats(tenantId, tenantContext.config);

    // Calculate total storage from ALL sessions in the index
    const allSessions = [...(indexState.ssh || []), ...(indexState.rdp || [])];
    const totalSize = allSessions.reduce((sum, s) => sum + (s.size || 0), 0);
    const storageUsed = formatStorageSize(totalSize);

    res.render('dashboard', {
      title: 'Dashboard',
      activeTab: 'dashboard',
      pageStyles: `<link rel="stylesheet" href="${req.app.locals.assetUrl('/css/dashboard.css')}"><link rel="stylesheet" href="${req.app.locals.assetUrl('/css/sessions.css')}">`,
      totalSessions: stats.totalCount,
      sshSessions: stats.sshCount,
      rdpSessions: stats.rdpCount,
      storageUsed,
      recentSessions,
      indexLastUpdated: stats.lastUpdated,
      indexIsBuilding: stats.isBuilding,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  showDashboard,
};
