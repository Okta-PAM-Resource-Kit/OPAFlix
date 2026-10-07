const { getSessionMetadata, getPresignedUrl } = require('../services/s3Service');
const { enrichSessionWithMetadata } = require('../services/fileParser');
const { validateFileId, isPathTraversal } = require('../utils/validation');
const { AppError } = require('../middleware/errorHandler');
const { S3_PREFIXES, FILE_EXTENSIONS, ROUTES } = require('../config/constants');
const { validatePaginationParams } = require('../utils/paginationHelper');
const sessionIndexService = require('../services/sessionIndexService');

/**
 * Extract advanced filter parameters from query string
 * @param {object} query - Express query object
 * @returns {object} Advanced filters object
 */
function extractAdvancedFilters(query) {
  const filters = {
    server: query.server || '',
    username: query.username || '',
    project: query.project || '',
    dateFrom: query.dateFrom || '',
    dateTo: query.dateTo || '',
    type: query.type || '', // 'ssh', 'rdp', or '' (all)
  };

  // Format dates for display
  if (filters.dateFrom) {
    filters.dateFromDisplay = formatDateForDisplay(filters.dateFrom);
  }
  if (filters.dateTo) {
    filters.dateToDisplay = formatDateForDisplay(filters.dateTo);
  }

  return filters;
}

/**
 * Format datetime-local value for display
 * @param {string} dateStr - datetime-local format string
 * @returns {string} Formatted date string
 */
function formatDateForDisplay(dateStr) {
  try {
    const date = new Date(dateStr);
    return date.toLocaleString();
  } catch {
    return dateStr;
  }
}

/**
 * Check if any advanced filters are active (excluding type filter)
 * @param {object} filters - Advanced filters object
 * @param {string} searchQuery - Simple search query
 * @returns {boolean}
 */
function hasActiveFilters(filters, searchQuery) {
  return !!(
    searchQuery ||
    filters.server ||
    filters.username ||
    filters.project ||
    filters.dateFrom ||
    filters.dateTo
  );
}

/**
 * Get page title based on type filter
 * @param {string} type - 'ssh', 'rdp', or '' (all)
 * @returns {string} Page title
 */
function getPageTitle(type) {
  switch (type) {
  case 'ssh': return 'SSH Sessions';
  case 'rdp': return 'RDP Sessions';
  default: return 'All Sessions';
  }
}

/**
 * Get active tab based on type filter
 * @param {string} type - 'ssh', 'rdp', or '' (all)
 * @returns {string} Active tab identifier
 */
function getActiveTab(type) {
  switch (type) {
  case 'ssh': return 'ssh';
  case 'rdp': return 'rdp';
  default: return 'all';
  }
}

/**
 * Unified session list handler
 */
async function listSessions(req, res, next) {
  try {
    const { tenantContext } = req;
    const { page, pageSize } = validatePaginationParams(req.query.page, req.query.pageSize, tenantContext.config);
    const searchQuery = req.query.q || '';

    // Validate sortField against allowed values to prevent injection
    const allowedSortFields = ['timestamp', 'type', 'serverName', 'username', 'projectName', 'size'];
    const sortField = allowedSortFields.includes(req.query.sort) ? req.query.sort : 'timestamp';

    // Validate sortOrder against allowed values
    const sortOrder = ['asc', 'desc'].includes(req.query.order) ? req.query.order : 'desc';

    const advancedFilters = extractAdvancedFilters(req.query);
    const typeFilter = advancedFilters.type;

    const result = await sessionIndexService.getPagedResults(
      tenantContext.tenantId, tenantContext.config, typeFilter || 'all', page, pageSize, searchQuery, sortField, sortOrder, advancedFilters
    );

    res.render('sessions/list', {
      title: getPageTitle(typeFilter),
      activeTab: getActiveTab(typeFilter),
      pageStyles: `<link rel="stylesheet" href="${req.app.locals.assetUrl('/css/sessions.css')}">`,
      sessions: result.sessions,
      pagination: result.pagination,
      searchQuery,
      sortField,
      sortOrder,
      totalCount: result.totalCount,
      advancedFilters,
      hasActiveFilters: hasActiveFilters(advancedFilters, searchQuery),
      typeFilter,
      // URLs for playback
      playbackSshUrl: ROUTES.SESSIONS.PLAYBACK_SSH,
      playbackRdpUrl: ROUTES.SESSIONS.PLAYBACK_RDP,
      // Signal to frontend that a background refresh was triggered
      isRefreshing: result.refreshTriggered || false,
    });
  } catch (error) {
    next(error);
  }
}

