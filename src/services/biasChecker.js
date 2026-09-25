'use strict';

/**
 * Bias checker: flags interview questions that produce false-positive customer evidence
 * (the "Mom Test" failure modes) and suggests an unbiased rewrite.
 */

const RULES = [
  {
    type: 'leading',
    severity: 'high',
    pattern: /\b(don't you|wouldn't you|isn't it|aren't you|do you agree|surely|obviously)\b/i,
    message: 'Leading question: it signals the answer you want to hear.',
    suggestion: 'What, if anything, is difficult about this for you?',
  },
  {
    type: 'hypothetical',
    severity: 'high',
    pattern: /\b(would you|will you|could you see yourself|if (there|we|you) (was|were|had|built|made))\b/i,
    message: 'Hypothetical: people are poor predictors of their own future behaviour.',
    suggestion: 'Tell me about the last time this happened. What did you do?',
  },
  {
    type: 'pitching',
    severity: 'medium',
    pattern: /\b(our|my) (app|product|idea|solution|startup|platform|tool)\b/i,
    message: 'Pitching: mentioning your idea makes people polite instead of honest.',
    suggestion: 'How do you deal with this today, without any new product?',
  },
  {
    type: 'price_guess',
    severity: 'medium',
    pattern: /\bhow much would you (pay|spend)\b/i,
    message: 'Price guess: stated willingness to pay is unreliable.',
    suggestion: 'What have you spent on solving this in the last six months?',
  },
  {
    type: 'compound',
    severity: 'low',
    pattern: /\?.+\?|\b(and|or) (do|did|would|how|what|why)\b/i,
    message: 'Compound question: people answer only one part.',
    suggestion: 'Split this into separate questions and ask one at a time.',
  },
];

const CLOSED_START = /^(do|does|did|is|are|was|were|can|could|have|has|should)\b/i;
const CLOSED_RULE = {
  type: 'closed',
  severity: 'low',
  message: 'Yes/no question: it gives you a polite "yes" instead of a story.',
  suggestion: 'Can you walk me through how you handle this today?',
};

function checkQuestion(rawText) {
  const text = String(rawText || '').trim();
  const flags = RULES.filter((rule) => rule.pattern.test(text));
  if (CLOSED_START.test(text) && flags.length === 0) {
    flags.push(CLOSED_RULE);
  }
  return {
    text,
    ok: flags.length === 0,
    flags: flags.map(({ type, severity, message }) => ({ type, severity, message })),
    suggestion: flags.length ? flags[0].suggestion : null,
  };
}

function checkScript(questions) {
  const results = (questions || []).map((q) => ({ id: q.id, ...checkQuestion(q.text) }));
  const clean = results.filter((r) => r.ok).length;
  return {
    results,
    flagged: results.length - clean,
    score: results.length ? Math.round((100 * clean) / results.length) : 100,
  };
}

module.exports = { checkQuestion, checkScript, RULES };
