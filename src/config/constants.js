module.exports = {
  // Session types
  SESSION_TYPES: {
    SSH: 'ssh',
    RDP: 'rdp',
  },

  // File extensions
  FILE_EXTENSIONS: {
    SSH: '.cast',
    RDP: '.mkv',
  },

  // S3 prefixes (adjust based on your bucket structure)
  // OPA session files use tilde (~) separator in filenames at bucket root
  S3_PREFIXES: {
    SSH: 'ssh~',
    RDP: 'rdp~',
  },

  // Rate limit windows (in milliseconds)
  RATE_LIMIT: {
    WINDOW_MS: 60 * 1000, // 1 minute
    LIST_MAX: 100,
    DOWNLOAD_MAX: 100,
  },

  // OPA API settings
  OPA_API: {
    CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
    TIMEOUT_MS: 30000, // 30 seconds
    MAX_RETRIES: 2,
  },

  // Routes
  ROUTES: {
    HOME: '/',
    LOGIN: '/login',
    LOGOUT: '/logout',
    CALLBACK: '/authorization-code/callback',
    HEALTH: '/health',
    GRAPH: '/graph',
    CONFIG: '/config',
    SESSIONS: {
      BASE: '/sessions',
      LIST: '/sessions/list',
      PLAYBACK_SSH: '/sessions/playback/ssh',
      PLAYBACK_RDP: '/sessions/playback/rdp',
    },
    API: {
      BASE: '/api',
      OPA_FILTER_OPTIONS: '/api/opa/filter-options',
    },
  },

  // HTTP Status Codes
  HTTP_STATUS: {
    OK: 200,
    MOVED_PERMANENTLY: 301,
    FOUND: 302,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    PAYLOAD_TOO_LARGE: 413,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_ERROR: 500,
    SERVICE_UNAVAILABLE: 503,
    INSUFFICIENT_STORAGE: 507,
  },

  // File ID validation pattern (prevent path traversal)
  // Allows: letters, numbers, tilde, hyphen, period, underscore
  FILE_ID_PATTERN: /^[a-zA-Z0-9~_\-.]+$/,

  // Health check
  HEALTH_STATUS: {
    HEALTHY: 'healthy',
    DEGRADED: 'degraded',
    OK: 'ok',
    WARNING: 'warning',
  },
};
