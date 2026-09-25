'use strict';

const { synthesise, classify, evidenceLevel, evidenceScore, themes, decide } = require('../../src/services/insights');

const sprint = {
  assumptions: [
    { id: 'a1', category: 'problem', statement: 'Founders struggle to validate ideas', risk: 5 },
    { id: 'a2', category: 'value', statement: 'Founders will pay', risk: 3 },
  ],
  questions: [
    { id: 'q1', assumptionId: 'a1' },
    { id: 'q2', assumptionId: 'a2' },
  ],
};

function interview(alias, a1, a2, status = 'complete') {
  return { alias, status, answers: [{ questionId: 'q1', text: a1 }, { questionId: 'q2', text: a2 }] };
}

describe('insights helpers', () => {
  test('classify detects supporting, contradicting and neutral answers', () => {
    expect(classify('It was really frustrating and slow')).toBe('support');
    expect(classify('Honestly it is not a problem for me')).toBe('contradict');
    expect(classify('I use a spreadsheet')).toBe('neutral');
  });

  test('evidenceLevel thresholds', () => {
    expect(evidenceLevel(5, 1)).toBe('strong');
    expect(evidenceLevel(3, 1)).toBe('moderate');
    expect(evidenceLevel(1, 3)).toBe('contradicted');
    expect(evidenceLevel(1, 0)).toBe('weak');
    expect(evidenceLevel(0, 0)).toBe('weak');
  });

  test('evidenceScore weights by risk and sample size', () => {
    const assumptions = [{ risk: 5, evidence: { level: 'strong' } }, { risk: 5, evidence: { level: 'weak' } }];
    expect(evidenceScore(assumptions, 10)).toBe(63);
    expect(evidenceScore(assumptions, 5)).toBe(31);
    expect(evidenceScore([], 10)).toBe(0);
  });

  test('themes ignores stop words and ranks by frequency', () => {
    const result = themes([{ text: 'Deadlines deadlines and group work' }, { text: 'group chats about deadlines' }]);
    expect(result[0]).toEqual({ term: 'deadlines', count: 3 });
    expect(result.map((t) => t.term)).toContain('group');
  });

  test('decide recommends pivot, keep-testing or persevere', () => {
    const contradicted = [{ category: 'problem', evidence: { level: 'contradicted' } }];
    expect(decide(contradicted, 90, 10).decision).toBe('pivot');
    const fine = [{ category: 'problem', evidence: { level: 'strong' } }];
    expect(decide(fine, 90, 2).decision).toBe('keep-testing');
    expect(decide(fine, 90, 8).decision).toBe('persevere');
    expect(decide(fine, 40, 8).decision).toBe('keep-testing');
  });
});

describe('synthesise', () => {
  test('produces quote-backed evidence and a persevere recommendation', () => {
    const interviews = Array.from({ length: 10 }, (_, i) =>
      interview(`P${i}`, 'Validating ideas is hard and time-consuming', 'I paid for a course but it was expensive'),
    );
    const report = synthesise(sprint, interviews);
    expect(report.interviews).toEqual({ total: 10, completed: 10 });
    expect(report.assumptions[0].evidence.level).toBe('strong');
    expect(report.assumptions[0].evidence.quotes.length).toBeGreaterThanOrEqual(2);
    expect(report.assumptions[0].insight).toMatch(/STRONG evidence/);
    expect(report.evidenceScore).toBeGreaterThanOrEqual(70);
    expect(report.decision).toBe('persevere');
    expect(report.note).toMatch(/founder/);
  });

  test('flags a pivot when customers contradict the problem', () => {
    const interviews = [
      interview('A', 'Honestly it is easy for me', 'no'),
      interview('B', 'Never had that issue, it is not a problem', 'no'),
      interview('C', 'It works fine', 'no', 'in_progress'),
    ];
    const report = synthesise(sprint, interviews);
    expect(report.assumptions[0].evidence.level).toBe('contradicted');
    expect(report.decision).toBe('pivot');
    expect(report.interviews.completed).toBe(2);
    expect(report.assumptions[1].insight).toBe('Not enough evidence yet');
  });
});
