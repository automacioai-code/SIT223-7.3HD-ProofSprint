'use strict';

/**
 * Chat interview engine for participants. It walks through the founder's script and asks one
 * follow-up when an answer is too short to be useful evidence.
 */

const MIN_WORDS = 6;
const FOLLOW_UP = 'Could you tell me a bit more about that? What happened, specifically?';

const wordCount = (text) => String(text || '').trim().split(/\s+/).filter(Boolean).length;

function lastAnswer(interview) {
  return interview.answers[interview.answers.length - 1] || null;
}

function nextQuestion(sprint, interview) {
  const last = lastAnswer(interview);
  if (last && !last.isFollowUp && wordCount(last.text) < MIN_WORDS) {
    return { id: `${last.questionId}-f`, text: FOLLOW_UP, followUpOf: last.questionId };
  }
  const answered = new Set(interview.answers.map((a) => a.questionId));
  return sprint.questions.find((q) => !answered.has(q.id)) || null;
}

function startInterview(sprint, { alias, consent }) {
  if (consent !== true) {
    const error = new Error('Consent is required before the interview can start');
    error.status = 400;
    throw error;
  }
  if (sprint.status !== 'interviewing') {
    const error = new Error('This sprint is not accepting interviews');
    error.status = 409;
    throw error;
  }
  return {
    sprintId: sprint.id,
    alias: String(alias || 'Anonymous').trim().slice(0, 40) || 'Anonymous',
    consent: true,
    answers: [],
    status: 'in_progress',
  };
}

function recordAnswer(sprint, interview, text) {
  const answerText = String(text || '').trim();
  if (!answerText) {
    const error = new Error('Answer text is required');
    error.status = 400;
    throw error;
  }
  const question = nextQuestion(sprint, interview);
  if (!question || interview.status === 'complete') {
    const error = new Error('This interview is already complete');
    error.status = 409;
    throw error;
  }
  const answer = {
    questionId: question.followUpOf || question.id,
    isFollowUp: Boolean(question.followUpOf),
    question: question.text,
    text: answerText.slice(0, 2000),
    at: new Date().toISOString(),
  };
  const updated = { ...interview, answers: [...interview.answers, answer] };
  const next = nextQuestion(sprint, updated);
  updated.status = next ? 'in_progress' : 'complete';
  if (!next) {
    updated.completedAt = answer.at;
  }
  return { interview: updated, next };
}

module.exports = { nextQuestion, startInterview, recordAnswer, wordCount, FOLLOW_UP, MIN_WORDS };
