const { HTTP_STATUS } = require('../config/constants');

const ERROR_MESSAGES = {
  // S3 Errors
  S3_NO_SUCH_BUCKET: {
    message: 'Storage configuration error. Please contact administrator.',
    status: HTTP_STATUS.INTERNAL_ERROR,
    code: 'STORAGE_CONFIG_ERROR',
  },
  S3_ACCESS_DENIED: {
    message: 'Permission denied accessing storage.',
    status: HTTP_STATUS.FORBIDDEN,
    code: 'STORAGE_ACCESS_DENIED',
  },
  S3_NO_SUCH_KEY: {
    message: 'Session file not found.',
    status: HTTP_STATUS.NOT_FOUND,
    code: 'FILE_NOT_FOUND',
  },
  S3_TIMEOUT: {
    message: 'Connection to storage failed. Please try again.',
    status: HTTP_STATUS.SERVICE_UNAVAILABLE,
    code: 'STORAGE_TIMEOUT',
  },
  S3_GENERIC: {
    message: 'Storage error. Please try again later.',
    status: HTTP_STATUS.INTERNAL_ERROR,
    code: 'STORAGE_ERROR',
  },

  // AWS Authentication Errors
  AWS_ROLE_ASSUMPTION_FAILED: {
    message: 'Failed to assume AWS IAM role. Check role ARN and permissions.',
    status: HTTP_STATUS.INTERNAL_ERROR,
    code: 'AWS_ROLE_ERROR',
  },
  AWS_ROLES_ANYWHERE_FAILED: {
    message: 'Failed to authenticate with IAM Roles Anywhere. Check certificate and trust anchor configuration.',
    status: HTTP_STATUS.INTERNAL_ERROR,
    code: 'AWS_ROLES_ANYWHERE_ERROR',
  },
  AWS_CREDENTIALS_NOT_CONFIGURED: {
    message: 'AWS credentials not configured. Please configure S3 access in settings.',
    status: HTTP_STATUS.INTERNAL_ERROR,
    code: 'AWS_CREDENTIALS_MISSING',
  },

  // Auth Errors
  AUTH_REQUIRED: {
    message: 'Please log in to access this resource.',
    status: HTTP_STATUS.UNAUTHORIZED,
    code: 'AUTH_REQUIRED',
  },
  AUTH_TOKEN_EXPIRED: {
    message: 'Your session has expired. Please log in again.',
    status: HTTP_STATUS.UNAUTHORIZED,
    code: 'TOKEN_EXPIRED',
  },

  // Validation Errors
  INVALID_FILE_ID: {
    message: 'Invalid file identifier.',
    status: HTTP_STATUS.BAD_REQUEST,
    code: 'INVALID_FILE_ID',
  },
  PATH_TRAVERSAL: {
    message: 'Invalid request path.',
    status: HTTP_STATUS.BAD_REQUEST,
    code: 'INVALID_PATH',
  },

  // File Errors
  FILE_TOO_LARGE: {
    message: 'File too large. Maximum size is 500MB.',
    status: HTTP_STATUS.PAYLOAD_TOO_LARGE,
    code: 'FILE_TOO_LARGE',
  },
  DISK_SPACE_LOW: {
    message: 'Server disk space full. Please try again later.',
    status: HTTP_STATUS.INSUFFICIENT_STORAGE,
    code: 'DISK_FULL',
  },

  // Rate Limiting
  RATE_LIMITED: {
    message: 'Too many requests. Please wait before trying again.',
    status: HTTP_STATUS.TOO_MANY_REQUESTS,
    code: 'RATE_LIMITED',
  },

  // OPA API Errors
  OPA_API_UNAVAILABLE: {
    message: 'OPA API service is currently unavailable.',
    status: HTTP_STATUS.SERVICE_UNAVAILABLE,
    code: 'OPA_API_UNAVAILABLE',
  },
  OPA_API_AUTH_FAILED: {
    message: 'Failed to authenticate with OPA API.',
    status: HTTP_STATUS.UNAUTHORIZED,
    code: 'OPA_AUTH_FAILED',
  },
  OPA_API_NOT_CONFIGURED: {
    message: 'OPA API is not configured.',
    status: HTTP_STATUS.SERVICE_UNAVAILABLE,
    code: 'OPA_NOT_CONFIGURED',
  },

  // Generic Errors
  NOT_FOUND: {
    message: 'The requested resource was not found.',
    status: HTTP_STATUS.NOT_FOUND,
    code: 'NOT_FOUND',
  },
  INTERNAL_ERROR: {
    message: 'An unexpected error occurred. Please try again later.',
    status: HTTP_STATUS.INTERNAL_ERROR,
    code: 'INTERNAL_ERROR',
  },
};

function getErrorResponse(errorKey) {
  return ERROR_MESSAGES[errorKey] || ERROR_MESSAGES.INTERNAL_ERROR;
}

function mapS3Error(s3Error) {
  const errorName = s3Error.name || s3Error.code;

  switch (errorName) {
  case 'NoSuchBucket':
    return ERROR_MESSAGES.S3_NO_SUCH_BUCKET;
  case 'AccessDenied':
  case 'InvalidAccessKeyId':
  case 'SignatureDoesNotMatch':
    return ERROR_MESSAGES.S3_ACCESS_DENIED;
  case 'NoSuchKey':
  case 'NotFound':
    return ERROR_MESSAGES.S3_NO_SUCH_KEY;
  case 'TimeoutError':
  case 'NetworkingError':
  case 'ECONNREFUSED':
  case 'ETIMEDOUT':
    return ERROR_MESSAGES.S3_TIMEOUT;
  default:
    return ERROR_MESSAGES.S3_GENERIC;
  }
}

module.exports = {
  ERROR_MESSAGES,
  getErrorResponse,
  mapS3Error,
};