async function playbackSsh(req, res, next) {
  try {
    const { tenantContext } = req;
    const { fileId } = req.query;

    // Validate file ID
    if (!fileId) {
      throw new AppError('INVALID_FILE_ID');
    }

    const validation = validateFileId(fileId);
    if (!validation.valid) {
      throw new AppError('INVALID_FILE_ID');
    }

    if (isPathTraversal(fileId)) {
      throw new AppError('PATH_TRAVERSAL');
    }

    // Ensure it's a valid SSH file (starts with ssh~ prefix and ends with .cast)
    if (!fileId.startsWith(S3_PREFIXES.SSH) || !fileId.endsWith(FILE_EXTENSIONS.SSH)) {
      throw new AppError('INVALID_FILE_ID');
    }

    // fileId is the full S3 key
    const s3Key = fileId;

    // Check metadata first
    const metadata = await getSessionMetadata(tenantContext.config, s3Key);

    // Check file size limit (from app config)
    const appConfig = req.app.get('config');
    if (metadata.size > appConfig.file.sizeLimitBytes) {
      throw new AppError('FILE_TOO_LARGE');
    }

    // Generate presigned URL for direct S3 access
    const castUrl = await getPresignedUrl(tenantContext.config, s3Key);

    // Parse session metadata from filename
    const sessionInfo = enrichSessionWithMetadata({ fileId, key: s3Key, size: metadata.size });

    // Generate download filename: {server}_{user}_{timestamp}.cast
    const downloadFilename = `${sessionInfo.serverName || 'session'}_${sessionInfo.username || 'unknown'}_${sessionInfo.datetime || 'recording'}.cast`
      .replace(/[^a-zA-Z0-9_.-]/g, '_'); // Sanitize filename

    res.render('sessions/playbackSsh', {
      title: `SSH Session - ${sessionInfo.serverName || fileId}`,
      activeTab: 'ssh',
      pageStyles: `<link rel="stylesheet" href="${req.app.locals.assetUrl('/css/sessions.css')}">`,
      session: { ...sessionInfo, downloadFilename },
      castUrl,
    });
  } catch (error) {
    next(error);
  }
}

async function playbackRdp(req, res, next) {
  try {
    const { tenantContext } = req;
    const { fileId } = req.query;

    // Validate file ID
    if (!fileId) {
      throw new AppError('INVALID_FILE_ID');
    }

    const validation = validateFileId(fileId);
    if (!validation.valid) {
      throw new AppError('INVALID_FILE_ID');
    }

    if (isPathTraversal(fileId)) {
      throw new AppError('PATH_TRAVERSAL');
    }

    // Ensure it's a valid RDP file (starts with rdp~ prefix and ends with .mkv)
    if (!fileId.startsWith(S3_PREFIXES.RDP) || !fileId.endsWith(FILE_EXTENSIONS.RDP)) {
      throw new AppError('INVALID_FILE_ID');
    }

    // fileId is the full S3 key
    const s3Key = fileId;

    // Check metadata
    const metadata = await getSessionMetadata(tenantContext.config, s3Key);

    // Check file size limit (from app config)
    const appConfig = req.app.get('config');
    if (metadata.size > appConfig.file.sizeLimitBytes) {
      throw new AppError('FILE_TOO_LARGE');
    }

    // Generate presigned URL for direct S3 access
    const videoUrl = await getPresignedUrl(tenantContext.config, s3Key);

    // Parse session metadata from filename
    const sessionInfo = enrichSessionWithMetadata({ fileId, key: s3Key, size: metadata.size });

    // Generate download filename: {server}_{user}_{timestamp}.mkv
    const downloadFilename = `${sessionInfo.serverName || 'session'}_${sessionInfo.username || 'unknown'}_${sessionInfo.datetime || 'recording'}.mkv`
      .replace(/[^a-zA-Z0-9_.-]/g, '_'); // Sanitize filename

    res.render('sessions/playbackRdp', {
      title: `RDP Session - ${sessionInfo.serverName || fileId}`,
      activeTab: 'rdp',
      pageStyles: `<link rel="stylesheet" href="${req.app.locals.assetUrl('/css/sessions.css')}">`,
      session: { ...sessionInfo, downloadFilename },
      videoUrl,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listSessions,
  playbackSsh,
  playbackRdp,
};
