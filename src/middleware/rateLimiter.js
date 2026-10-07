const rateLimit = require('express-rate-limit');
const { RATE_LIMIT, HTTP_STATUS } = require('../config/constants');
const { ERROR_MESSAGES } = require('../utils/errorMessages');

// Key generator using user ID from session
function keyGenerator(req) {
  const userId = req.session?.passport?.user?.sub || req.ip;
  return userId;
}

// Create rate limiter for listing sessions
const listRateLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.LIST_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: (req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).render('error', {
      title: 'Rate Limited',
      message: ERROR_MESSAGES.RATE_LIMITED.message,
      code: ERROR_MESSAGES.RATE_LIMITED.code,
    });
  },
});

// Create rate limiter for downloads/playback
const downloadRateLimiter = rateLimit({
  windowMs: RATE_LIMIT.WINDOW_MS,
  max: RATE_LIMIT.DOWNLOAD_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  handler: (req, res) => {
    res.status(HTTP_STATUS.TOO_MANY_REQUESTS).render('error', {
      title: 'Rate Limited',
      message: ERROR_MESSAGES.RATE_LIMITED.message,
      code: ERROR_MESSAGES.RATE_LIMITED.code,
    });
  },
});

module.exports = {
  listRateLimiter,
  downloadRateLimiter,
};
