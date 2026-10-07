const express = require('express');
const { getHealthStatus } = require('../controllers/healthController');

function createHealthRoutes() {
  const router = express.Router();

  // Health check endpoint - no authentication required
  router.get('/', getHealthStatus);

  return router;
}

module.exports = { createHealthRoutes };
