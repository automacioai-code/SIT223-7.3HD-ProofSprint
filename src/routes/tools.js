'use strict';

const express = require('express');
const { checkQuestion } = require('../services/biasChecker');
const { httpError } = require('../middleware/errors');

/** Public "try it" endpoint used by the landing page: check one interview question for bias. */
function toolRoutes({ metrics }) {
  const router = express.Router();
  router.post('/bias-check', (req, res, next) => {
    const question = String(req.body.question || '').trim();
    if (!question || question.length > 300) {
      return next(httpError(400, 'question must be 1-300 characters'));
    }
    const result = checkQuestion(question);
    result.flags.forEach((flag) => metrics.biasFlags.inc({ type: flag.type }));
    return res.json(result);
  });
  return router;
}

module.exports = { toolRoutes };
