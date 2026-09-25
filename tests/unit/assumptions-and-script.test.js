'use strict';

const { mapAssumptions, extractProblem, adjustRisk } = require('../../src/services/assumptionMapper');
const { buildScript, MAX_QUESTIONS } = require('../../src/services/scriptBuilder');

const IDEA =
  'Student founders waste months building products nobody needs. It is hard to find and interview real customers without bias.';

describe('assumptionMapper', () => {
  test('returns six ranked assumptions with the problem first', () => {
    const list = mapAssumptions({ idea: IDEA, targetCustomer: 'Student founders' });
    expect(list).toHaveLength(6);
    expect(list[0]).toMatchObject({ id: 'a1', category: 'problem', risk: 5, evidence: null });
    expect(list[0].statement).toContain('Student founders waste months');
    const risks = list.map((a) => a.risk);
    expect([...risks].sort((a, b) => b - a)).toEqual(risks);
  });

  test('raises customer risk when the target customer is vague', () => {
    const list = mapAssumptions({ idea: IDEA, targetCustomer: 'everyone' });
    expect(list.find((a) => a.category === 'customer').risk).toBe(5);
  });

  test('uses a default customer label and rejects very short ideas', () => {
    expect(mapAssumptions({ idea: IDEA }).find((a) => a.category === 'channel').statement).toContain('Target customers');
    expect(() => mapAssumptions({ idea: 'too short' })).toThrow(/at least 20 characters/);
  });

  test('extractProblem prefers the sentence that describes pain', () => {
    expect(extractProblem('We are a team. Booking tutors is slow and confusing!')).toBe('Booking tutors is slow and confusing');
    expect(extractProblem('A marketplace for bikes.')).toBe('A marketplace for bikes');
  });

  test('adjustRisk applies evidence, payment and absolute-language rules within 1-5', () => {
    expect(adjustRisk('problem', 5, 'We interviewed 12 students', 'students')).toBe(4);
    expect(adjustRisk('value', 3, 'a monthly subscription', 'students')).toBe(4);
    expect(adjustRisk('channel', 2, 'everyone needs this', 'students')).toBe(3);
    expect(adjustRisk('problem', 5, 'everyone always needs this', 'people')).toBe(5);
  });
});

describe('scriptBuilder', () => {
  test('builds an unbiased script for the three riskiest assumptions', () => {
    const assumptions = mapAssumptions({ idea: IDEA, targetCustomer: 'Student founders' });
    const { questions, bias } = buildScript(assumptions);
    expect(questions.length).toBeLessThanOrEqual(MAX_QUESTIONS);
    expect(questions[0].id).toBe('q1');
    expect(questions.filter((q) => q.assumptionId).length).toBe(6);
    expect(bias.score).toBe(100);
  });

  test('works with no assumptions and unknown categories', () => {
    expect(buildScript([]).questions).toHaveLength(2);
    expect(buildScript([{ id: 'x', category: 'unknown' }]).questions).toHaveLength(2);
    expect(buildScript(undefined).questions).toHaveLength(2);
  });
});
