'use strict';

/**
 * Security stage gate. Combines npm audit (dependencies), Trivy (dependency CVEs, secrets and
 * misconfiguration in the source tree, plus a scan of the exact artefact we ship) and the
 * eslint-plugin-security SAST findings, applies the documented triage decisions in
 * security/triage.json, writes a report, and fails the build on any untriaged
 * HIGH/CRITICAL vulnerability in shipped code or any leaked secret.
 */

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, readJson, writeJson, writeText, reportsDir, log, fail, table, markdownTable } = require('./lib');

const BLOCKING = new Set(['HIGH', 'CRITICAL']);
const up = (s) => String(s || 'UNKNOWN').toUpperCase();

function triageFor(triage, id) {
  return triage.find((t) => t.id === id && (!t.expires || new Date(t.expires) > new Date())) || null;
}

function fromNpmAudit(report, scope) {
  if (!report || !report.vulnerabilities) return [];
  return Object.values(report.vulnerabilities).map((v) => {
    const advisory = (v.via || []).find((x) => typeof x === 'object') || {};
    return {
      source: `npm audit (${scope})`,
      id: advisory.url ? advisory.url.split('/').pop() : `npm:${v.name}`,
      package: v.name,
      severity: up(v.severity),
      fix: v.fixAvailable ? 'upgrade available' : 'no fix yet',
      title: advisory.title || 'Vulnerable dependency',
      shipped: scope === 'production',
    };
  });
}

const trivyVuln = (label, shipped) => (v) => ({
  source: `Trivy ${label}`,
  id: v.VulnerabilityID,
  package: `${v.PkgName}@${v.InstalledVersion}`,
  severity: up(v.Severity),
  fix: v.FixedVersion ? `fixed in ${v.FixedVersion}` : 'no fix yet',
  title: String(v.Title || '').slice(0, 90),
  shipped,
});

const trivySecret = (label, target) => (s) => ({ source: `Trivy ${label} secrets`, id: s.RuleID, package: target, severity: 'CRITICAL', fix: 'rotate + remove', title: s.Title, shipped: true, secret: true });

const trivyMisconfig = (label, target, shipped) => (m) => ({ source: `Trivy ${label} misconfig`, id: m.ID, package: target, severity: up(m.Severity), fix: m.Resolution || '', title: m.Title, shipped });

function fromTrivy(report, label, shipped) {
  const results = (report && report.Results) || [];
  return results.flatMap((r) => [
    ...(r.Vulnerabilities || []).map(trivyVuln(label, shipped)),
    ...(r.Secrets || []).map(trivySecret(label, r.Target)),
    ...(r.Misconfigurations || []).filter((m) => m.Status === 'FAIL').map(trivyMisconfig(label, r.Target, shipped)),
  ]);
}

function fromEslint(report) {
  const findings = [];
  for (const file of report || []) {
    for (const m of file.messages || []) {
      if (!String(m.ruleId).startsWith('security/')) continue;
      findings.push({ source: 'ESLint SAST', id: m.ruleId, package: `${path.relative(REPO_ROOT, file.filePath)}:${m.line}`, severity: m.severity === 2 ? 'HIGH' : 'LOW', fix: '', title: m.message.slice(0, 90), shipped: true });
    }
  }
  return findings;
}

function collect(dir) {
  const prodDeps = fromNpmAudit(readJson(path.join(dir, 'npm-audit-prod.json')), 'production');
  const prodNames = new Set(prodDeps.map((f) => f.package));
  return [
    ...prodDeps,
    ...fromNpmAudit(readJson(path.join(dir, 'npm-audit-all.json')), 'dev only').filter((f) => !prodNames.has(f.package)),
    ...fromTrivy(readJson(path.join(dir, 'trivy-source.json')), 'source', false),
    ...fromTrivy(readJson(path.join(dir, 'trivy-artifact.json')), 'artefact', true),
    ...fromEslint(readJson(path.join(dir, 'eslint.json'))),
  ];
}

function classify(findings, triage) {
  const seen = new Set();
  const rows = [];
  for (const f of findings) {
    const key = `${f.source}|${f.id}|${f.package}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const decision = triageFor(triage, f.id);
    const blocking = !decision && (f.secret || (f.shipped && BLOCKING.has(f.severity)));
    const status = decision ? decision.decision.toUpperCase() : blocking ? 'BLOCKING' : 'REPORTED';
    rows.push({ ...f, status, reason: decision ? decision.reason : '' });
  }
  return rows;
}

function summarise(rows) {
  const count = (sev) => rows.filter((r) => r.severity === sev).length;
  return { total: rows.length, critical: count('CRITICAL'), high: count('HIGH'), medium: count('MEDIUM'), low: count('LOW'), blocking: rows.filter((r) => r.status === 'BLOCKING').length };
}

function writeReports(dir, rows, summary, scanned) {
  const md = [
    '# Security report',
    '',
    `Scanners: npm audit, Trivy (vulnerabilities, secrets, misconfiguration), eslint-plugin-security. Reports: ${scanned.join(', ')}.`,
    '',
    `**Summary:** ${summary.total} findings (critical ${summary.critical}, high ${summary.high}, medium ${summary.medium}, low ${summary.low}); blocking ${summary.blocking}.`,
    '',
    'Policy: the build fails on any untriaged HIGH/CRITICAL vulnerability in code we ship, or any secret. Accepted risks and false positives are documented with a reason in security/triage.json.',
    '',
    rows.length ? markdownTable(rows, ['severity', 'status', 'source', 'id', 'package', 'fix', 'title', 'reason']) : 'No findings.',
    '',
  ].join('\n');
  writeText(path.join(dir, 'security-summary.md'), md);
  writeJson(path.join(dir, 'security-summary.json'), { summary, findings: rows });
}

function main() {
  const dir = reportsDir();
  const triage = readJson(path.join(REPO_ROOT, 'security', 'triage.json'), { decisions: [] }).decisions;
  const rows = classify(collect(dir), triage);
  const summary = summarise(rows);
  const scanned = ['npm-audit-prod.json', 'npm-audit-all.json', 'trivy-source.json', 'trivy-artifact.json', 'eslint.json'].filter((f) => fs.existsSync(path.join(dir, f)));
  console.log(`\nSecurity scan summary: ${JSON.stringify(summary)}\nReports scanned: ${scanned.join(', ')}\n`);
  if (rows.length) console.log(table(rows, ['severity', 'status', 'source', 'id', 'package', 'fix']));
  writeReports(dir, rows, summary, scanned);
  if (summary.blocking) fail(`${summary.blocking} blocking security finding(s); fix them or document a triage decision`);
  log('Security gate passed');
}

main();
