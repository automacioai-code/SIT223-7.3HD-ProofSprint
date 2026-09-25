'use strict';

const express = require('express');
const crypto = require('crypto');

/**
 * Incident simulation ("chaos mode") used by the Monitoring stage to prove that alerting works.
 * Disabled unless CHAOS_KEY is set; every call must present the key in the X-Chaos-Key header.
 * While active, /api/* requests fail (errors) or slow down (latency) until the window expires.
 */

const MODES = ['off', 'errors', 'latency'];
const MAX_SECONDS = 300;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function createChaos({ chaosKey, metrics, now = () => Date.now() }) {
  let state = { mode: 'off', until: 0 };

  function current() {
    if (state.mode !== 'off' && now() >= state.until) {
      state = { mode: 'off', until: 0 };
    }
    metrics.chaosActive.set(state.mode === 'off' ? 0 : 1);
    return state;
  }

  function middleware(req, res, next) {
    const { mode } = current();
    if (mode === 'off' || !req.path.startsWith('/api/') || req.path.startsWith('/api/admin/')) {
      return next();
    }
    if (mode === 'errors') {
      return res.status(500).json({ error: 'Simulated failure (incident simulation)' });
    }
    return setTimeout(next, 1200);
  }

  function authorise(req, res, next) {
    if (!chaosKey) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!safeEqual(req.get('x-chaos-key') || '', chaosKey)) {
      return res.status(403).json({ error: 'Invalid chaos key' });
    }
    return next();
  }

  const router = express.Router();
  router.use(authorise);
  router.get('/', (req, res) => res.json(current()));
  router.post('/', (req, res) => {
    const mode = String(req.body.mode || 'off');
    if (!MODES.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of ${MODES.join(', ')}` });
    }
    const seconds = Math.min(MAX_SECONDS, Math.max(1, Number(req.body.durationSeconds) || 60));
    state = mode === 'off' ? { mode, until: 0 } : { mode, until: now() + seconds * 1000 };
    return res.json(current());
  });

  return { middleware, router, current };
}

module.exports = { createChaos, MODES };
