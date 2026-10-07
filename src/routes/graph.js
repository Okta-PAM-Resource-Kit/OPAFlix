/**
 * Graph Routes
 *
 * Routes for the infrastructure graph visualization using ReactFlow.
 */

const express = require('express');
const { ensureAuthenticated } = require('../middleware/authentication');
const { listRateLimiter } = require('../middleware/rateLimiter');
const { showGraph } = require('../controllers/graphController');

/**
 * Create graph routes
 * @returns {Router} Express router
 */
function createGraphRoutes() {
  const router = express.Router();

  // Apply authentication middleware
  router.use(ensureAuthenticated);

  // Graph page
  router.get('/', listRateLimiter, showGraph);

  return router;
}

module.exports = { createGraphRoutes };
