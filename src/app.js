'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const { createMetrics } = require('./metrics');
const { createChaos } = require('./middleware/chaos');
const { notFound, errorHandler } = require('./middleware/errors');
const { healthRoutes } = require('./routes/health');
const { authRoutes } = require('./routes/auth');
const { sprintRoutes } = require('./routes/sprints');
const { interviewRoutes } = require('./routes/interviews');
const { toolRoutes } = require('./routes/tools');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const QUIET_PATHS = new Set(['/health', '/ready', '/metrics']);

function createApp({ config, store, logger }) {
  const metrics = createMetrics({ version: config.version, gitSha: config.gitSha, env: config.env });
  const chaos = createChaos({ chaosKey: config.chaosKey, metrics });
  const deps = { config, store, metrics, logger };
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => QUIET_PATHS.has(req.url) } }));
  app.use(express.json({ limit: '100kb' }));
  app.use(metrics.middleware);
  app.use(chaos.middleware);

  app.use(healthRoutes(deps));
  app.use('/api/auth', authRoutes(deps));
  app.use('/api/sprints', sprintRoutes(deps));
  app.use('/api/interviews', interviewRoutes(deps));
  app.use('/api/tools', toolRoutes(deps));
  app.use('/api/admin/chaos', chaos.router);
  app.use('/api', notFound);

  app.get('/i/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'interview.html')));
  app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));
  app.use(notFound);
  app.use(errorHandler(logger));

  app.locals.metrics = metrics;
  app.locals.chaos = chaos;
  return app;
}

module.exports = { createApp };
