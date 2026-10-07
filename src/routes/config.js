/**
 * Configuration Routes
 *
 * Routes for viewing and editing tenant configuration.
 */

const express = require('express');
const { ensureAuthenticated } = require('../middleware/authentication');
const { showConfig, updateConfig } = require('../controllers/configController');

function createConfigRoutes() {
  const router = express.Router();

  // All config routes require authentication
  router.use(ensureAuthenticated);

  // GET /config - Display configuration form
  router.get('/', showConfig);

  // POST /config - Update configuration
  router.post('/', updateConfig);

  return router;
}

module.exports = { createConfigRoutes };
