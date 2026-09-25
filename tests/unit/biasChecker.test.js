'use strict';

const { checkQuestion, checkScript } = require('../../src/services/biasChecker');

describe('biasChecker.checkQuestion', () => {
  test.each([
    ['Would you use an app that plans your study week?', 'hypothetical'],
    ["Don't you think group assignments are stressful?", 'leading'],
    ['What do you think about our app?', 'pitching'],
    ['How much would you pay for this?', 'price_guess'],
    ['Do you struggle with deadlines?', 'closed'],
    ['How do you plan? And what tools help?', 'compound'],
  ])('flags "%s" as %s', (question, type) => {
    const result = checkQuestion(question);
    expect(result.ok).toBe(false);
    expect(result.flags.map((f) => f.type)).toContain(type);
    expect(result.suggestion).toEqual(expect.any(String));
  });

  test('accepts an open question about past behaviour', () => {
    const result = checkQuestion('Tell me about the last time you missed a deadline.');
    expect(result).toMatchObject({ ok: true, flags: [], suggestion: null });
  });

  test('handles empty input safely', () => {
    expect(checkQuestion(undefined)).toMatchObject({ text: '', ok: true });
  });
});

describe('biasChecker.checkScript', () => {
  test('scores the share of unbiased questions', () => {
    const report = checkScript([
      { id: 'q1', text: 'How do you handle this today?' },
      { id: 'q2', text: 'Would you pay for a better way?' },
    ]);
    expect(report.score).toBe(50);
    expect(report.flagged).toBe(1);
    expect(report.results[1].id).toBe('q2');
  });

  test('an empty script scores 100', () => {
    expect(checkScript([])).toEqual({ results: [], flagged: 0, score: 100 });
    expect(checkScript(undefined).score).toBe(100);
  });
});
