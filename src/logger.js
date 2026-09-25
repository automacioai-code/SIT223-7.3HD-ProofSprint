'use strict';

const pino = require('pino');

/** Structured JSON logs (one line per event) so they can be shipped to any log platform. */
function createLogger(config) {
  return pino({
    level: config.logLevel,
    base: { app: 'proofsprint', env: config.env, version: config.version },
    redact: ['req.headers.authorization', 'req.headers["x-chaos-key"]', 'password'],
  });
}

module.exports = { createLogger };
