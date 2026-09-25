'use strict';

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function notFound(req, res) {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
}

function errorHandler(logger) {
  // Express identifies error handlers by their four arguments.
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, next) => {
    const status = err.type === 'entity.parse.failed' ? 400 : err.status || 500;
    if (status >= 500) {
      logger.error({ err, path: req.path }, 'Unhandled error');
    }
    res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
  };
}

module.exports = { httpError, notFound, errorHandler };
