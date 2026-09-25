'use strict';

const express = require('express');
const crypto = require('crypto');
const { requireAuth } = require('../middleware/auth');
const { httpError } = require('../middleware/errors');
const { mapAssumptions } = require('../services/assumptionMapper');
const { buildScript } = require('../services/scriptBuilder');
const { checkScript } = require('../services/biasChecker');
const { synthesise } = require('../services/insights');

function recordBias(metrics, bias) {
  for (const result of bias.results) {
    for (const flag of result.flags) metrics.biasFlags.inc({ type: flag.type });
  }
}

function sanitiseQuestions(questions) {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 12) {
    throw httpError(400, 'questions must be a list of 1-12 items');
  }
  return questions.map((q, i) => ({
    id: q.id || `q${i + 1}`,
    text: String(q.text || '').trim().slice(0, 300),
    assumptionId: q.assumptionId || null,
  }));
}

function createSprint(req, store, metrics) {
  const title = String(req.body.title || '').trim();
  if (!title) throw httpError(400, 'title is required');
  let assumptions;
  try {
    assumptions = mapAssumptions({ idea: req.body.idea, targetCustomer: req.body.targetCustomer });
  } catch (err) {
    throw httpError(400, err.message);
  }
  const { questions, bias } = buildScript(assumptions);
  const sprint = store.insert('sprints', {
    ownerId: req.user.sub,
    title: title.slice(0, 120),
    idea: String(req.body.idea).trim().slice(0, 2000),
    targetCustomer: String(req.body.targetCustomer || '').trim().slice(0, 120),
    status: 'draft',
    assumptions,
    questions,
    bias,
    inviteToken: crypto.randomBytes(12).toString('hex'),
  });
  metrics.sprintsCreated.inc();
  return sprint;
}

function sprintRoutes({ config, store, metrics }) {
  const router = express.Router();
  router.use(requireAuth(config));

  const ownSprint = (req) => {
    const sprint = store.findOne('sprints', (s) => s.id === req.params.id && s.ownerId === req.user.sub);
    if (!sprint) throw httpError(404, 'Sprint not found');
    return sprint;
  };
  const handle = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.post('/', handle((req, res) => res.status(201).json({ sprint: createSprint(req, store, metrics) })));

  router.get('/', handle((req, res) => {
    const sprints = store.find('sprints', (s) => s.ownerId === req.user.sub);
    res.json({ sprints: sprints.map(({ id, title, status, createdAt }) => ({ id, title, status, createdAt })) });
  }));

  router.get('/:id', handle((req, res) => res.json({ sprint: ownSprint(req) })));

  router.patch('/:id', handle((req, res) => {
    const sprint = ownSprint(req);
    const patch = {};
    if (req.body.title !== undefined) patch.title = String(req.body.title).trim().slice(0, 120) || sprint.title;
    if (req.body.questions !== undefined) {
      patch.questions = sanitiseQuestions(req.body.questions);
      patch.bias = checkScript(patch.questions);
      recordBias(metrics, patch.bias);
    }
    res.json({ sprint: store.update('sprints', sprint.id, patch) });
  }));

  router.post('/:id/launch', handle((req, res) => {
    const sprint = ownSprint(req);
    res.json({ sprint: store.update('sprints', sprint.id, { status: 'interviewing' }), inviteUrl: `/i/${sprint.inviteToken}` });
  }));

  router.get('/:id/insights', handle((req, res) => {
    const sprint = ownSprint(req);
    res.json({ insights: synthesise(sprint, store.find('interviews', (iv) => iv.sprintId === sprint.id)) });
  }));

  router.delete('/:id', handle((req, res) => {
    const sprint = ownSprint(req);
    store.find('interviews', (iv) => iv.sprintId === sprint.id).forEach((iv) => store.remove('interviews', iv.id));
    store.remove('sprints', sprint.id);
    res.status(204).end();
  }));

  return router;
}

module.exports = { sprintRoutes, sanitiseQuestions };
