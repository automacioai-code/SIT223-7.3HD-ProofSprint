'use strict';

const { checkScript } = require('./biasChecker');

/**
 * Builds a Mom-Test style interview script for the riskiest assumptions: questions about
 * past behaviour, never about the founder's idea.
 */

const TEMPLATES = {
  problem: ['Tell me about the last time you ran into this problem.', 'What was the hardest part of that?'],
  frequency: ['How often does this come up for you?', 'What triggered it the last time it happened?'],
  value: ['What have you tried or paid for to solve this?', 'What did that cost you in time or money?'],
  customer: ['Who else is involved when this happens?', 'Who do you usually ask for help with this?'],
  solution: ['How do you handle this today?', 'What do you like and dislike about that approach?'],
  channel: ['Where do you usually look for advice about this?', 'How did you find the tools you use now?'],
};
const OPENING = { text: 'To start, what do you currently spend most of your week working on?', assumptionId: null };
const CLOSING = { text: 'What else should I have asked you about this?', assumptionId: null };
const MAX_QUESTIONS = 8;

function buildScript(assumptions, { focus = 3 } = {}) {
  const riskiest = (assumptions || []).slice(0, focus);
  const body = riskiest.flatMap((a) => (TEMPLATES[a.category] || []).map((text) => ({ text, assumptionId: a.id })));
  const questions = [OPENING, ...body.slice(0, MAX_QUESTIONS - 2), CLOSING].map((q, i) => ({ id: `q${i + 1}`, ...q }));
  return { questions, bias: checkScript(questions) };
}

module.exports = { buildScript, TEMPLATES, MAX_QUESTIONS };
