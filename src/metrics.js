'use strict';

const client = require('prom-client');

/**
 * Prometheus metrics: RED metrics for every HTTP route (rate, errors, duration), Node.js
 * process metrics (CPU, memory, event-loop lag) and ProofSprint business metrics.
 */

function routeLabel(req) {
  if (req.route && req.route.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  return req.path.startsWith('/api') ? 'unmatched_api' : 'static';
}

function createMetrics({ version, gitSha, env }) {
  const register = new client.Registry();
  client.collectDefaultMetrics({ register });

  const labelNames = ['method', 'route', 'status'];
  const httpRequests = new client.Counter({
    name: 'http_requests_total',
    help: 'HTTP requests handled, by method, route and status code',
    labelNames,
    registers: [register],
  });
  const httpDuration = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
    registers: [register],
  });

  const counter = (name, help, extra = {}) => new client.Counter({ name, help, registers: [register], ...extra });
  const business = {
    usersRegistered: counter('proofsprint_users_registered_total', 'Founder accounts created'),
    sprintsCreated: counter('proofsprint_sprints_created_total', 'Validation sprints created'),
    interviewsStarted: counter('proofsprint_interviews_started_total', 'Customer interviews started'),
    interviewsCompleted: counter('proofsprint_interviews_completed_total', 'Customer interviews completed'),
    answersRecorded: counter('proofsprint_answers_recorded_total', 'Interview answers recorded'),
    biasFlags: counter('proofsprint_bias_flags_total', 'Biased interview questions detected', { labelNames: ['type'] }),
  };

  const appInfo = new client.Gauge({
    name: 'proofsprint_app_info',
    help: 'Build information for the running ProofSprint instance',
    labelNames: ['version', 'git_sha', 'app_env'],
    registers: [register],
  });
  appInfo.set({ version, git_sha: gitSha, app_env: env }, 1);

  const chaosActive = new client.Gauge({
    name: 'proofsprint_chaos_active',
    help: '1 while an incident simulation (chaos mode) is active',
    registers: [register],
  });

  function middleware(req, res, next) {
    const stop = httpDuration.startTimer();
    res.on('finish', () => {
      const labels = { method: req.method, route: routeLabel(req), status: String(res.statusCode) };
      httpRequests.inc(labels);
      stop(labels);
    });
    next();
  }

  return { register, middleware, chaosActive, ...business };
}

module.exports = { createMetrics, routeLabel };
