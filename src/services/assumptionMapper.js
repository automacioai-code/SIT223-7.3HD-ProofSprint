'use strict';

/**
 * Assumption mapper: turns a founder's plain-language idea into the assumptions that must be
 * true for it to work, ranked by risk (riskiest first). This is the deterministic rules
 * provider; an LLM provider can implement the same interface later (see README).
 */

const CATEGORIES = [
  { key: 'problem', base: 5, template: (c) => `${c.customer} experience this problem: "${c.problem}"` },
  { key: 'frequency', base: 4, template: (c) => `The problem happens often enough for ${c.customer} to want it solved` },
  { key: 'value', base: 3, template: (c) => `${c.customer} (or someone paying for them) will spend time or money on a solution` },
  { key: 'customer', base: 3, template: (c) => `${c.customer} are the right early adopters and can be reached this month` },
  { key: 'solution', base: 3, template: () => 'The proposed solution removes the problem better than current workarounds' },
  { key: 'channel', base: 2, template: (c) => `There is a repeatable channel to reach ${c.customer}` },
];

const PAIN_WORDS = /(struggl|hard|difficult|problem|pain|waste|can't|cannot|frustrat|expensive|slow|confus)/i;
const ABSOLUTES = /\b(everyone|everybody|all|always|every|nobody|never)\b/i;
const EVIDENCE = /\b(interviewed|surveyed|customers told|data shows|we measured|pilot)\b/i;
const PAYMENT = /(pay|subscription|price|pricing|\$|fee|licen[cs]e)/i;
const VAGUE_CUSTOMER = /^(everyone|people|users|anyone|customers)?$/i;

function sentences(text) {
  return String(text)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractProblem(idea) {
  const all = sentences(idea);
  const pain = all.find((s) => PAIN_WORDS.test(s)) || all[0] || idea;
  return pain.replace(/[.!?]+$/, '').slice(0, 140);
}

function adjustRisk(key, base, idea, customer) {
  let risk = base;
  if (key === 'problem' && EVIDENCE.test(idea)) risk -= 1;
  if (key === 'value' && PAYMENT.test(idea)) risk += 1;
  if (key === 'customer' && VAGUE_CUSTOMER.test(customer.trim())) risk += 2;
  if (ABSOLUTES.test(idea)) risk += 1;
  return Math.max(1, Math.min(5, risk));
}

function mapAssumptions({ idea, targetCustomer }) {
  const text = String(idea || '').trim();
  if (text.length < 20) {
    throw new Error('Describe the idea in at least 20 characters');
  }
  const customer = String(targetCustomer || '').trim() || 'Target customers';
  const context = { customer, problem: extractProblem(text) };
  const order = CATEGORIES.map((c) => c.key);
  return CATEGORIES.map((cat) => ({
    category: cat.key,
    statement: cat.template(context),
    risk: adjustRisk(cat.key, cat.base, text, customer),
  }))
    .sort((a, b) => b.risk - a.risk || order.indexOf(a.category) - order.indexOf(b.category))
    .map((a, i) => ({ id: `a${i + 1}`, ...a, evidence: null }));
}

module.exports = { mapAssumptions, extractProblem, adjustRisk };
