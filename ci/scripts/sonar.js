'use strict';

/**
 * Code Quality stage helpers for SonarQube Cloud (sonarcloud.io).
 *   node ci/scripts/sonar.js ensure-project   -> creates the SonarCloud project on first run
 *   node ci/scripts/sonar.js gate             -> checks the Sonar quality gate and our own thresholds
 * Needs SONAR_TOKEN (Jenkins credential), SONAR_ORG and SONAR_PROJECT_KEY.
 */

const path = require('path');
const { http, log, fail, writeJson, writeText, reportsDir, table, markdownTable } = require('./lib');

const HOST = process.env.SONAR_HOST_URL || 'https://sonarcloud.io';
const ORG = process.env.SONAR_ORG || 'automacioai-code';
const KEY = process.env.SONAR_PROJECT_KEY || 'automacioai-code_SIT223-7.3HD-ProofSprint';

// Project-specific thresholds applied on top of the SonarCloud "Sonar way" gate.
const THRESHOLDS = [
  { metric: 'coverage', label: 'Line coverage (%)', op: '>=', limit: 80, why: 'Untested code is where regressions hide' },
  { metric: 'duplicated_lines_density', label: 'Duplicated lines (%)', op: '<=', limit: 3, why: 'Copy-paste multiplies future fixes' },
  { metric: 'sqale_rating', label: 'Maintainability rating (1=A)', op: '<=', limit: 1, why: 'Technical debt ratio must stay under 5%' },
  { metric: 'reliability_rating', label: 'Reliability rating (1=A)', op: '<=', limit: 1, why: 'No bugs allowed into a release' },
  { metric: 'security_rating', label: 'Security rating (1=A)', op: '<=', limit: 1, why: 'No known vulnerabilities in our own code' },
  { metric: 'code_smells', label: 'Code smells', op: '<=', limit: 25, why: 'Keeps the codebase readable for new team members' },
  { metric: 'cognitive_complexity', label: 'Cognitive complexity (total)', op: '<=', limit: 250, why: 'Hard-to-follow logic is hard to change safely' },
];

const auth = () => ({ Authorization: `Basic ${Buffer.from(`${process.env.SONAR_TOKEN || ''}:`).toString('base64')}` });

async function ensureProject() {
  if (!process.env.SONAR_TOKEN) fail('SONAR_TOKEN is not set (add the SONAR_TOKEN secret-text credential in Jenkins)');
  const found = await http(`${HOST}/api/projects/search?organization=${ORG}&projects=${encodeURIComponent(KEY)}`, { headers: auth(), timeoutMs: 20000 });
  if (found.status !== 200) fail(`SonarCloud project lookup failed (${found.status}): ${found.text.slice(0, 200)}`);
  if (found.json.components.length) {
    log(`SonarCloud project ${KEY} exists`);
    return;
  }
  const created = await http(`${HOST}/api/projects/create`, {
    method: 'POST',
    headers: auth(),
    form: { organization: ORG, project: KEY, name: 'ProofSprint (SIT223 7.3HD)', visibility: 'public' },
    timeoutMs: 20000,
  });
  if (created.status !== 200) fail(`Could not create SonarCloud project (${created.status}): ${created.text.slice(0, 200)}`);
  log(`Created SonarCloud project ${KEY} in organization ${ORG}`);
}

function evaluate(measures) {
  return THRESHOLDS.map((t) => {
    const value = measures[t.metric] === undefined ? null : Number(measures[t.metric]);
    const pass = value !== null && (t.op === '>=' ? value >= t.limit : value <= t.limit);
    return { check: t.label, value: value === null ? 'n/a' : value, threshold: `${t.op} ${t.limit}`, result: pass ? 'PASS' : 'FAIL', why: t.why };
  });
}

async function gate() {
  const status = await http(`${HOST}/api/qualitygates/project_status?projectKey=${encodeURIComponent(KEY)}`, { headers: auth(), timeoutMs: 20000 });
  const metricKeys = ['ncloc', 'bugs', 'vulnerabilities', 'security_hotspots', ...THRESHOLDS.map((t) => t.metric)].join(',');
  const measuresRes = await http(`${HOST}/api/measures/component?component=${encodeURIComponent(KEY)}&metricKeys=${metricKeys}`, { headers: auth(), timeoutMs: 20000 });
  if (status.status !== 200 || measuresRes.status !== 200) fail(`SonarCloud API error (${status.status}/${measuresRes.status})`);

  const measures = Object.fromEntries(measuresRes.json.component.measures.map((m) => [m.metric, m.value]));
  const sonarGate = status.json.projectStatus.status;
  const checks = evaluate(measures);
  const passed = sonarGate === 'OK' && checks.every((c) => c.result === 'PASS');

  console.log(`\nSonarCloud quality gate ("Sonar way"): ${sonarGate}`);
  console.log(`Lines of code: ${measures.ncloc} | bugs: ${measures.bugs} | vulnerabilities: ${measures.vulnerabilities} | security hotspots: ${measures.security_hotspots}\n`);
  console.log(table(checks, ['check', 'value', 'threshold', 'result']));
  const url = `${HOST}/project/overview?id=${KEY}`;
  const md = [
    '# Code Quality report',
    '',
    `SonarCloud dashboard: ${url}`,
    '',
    `SonarCloud quality gate ("Sonar way", new code): **${sonarGate}**`,
    '',
    markdownTable(checks, ['check', 'value', 'threshold', 'result', 'why']),
    '',
  ].join('\n');
  writeText(path.join(reportsDir(), 'quality-gate.md'), md);
  writeJson(path.join(reportsDir(), 'quality-gate.json'), { sonarGate, measures, checks, passed, url });
  if (!passed) fail('Code quality gate failed: see the table above and reports/quality-gate.md');
  log(`Code quality gate passed. Dashboard: ${url}`);
}

const command = process.argv[2];
const run = { 'ensure-project': ensureProject, gate }[command];
if (!run) fail('usage: sonar.js ensure-project|gate');
run().catch((err) => fail(err.message));
