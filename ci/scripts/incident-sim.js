'use strict';

/**
 * Monitoring stage: incident simulation. Switches production into chaos mode (API returns 500s),
 * keeps real traffic flowing, and proves the full alerting chain works end to end:
 * Prometheus rule fires -> Alertmanager routes it -> the team is notified -> recovery -> resolved.
 * Records the detection and recovery timeline (MTTD / MTTR) in reports/incident-simulation.*.
 */

const fs = require('fs');
const path = require('path');
const { opsRoot, http, sleep, log, fail, writeJson, writeText, reportsDir, table, readEnvFile, REPO_ROOT } = require('./lib');

const PROM = 'http://127.0.0.1:9090';
const ALERTMANAGER = 'http://127.0.0.1:9093';
const NOTIFIER = 'http://127.0.0.1:9095';
const ALERT = 'ProofSprintHighErrorRate';

const seconds = (from, to) => (to && from ? Math.round((to - from) / 1000) : null);

async function promAlertState() {
  const res = await http(`${PROM}/api/v1/alerts`);
  const alert = (res.json?.data?.alerts || []).find((a) => a.labels.alertname === ALERT && a.labels.env === 'production');
  return alert ? alert.state : 'inactive';
}

async function alertmanagerActive() {
  const res = await http(`${ALERTMANAGER}/api/v2/alerts?filter=${encodeURIComponent(`alertname="${ALERT}"`)}`);
  return (res.json || []).some((a) => a.status.state === 'active');
}

async function notified(status, since) {
  const res = await http(`${NOTIFIER}/api/alerts`);
  return (res.json?.events || []).some((e) => e.alertname === ALERT && e.status === status && Date.parse(e.at) >= since);
}

function startTraffic(base) {
  const stats = { ok: 0, failed: 0, running: true };
  (async () => {
    while (stats.running) {
      const res = await http(`${base}/api/tools/bias-check`, { method: 'POST', body: { question: 'How do you find customers to interview?' } }).catch(() => ({ status: 0 }));
      if (res.status === 200) stats.ok += 1;
      else stats.failed += 1;
      await sleep(150);
    }
  })();
  return stats;
}

async function waitUntil(description, check, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check().catch(() => false)) return Date.now();
    await sleep(2000);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function main() {
  const env = readEnvFile(path.join(REPO_ROOT, 'deploy', 'production.env'));
  const base = `http://127.0.0.1:${env.PORT}`;
  const keyFile = path.join(opsRoot(), 'environments', 'production', 'chaos.key');
  if (!fs.existsSync(keyFile)) fail('Chaos mode is not enabled in production (no chaos.key)');
  const headers = { 'X-Chaos-Key': fs.readFileSync(keyFile, 'utf8').trim() };

  await waitUntil('a clean starting state (no active error-rate alert)', async () => !(await alertmanagerActive()), 120000);
  const traffic = startTraffic(base);
  const t = { start: Date.now() };
  try {
    log('INCIDENT: switching production into chaos mode (API calls fail with HTTP 500)');
    const on = await http(`${base}/api/admin/chaos`, { method: 'POST', headers, body: { mode: 'errors', durationSeconds: 150 } });
    if (on.status !== 200) fail(`Could not enable chaos mode (${on.status})`);

    t.pending = await waitUntil('Prometheus to detect the error rate', async () => (await promAlertState()) !== 'inactive', 90000);
    log(`Prometheus rule ${ALERT} is pending after ${seconds(t.start, t.pending)}s`);
    t.firing = await waitUntil('the alert to fire', async () => (await promAlertState()) === 'firing', 90000);
    log(`ALERT FIRING after ${seconds(t.start, t.firing)}s`);
    t.routed = await waitUntil('Alertmanager to receive the alert', alertmanagerActive, 60000);
    t.notified = await waitUntil('the team notification', () => notified('firing', t.start), 60000);
    log(`Team notified after ${seconds(t.start, t.notified)}s (alert-notifier + ntfy.sh)`);

    log('RECOVERY: switching chaos mode off');
    await http(`${base}/api/admin/chaos`, { method: 'POST', headers, body: { mode: 'off' } });
    t.recovered = Date.now();
    t.resolved = await waitUntil('the alert to resolve', async () => !(await alertmanagerActive()) && (await promAlertState()) === 'inactive', 180000);
    t.resolvedNotified = await waitUntil('the resolved notification', () => notified('resolved', t.recovered), 90000);
  } finally {
    traffic.running = false;
    await http(`${base}/api/admin/chaos`, { method: 'POST', headers, body: { mode: 'off' } }).catch(() => null);
  }

  const timeline = [
    { step: 'Chaos mode on (HTTP 500s in production)', seconds: 0 },
    { step: 'Prometheus rule pending', seconds: seconds(t.start, t.pending) },
    { step: 'Alert firing (error rate > 5% for 10s)', seconds: seconds(t.start, t.firing) },
    { step: 'Alertmanager routed alert', seconds: seconds(t.start, t.routed) },
    { step: 'Team notified (alert-notifier / ntfy)', seconds: seconds(t.start, t.notified) },
    { step: 'Chaos mode off (recovery)', seconds: seconds(t.start, t.recovered) },
    { step: 'Alert resolved', seconds: seconds(t.start, t.resolved) },
    { step: 'Resolved notification sent', seconds: seconds(t.start, t.resolvedNotified) },
  ];
  const result = { alert: ALERT, requests: { ok: traffic.ok, failed: traffic.failed }, mttdSeconds: seconds(t.start, t.notified), mttrSeconds: seconds(t.recovered, t.resolved), timeline };
  console.log(`\n${table(timeline, ['step', 'seconds'])}\n`);
  console.log(`Time to detect + notify: ${result.mttdSeconds}s | time to resolve after recovery: ${result.mttrSeconds}s | requests ok/failed: ${traffic.ok}/${traffic.failed}`);
  writeJson(path.join(reportsDir(), 'incident-simulation.json'), result);
  writeText(
    path.join(reportsDir(), 'incident-simulation.md'),
    `# Incident simulation\n\n| Step | Seconds after start |\n| --- | --- |\n${timeline.map((r) => `| ${r.step} | ${r.seconds} |`).join('\n')}\n\nDetect + notify: ${result.mttdSeconds}s; resolve after recovery: ${result.mttrSeconds}s.\n`,
  );
  log('Incident simulation passed: alert fired, team notified, alert resolved');
}

main().catch((err) => fail(err.message));
