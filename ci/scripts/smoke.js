'use strict';

/**
 * Post-deployment smoke and API tests run by the Deploy and Release stages against the live
 * environment: health, version, auth, a full sprint + interview flow, and metrics.
 *   node ci/scripts/smoke.js --url http://127.0.0.1:3001 --version 1.0.12 --env staging
 */

const crypto = require('crypto');
const { arg, http, log, writeJson, reportsDir, table } = require('./lib');
const path = require('path');

const IDEA = 'Student founders waste months building products nobody needs because interviewing customers without bias is hard.';

function check(condition, detail) {
  if (!condition) throw new Error(detail);
}

function buildSteps(base, expectedVersion, ctx) {
  const auth = () => ({ Authorization: `Bearer ${ctx.token}` });
  return [
    ['GET /health is ok', async () => {
      const r = await http(`${base}/health`);
      check(r.status === 200 && r.json.status === 'ok', `status ${r.status}`);
    }],
    ['GET /ready storage is writable', async () => check((await http(`${base}/ready`)).status === 200, 'not ready')],
    [`GET /version is ${expectedVersion}`, async () => {
      const r = await http(`${base}/version`);
      check(r.json && r.json.version === expectedVersion, `running version ${r.json && r.json.version}`);
    }],
    ['Bias checker flags a hypothetical question', async () => {
      const r = await http(`${base}/api/tools/bias-check`, { method: 'POST', body: { question: 'Would you use an app that finds interviewees?' } });
      check(r.status === 200 && r.json.ok === false, `status ${r.status}`);
    }],
    ['Founder can register', async () => {
      const r = await http(`${base}/api/auth/register`, { method: 'POST', body: { email: `smoke-${crypto.randomUUID()}@proofsprint.test`, password: crypto.randomBytes(12).toString('hex'), name: 'Smoke Test' } });
      check(r.status === 201 && r.json.token, `status ${r.status}`);
      ctx.token = r.json.token;
    }],
    ['Sprint is created with ranked assumptions', async () => {
      const r = await http(`${base}/api/sprints`, { method: 'POST', headers: auth(), body: { title: 'Smoke sprint', idea: IDEA, targetCustomer: 'Student founders' } });
      check(r.status === 201 && r.json.sprint.assumptions.length >= 5, `status ${r.status}`);
      ctx.sprint = r.json.sprint;
    }],
    ['Sprint launches and a participant interview starts', async () => {
      await http(`${base}/api/sprints/${ctx.sprint.id}/launch`, { method: 'POST', headers: auth() });
      const r = await http(`${base}/api/interviews/${ctx.sprint.inviteToken}/start`, { method: 'POST', body: { consent: true, alias: 'Smoke' } });
      check(r.status === 201 && r.json.question, `status ${r.status}`);
      ctx.interviewId = r.json.interviewId;
    }],
    ['Participant answer is recorded', async () => {
      const r = await http(`${base}/api/interviews/${ctx.sprint.inviteToken}/${ctx.interviewId}/answer`, { method: 'POST', body: { text: 'Finding people to interview takes me hours every single week' } });
      check(r.status === 200, `status ${r.status}`);
    }],
    ['Insights report is generated', async () => {
      const r = await http(`${base}/api/sprints/${ctx.sprint.id}/insights`, { headers: auth() });
      check(r.status === 200 && typeof r.json.insights.evidenceScore === 'number', `status ${r.status}`);
    }],
    ['Smoke data is cleaned up', async () => {
      const r = await http(`${base}/api/sprints/${ctx.sprint.id}`, { method: 'DELETE', headers: auth() });
      check(r.status === 204, `status ${r.status}`);
    }],
    ['GET /metrics exposes Prometheus metrics', async () => {
      const r = await http(`${base}/metrics`);
      check(r.status === 200 && r.text.includes(`version="${expectedVersion}"`), 'proofsprint_app_info missing');
    }],
  ];
}

async function runSmoke({ base, expectedVersion }) {
  const ctx = {};
  const results = [];
  for (const [name, step] of buildSteps(base, expectedVersion, ctx)) {
    const started = Date.now();
    try {
      await step();
      results.push({ test: name, result: 'PASS', ms: Date.now() - started, detail: '' });
    } catch (err) {
      results.push({ test: name, result: 'FAIL', ms: Date.now() - started, detail: err.message });
      break;
    }
  }
  return { ok: results.every((r) => r.result === 'PASS') && results.length === buildSteps(base, expectedVersion, {}).length, results };
}

async function main() {
  const base = arg('url', 'http://127.0.0.1:3001');
  const env = arg('env', 'staging');
  const report = await runSmoke({ base, expectedVersion: arg('version') });
  console.log(table(report.results, ['test', 'result', 'ms', 'detail']));
  writeJson(path.join(reportsDir(), `smoke-${env}.json`), { base, ...report });
  if (!report.ok) process.exit(1);
  log(`All smoke tests passed against ${base}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runSmoke };
