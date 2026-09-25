'use strict';

const { startInterview, recordAnswer, nextQuestion, wordCount, FOLLOW_UP } = require('../../src/services/interviewEngine');

const sprint = {
  id: 's1',
  status: 'interviewing',
  questions: [
    { id: 'q1', text: 'How do you handle this today?', assumptionId: 'a1' },
    { id: 'q2', text: 'What was the hardest part of that?', assumptionId: 'a1' },
  ],
};
const LONG = 'I spend hours every week chasing people for their feedback';

describe('interviewEngine', () => {
  test('requires consent and an open sprint', () => {
    expect(() => startInterview(sprint, { consent: false })).toThrow(/Consent/);
    expect(() => startInterview({ ...sprint, status: 'draft' }, { consent: true })).toThrow(/not accepting/);
  });

  test('starts with a sanitised alias', () => {
    expect(startInterview(sprint, { consent: true, alias: '  ' }).alias).toBe('Anonymous');
    expect(startInterview(sprint, { consent: true }).alias).toBe('Anonymous');
    expect(startInterview(sprint, { consent: true, alias: 'Mia' })).toMatchObject({ alias: 'Mia', status: 'in_progress', answers: [] });
  });

  test('asks one follow-up after a short answer, then moves on and completes', () => {
    let interview = startInterview(sprint, { consent: true, alias: 'Mia' });
    expect(nextQuestion(sprint, interview).id).toBe('q1');

    let step = recordAnswer(sprint, interview, 'Not well');
    expect(step.next).toMatchObject({ id: 'q1-f', text: FOLLOW_UP, followUpOf: 'q1' });

    step = recordAnswer(sprint, step.interview, 'Short again');
    expect(step.next.id).toBe('q2');
    expect(step.interview.answers[1]).toMatchObject({ questionId: 'q1', isFollowUp: true });

    step = recordAnswer(sprint, step.interview, LONG);
    expect(step.next).toBeNull();
    expect(step.interview.status).toBe('complete');
    expect(step.interview.completedAt).toEqual(expect.any(String));
    interview = step.interview;
    expect(() => recordAnswer(sprint, interview, LONG)).toThrow(/already complete/);
  });

  test('rejects empty answers', () => {
    const interview = startInterview(sprint, { consent: true });
    expect(() => recordAnswer(sprint, interview, '   ')).toThrow(/required/);
  });

  test('wordCount ignores extra whitespace', () => {
    expect(wordCount('  one   two three ')).toBe(3);
    expect(wordCount(undefined)).toBe(0);
  });
});
