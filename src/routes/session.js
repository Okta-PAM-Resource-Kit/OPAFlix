const express = require('express');
const { ensureAuthenticated } = require('../middleware/authentication');
const { listRateLimiter, downloadRateLimiter } = require('../middleware/rateLimiter');
const {
  listSessions,
  playbackSsh,
  playbackRdp,
} = require('../controllers/sessionController');

function createSessionRoutes() {
  const router = express.Router();

  // All routes require authentication
  router.use(ensureAuthenticated);

  // Unified sessions list
  router.get('/list', listRateLimiter, listSessions);

  // Playback routes (videos stream directly from S3 via presigned URLs)
  router.get('/playback/ssh', downloadRateLimiter, playbackSsh);
  router.get('/playback/rdp', downloadRateLimiter, playbackRdp);

  return router;
}

module.exports = { createSessionRoutes };
