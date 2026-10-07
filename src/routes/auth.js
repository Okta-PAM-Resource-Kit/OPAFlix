const express = require('express');
const { ROUTES } = require('../config/constants');
const { getOIDCForTenant } = require('../services/oktaService');

function createAuthRoutes(logger, config) {
  const router = express.Router();

  // Login route is handled by OIDC middleware automatically (dynamicOIDCRouter)
  // The ExpressOIDC middleware registers /login

  // Post-login redirect handler - redirects to original URL stored before login
  router.get('/auth/redirect', (req, res) => {
    let returnTo = req.session?.returnTo;
    const user = req.session?.passport?.user;

    // Validate returnTo to prevent open redirect attacks
    // Only allow relative paths starting with /
    if (!returnTo || !returnTo.startsWith('/') || returnTo.startsWith('//')) {
      returnTo = ROUTES.HOME;
    }

    // Clear returnTo to prevent reuse
    if (req.session) {
      delete req.session.returnTo;
    }

    logger.debug('User authenticated via OIDC', {
      email: user?.email,
      name: user?.name,
      sub: user?.sub,
      returnTo,
    });
    res.redirect(returnTo);
  });

  // Logout route (POST to prevent CSRF attacks)
  router.post(ROUTES.LOGOUT, (req, res, next) => {
    const user = req.session?.passport?.user;
    const idToken = user?.id_token || req.session?.['oidc:session']?.id_token;
    const tenantName = req.session?.selectedTeam || req.session?.oidcTenant;

    logger.info('User logout initiated', { userId: user?.sub, email: user?.email, tenant: tenantName });

    // Build the Okta logout URL before destroying the session
    let oktaLogoutUrl = null;

    // Get the OIDC instance for this tenant
    const oidc = tenantName ? getOIDCForTenant(tenantName) : null;
    const endSessionEndpoint = oidc?.client?.issuer?.metadata?.end_session_endpoint;

    if (endSessionEndpoint && idToken) {
      const logoutUrl = new URL(endSessionEndpoint);
      const postLogoutUri = `${config.app.baseUri}${ROUTES.LOGIN}`;
      logoutUrl.searchParams.set('id_token_hint', idToken);
      logoutUrl.searchParams.set('post_logout_redirect_uri', postLogoutUri);
      oktaLogoutUrl = logoutUrl.toString();
      logger.info('Okta logout URL constructed', { url: oktaLogoutUrl });
    } else {
      logger.warn('Unable to construct Okta logout URL', {
        hasEndpoint: !!endSessionEndpoint,
        hasIdToken: !!idToken,
        hasTenant: !!tenantName,
      });
    }

    // Clear the session
    req.session.destroy((err) => {
      if (err) {
        logger.error('Session destroy error', { error: err.message });
      }

      // Clear all possible session cookies
      res.clearCookie('connect.sid');
      res.clearCookie('connect.sid', { path: '/' });

      // Note: OIDC session data is stored within the Express session (connect.sid),
      // not as a separate cookie. The 'oidc:session' is a session key, not a cookie.

      logger.info('Session destroyed, redirecting user');

      // Redirect to Okta logout to terminate SSO session
      if (oktaLogoutUrl) {
        return res.redirect(oktaLogoutUrl);
      }

      // Fallback: redirect to login page
      res.redirect(ROUTES.LOGIN);
    });
  });

  return router;
}

module.exports = { createAuthRoutes };
