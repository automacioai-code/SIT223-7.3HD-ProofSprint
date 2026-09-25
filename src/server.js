'use strict';

const { loadConfig } = require('./config');
const { createStore } = require('./store');
const { createLogger } = require('./logger');
const { createApp } = require('./app');

const config = loadConfig();
const logger = createLogger(config);
const store = createStore({ dataDir: config.dataDir });
const app = createApp({ config, store, logger });

const server = app.listen(config.port, config.host, () => {
  logger.info({ host: config.host, port: config.port, version: config.version, gitSha: config.gitSha }, 'ProofSprint started');
});

function shutdown(signal) {
  logger.info({ signal }, 'Shutting down gracefully');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
