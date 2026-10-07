const { ROUTES, HTTP_STATUS } = require('../config/constants');
const { getUserFromSession } = require('../services/oktaService');

function ensureAuthenticated(req, res, next) {
  const user = getUserFromSession(req);

  if (!user) {
    // Store the original URL to redirect back after login
    req.session.returnTo = req.originalUrl;

    // Handle API requests differently
    if (req.xhr || req.headers.accept?.includes('application/json')) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({
        error: {
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        },
      });
    }

    return res.redirect(ROUTES.LOGIN);
  }

  // Attach user to request for convenience
  req.user = user;
  next();
}

function attachUser(req, res, next) {
  const user = getUserFromSession(req);
  if (user) {
    req.user = user;
    res.locals.user = user;
    res.locals.isAuthenticated = true;
  }
  next();
}

module.exports = {
  ensureAuthenticated,
  attachUser,
};
