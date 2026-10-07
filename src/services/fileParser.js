/**
 * Parse OPA session filenames to extract metadata
 *
 * Filename format (tilde-separated):
 * {type}~{datetime}~{teamName}~{projectName}~{serverName}~{username}~{hash}.{ext}
 *
 * Fields:
 * 1. Type: ssh or rdp
 * 2. DateTime: 20260313T112035.8319
 * 3. Team Name: demo-pam-fg
 * 4. Project Name: internet_facing_servers
 * 5. Server Name: opa-gateway
 * 6. Username: fabio.grasso
 * 7. Hash/Signature: -1-69b3f302-1537841959aeb6570b15eb85
 *
 * Example: ssh~20260313T112035.8319~demo-pam-fg~internet_facing_servers~opa-gateway~fabio.grasso~-1-69b3f302-1537841959aeb6570b15eb85.cast
 */

const { FILE_EXTENSIONS } = require('../config/constants');

function parseSessionFilename(filename) {
  if (!filename) {
    return null;
  }

  // Remove path if present
  const basename = filename.split('/').pop();

  // Determine session type from extension
  let type = null;
  let extension = null;

  if (basename.endsWith(FILE_EXTENSIONS.SSH)) {
    type = 'ssh';
    extension = FILE_EXTENSIONS.SSH;
  } else if (basename.endsWith(FILE_EXTENSIONS.RDP)) {
    type = 'rdp';
    extension = FILE_EXTENSIONS.RDP;
  } else {
    return null;
  }

  // Remove extension
  const nameWithoutExt = basename.slice(0, -extension.length);

  // Split by tilde delimiter
  const parts = nameWithoutExt.split('~');

  // Expected: [type, datetime, teamName, projectName, serverName, username, hash]
  if (parts.length < 7) {
    // Return partial metadata if we can't fully parse
    return {
      type,
      timestamp: null,
      projectName: null,
      serverName: null,
      username: null,
    };
  }

  // Parse datetime (format: 20260313T112035.8319)
  const dateTimeStr = parts[1];
  let timestamp = null;
  let displayDateTime = dateTimeStr;

  try {
    // Parse format: 20260313T112035.8319
    const match = dateTimeStr.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.?(\d+)?$/);
    if (match) {
      const [, year, month, day, hour, minute, second] = match;
      timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
      if (isNaN(timestamp.getTime())) {
        timestamp = null;
      }
    }
  } catch {
    timestamp = null;
  }

  return {
    type: parts[0].toLowerCase(),
    timestamp,
    projectName: parts[3] || null,
    serverName: parts[4] || null,
    username: parts[5] || null,
  };
}

function enrichSessionWithMetadata(session) {
  const parsed = parseSessionFilename(session.key);

  return {
    ...session,
    ...parsed,
    // Derived fields (computed on load, not stored)
    fileId: session.key,
    displayTimestamp: parsed?.timestamp
      ? formatDateTime(parsed.timestamp)
      : session.lastModified
        ? formatDateTime(session.lastModified)
        : 'Unknown',
    displaySize: formatFileSize(session.size),
  };
}

/**
 * Extract minimal fields for database storage
 * Removes derived/redundant fields to reduce storage size
 */
function toStorageFormat(session) {
  return {
    key: session.key,
    type: session.type,
    size: session.size,
    timestamp: session.timestamp,
    lastModified: session.lastModified,
    serverName: session.serverName,
    username: session.username,
    projectName: session.projectName,
  };
}

function formatDateTime(date) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    return 'Unknown';
  }

  // Format: YYYY-MM-DD HH:mm:ss
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function formatFileSize(bytes) {
  if (!bytes) return 'Unknown';

  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function sortSessionsByDate(sessions, order = 'desc') {
  return [...sessions].sort((a, b) => {
    const dateA = a.timestamp || a.lastModified || new Date(0);
    const dateB = b.timestamp || b.lastModified || new Date(0);

    if (order === 'desc') {
      return dateB - dateA;
    }
    return dateA - dateB;
  });
}

/**
 * Filter sessions by search query
 * Searches across: serverName, username, projectName, type
 */
function filterSessions(sessions, query) {
  if (!query || query.trim() === '') {
    return sessions;
  }

  const searchTerm = query.toLowerCase().trim();

  return sessions.filter(session => {
    const searchableFields = [
      session.serverName,
      session.username,
      session.projectName,
      session.type,
    ];

    return searchableFields.some(field =>
      field && field.toLowerCase().includes(searchTerm)
    );
  });
}

/**
 * Sort sessions by a specific field
 */
function sortSessionsByField(sessions, field, order = 'asc') {
  return [...sessions].sort((a, b) => {
    let valA = a[field];
    let valB = b[field];

    // Handle date fields
    if (field === 'timestamp' || field === 'lastModified') {
      valA = valA ? new Date(valA).getTime() : 0;
      valB = valB ? new Date(valB).getTime() : 0;
    }

    // Handle numeric fields
    if (field === 'size') {
      valA = valA || 0;
      valB = valB || 0;
    }

    // Handle string fields
    if (typeof valA === 'string') valA = valA.toLowerCase();
    if (typeof valB === 'string') valB = valB.toLowerCase();

    if (valA < valB) return order === 'asc' ? -1 : 1;
    if (valA > valB) return order === 'asc' ? 1 : -1;
    return 0;
  });
}

module.exports = {
  parseSessionFilename,
  enrichSessionWithMetadata,
  toStorageFormat,
  formatFileSize,
  formatDateTime,
  sortSessionsByDate,
  filterSessions,
  sortSessionsByField,
};
