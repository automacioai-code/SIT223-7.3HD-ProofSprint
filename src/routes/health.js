'use strict';

const express = require('express');

/** Liveness, readiness and build-version endpoints used by Docker, Jenkins smoke tests and Prometheus. */
function healthRoutes({ config, store, metrics }) {
  const router = express.Router();
  const startedAt = Date.now();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round((Date.now() - startedAt) / 1000), version: config.version });
  });

  router.get('/ready', (req, res) => {
    const writable = store.isWritable();
    res.status(writable ? 200 : 503).json({ status: writable ? 'ready' : 'not-ready', storage: writable ? 'ok' : 'read-only' });
  });

  router.get('/version', (req, res) => {
    res.json({ version: config.version, gitSha: config.gitSha, buildNumber: config.buildNumber, environment: config.env });
  });

  router.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', metrics.register.contentType);
      res.send(await metrics.register.metrics());
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { healthRoutes };
