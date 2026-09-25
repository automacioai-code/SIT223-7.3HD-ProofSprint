'use strict';

/**
 * Insight synthesiser: links every interview answer to the assumption it tests, classifies it
 * as supporting or contradicting evidence, and produces an evidence score plus a recommended
 * decision. Every insight must cite at least two verbatim quotes; the founder always decides.
 */

const SUPPORT = /(frustrat|annoy|hard|difficult|struggl|pain|waste|stress|confus|expensive|slow|hate|tedious|time-consuming|can't|cannot|stuck|problem)/i;
const CONTRADICT = /(not (really )?a problem|never|easy|don't care|no issue|not bothered|rarely|doesn't matter|works fine)/i;
const STOPWORDS = new Set(
  'this that with have from they them what when were would about there their which just really because been very some then than into your much also only more like dont didnt does thing things time'.split(' '),
);
const LEVEL_POINTS = { strong: 100, moderate: 65, weak: 25, contradicted: 0 };
const MIN_INTERVIEWS = 5;

function classify(text) {
  if (CONTRADICT.test(text)) return 'contradict';
  if (SUPPORT.test(text)) return 'support';
  return 'neutral';
}

function evidenceLevel(support, contradict) {
  const total = support + contradict;
  const ratio = total ? support / total : 0;
  if (contradict > support && contradict >= 2) return 'contradicted';
  if (support >= 5 && ratio >= 0.7) return 'strong';
  if (support >= 3 && ratio >= 0.6) return 'moderate';
  return 'weak';
}

function collectAnswers(sprint, interviews) {
  const byQuestion = new Map(sprint.questions.map((q) => [q.id, q.assumptionId]));
  return interviews.flatMap((iv) =>
    iv.answers.map((a) => ({ assumptionId: byQuestion.get(a.questionId), text: a.text, alias: iv.alias, signal: classify(a.text) })),
  );
}

function summariseAssumption(assumption, answers) {
  const mine = answers.filter((a) => a.assumptionId === assumption.id);
  const support = mine.filter((a) => a.signal === 'support');
  const contradict = mine.filter((a) => a.signal === 'contradict');
  const level = evidenceLevel(support.length, contradict.length);
  const quotes = [...support, ...contradict].slice(0, 4).map((a) => ({ text: a.text, alias: a.alias, signal: a.signal }));
  return {
    ...assumption,
    evidence: { level, supporting: support.length, contradicting: contradict.length, quotes },
    insight: quotes.length >= 2 ? `${level.toUpperCase()} evidence from ${quotes.length}+ quotes` : 'Not enough evidence yet',
  };
}

function themes(answers, limit = 5) {
  const counts = new Map();
  for (const word of answers.flatMap((a) => a.text.toLowerCase().match(/[a-z']{4,}/g) || [])) {
    const clean = word.replace(/'/g, '');
    if (!STOPWORDS.has(clean)) counts.set(clean, (counts.get(clean) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function evidenceScore(assumptions, completed) {
  const weight = assumptions.reduce((sum, a) => sum + a.risk, 0);
  if (!weight) return 0;
  const raw = assumptions.reduce((sum, a) => sum + LEVEL_POINTS[a.evidence.level] * a.risk, 0) / weight;
  return Math.round(raw * Math.min(1, completed / 10));
}

function decide(assumptions, score, completed) {
  const problem = assumptions.find((a) => a.category === 'problem');
  if (problem && problem.evidence.level === 'contradicted') {
    return { decision: 'pivot', reason: 'Customers contradict the core problem assumption.' };
  }
  if (completed < MIN_INTERVIEWS) {
    return { decision: 'keep-testing', reason: `Only ${completed} completed interviews; aim for at least ${MIN_INTERVIEWS}.` };
  }
  if (score >= 70) {
    return { decision: 'persevere', reason: 'Strong, quote-backed evidence for the riskiest assumptions.' };
  }
  return { decision: 'keep-testing', reason: 'Evidence is mixed; test the weakest assumptions next.' };
}

function synthesise(sprint, interviews) {
  const done = interviews.filter((iv) => iv.status === 'complete');
  const answers = collectAnswers(sprint, interviews);
  const assumptions = sprint.assumptions.map((a) => summariseAssumption(a, answers));
  const score = evidenceScore(assumptions, done.length);
  return {
    interviews: { total: interviews.length, completed: done.length },
    evidenceScore: score,
    ...decide(assumptions, score, done.length),
    note: 'Recommendation only: the founder and their mentor make the decision.',
    themes: themes(answers),
    assumptions,
  };
}

module.exports = { synthesise, classify, evidenceLevel, evidenceScore, themes, decide };
