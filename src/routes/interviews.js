'use strict';

const express = require('express');
const { httpError } = require('../middleware/errors');
const { startInterview, recordAnswer, nextQuestion } = require('../services/interviewEngine');

const CONSENT_TEXT =
  'This 5-minute chat interview helps a student founder understand a real problem. Your answers are stored ' +
  'without your name, only the founder sees them, and you can stop at any time.';

/** Public, token-protected participant flow: no account needed, no founder details exposed. */
function interviewRoutes({ store, metrics }) {
  const router = express.Router();

  const sprintFor = (token) => {
    const sprint = store.findOne('sprints', (s) => s.inviteToken === token);
    if (!sprint) throw httpError(404, 'Interview link not found');
    return sprint;
  };
  const handle = (fn) => (req, res, next) => {
    try {
      fn(req, res);
    } catch (err) {
      next(err);
    }
  };

  router.get('/:token', handle((req, res) => {
    const sprint = sprintFor(req.params.token);
    res.json({ title: sprint.title, open: sprint.status === 'interviewing', questions: sprint.questions.length, consent: CONSENT_TEXT });
  }));

  router.post('/:token/start', handle((req, res) => {
    const sprint = sprintFor(req.params.token);
    const interview = store.insert('interviews', startInterview(sprint, req.body));
    metrics.interviewsStarted.inc();
    res.status(201).json({ interviewId: interview.id, question: nextQuestion(sprint, interview) });
  }));

  router.post('/:token/:interviewId/answer', handle((req, res) => {
    const sprint = sprintFor(req.params.token);
    const current = store.findOne('interviews', (iv) => iv.id === req.params.interviewId && iv.sprintId === sprint.id);
    if (!current) throw httpError(404, 'Interview not found');
    const { interview, next } = recordAnswer(sprint, current, req.body.text);
    store.update('interviews', current.id, interview);
    metrics.answersRecorded.inc();
    if (!next) metrics.interviewsCompleted.inc();
    res.json({ done: !next, question: next });
  }));

  return router;
}

module.exports = { interviewRoutes, CONSENT_TEXT };
