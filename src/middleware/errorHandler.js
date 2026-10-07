const { HTTP_STATUS } = require('../config/constants');
const { ERROR_MESSAGES } = require('../utils/errorMessages');

function errorHandler(logger) {
  return (err, req, res, next) => {
    // Log the error
    logger.error('Request error', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
      userId: req.session?.passport?.user?.sub,
    });

    // Determine status and message
    const status = err.status || err.statusCode || HTTP_STATUS.INTERNAL_ERROR;
    const message = err.userMessage || err.message || ERROR_MESSAGES.INTERNAL_ERROR.message;
    const code = err.code || 'INTERNAL_ERROR';

    // Don't leak internal error details in production
    const isDev = process.env.NODE_ENV !== 'production';
    const details = isDev ? err.stack : null;

    // Handle API/XHR requests
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(status).json({
        error: {
          message,
          code,
          ...(details && { details }),
        },
      });
    }

    // Render error page
    res.status(status).render('error', {
      title: 'Error',
      message,
      code,
      status,
      details,
    });
  };
}

function notFoundHandler(req, res, next) {
  res.status(HTTP_STATUS.NOT_FOUND).render('error', {
    title: 'Not Found',
    message: ERROR_MESSAGES.NOT_FOUND.message,
    code: 'NOT_FOUND',
    status: HTTP_STATUS.NOT_FOUND,
  });
}

// Application error class for consistent error handling
class AppError extends Error {
  constructor(errorKey, originalError = null) {
    const errorInfo = ERROR_MESSAGES[errorKey] || ERROR_MESSAGES.INTERNAL_ERROR;
    super(errorInfo.message);

    this.name = 'AppError';
    this.status = errorInfo.status;
    this.code = errorInfo.code;
    this.userMessage = errorInfo.message;
    this.originalError = originalError;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = {
  errorHandler,
  notFoundHandler,
  AppError,
};
