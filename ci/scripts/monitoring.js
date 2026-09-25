'use strict';

/**
 * Monitoring & Alerting stage. Provisions the monitoring stack from the configuration in
 * monitoring/ (infrastructure as code): Prometheus (metrics + alert rules), Alertmanager
 * (routing) and the alert-notifier (team notifications via ntfy.sh), all supervised by PM2.
 * It then verifies that production and staging are being scraped, that every alert rule is
 * loaded, drives some live traffic and writes a monitoring report.
 *   node ci/scripts/monitoring.js up --ntfy-topic proofsprint-alerts
 */

const fs = require('fs');
const path = require('path');
const lib = require('./lib');
const { toolPath } = require('./ensure-tools');

const { REPO_ROOT, arg, opsRoot, http, waitFor, sleep, log, fail, writeJson, writeText, reportsDir, table, markdownTable } = lib;

process.env.JENKINS_NODE_COOKIE = 'dontKillMe';
process.env.BUILD_ID = 'dontKillMe';
process.env.PM2_HOME = process.env.PM2_HOME || path.join(opsRoot(), 'pm2');

const PROM = 'http://127.0.0.1:9090';
const ALERTMANAGER = 'http://127.0.0.1:9093';
const NOTIFIER = 'http://127.0.0.1:9095';
const APPS = { production: 'http://127.0.0.1:3000', staging: 'http://127.0.0.1:3001' };

const pm2Call = (pm2, method, ...args) =>
  new Promise((resolve, reject) => pm2[method](...args, (err, res) => (err ? reject(err) : resolve(res))));

function copyConfig(dir) {
  const files = [
    ['prometheus/prometheus.yml', 'prometheus.yml'],
    ['prometheus/alerts.yml', 'alerts.yml'],
    ['alertmanager/alertmanager.yml', 'alertmanager.yml'],
    ['alert-notifier/server.js', path.join('alert-notifier', 'server.js')],
  ];
  for (const [from, to] of files) {
    fs.mkdirSync(path.dirname(path.join(dir, to)), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, 'monitoring', from), path.join(dir, to));
  }
}

function processes(dir, topic) {
  return [
    {
      name: 'prometheus',
      script: toolPath('prometheus'),
      interpreter: 'none',
      args: [`--config.file=${path.join(dir, 'prometheus.yml')}`, `--storage.tsdb.path=${path.join(dir, 'data', 'prometheus')}`, '--web.listen-address=127.0.0.1:9090', '--web.enable-lifecycle', '--storage.tsdb.retention.time=7d'],
      ready: `${PROM}/-/ready`,
      reload: `${PROM}/-/reload`,
    },
    {
      name: 'alertmanager',
      script: toolPath('alertmanager'),
      interpreter: 'none',
      args: [`--config.file=${path.join(dir, 'alertmanager.yml')}`, `--storage.path=${path.join(dir, 'data', 'alertmanager')}`, '--web.listen-address=127.0.0.1:9093', '--cluster.listen-address='],
      ready: `${ALERTMANAGER}/-/ready`,
      reload: `${ALERTMANAGER}/-/reload`,
    },
    {
      name: 'alert-notifier',
      script: path.join(dir, 'alert-notifier', 'server.js'),
      env: { PORT: '9095', NTFY_TOPIC: topic, LOG_FILE: path.join(dir, 'alerts.log') },
      ready: `${NOTIFIER}/health`,
    },
  ];
}

async function ensureProcess(pm2, running, proc, dir) {
  const online = running.find((p) => p.name === proc.name && p.pm2_env.status === 'online');
  if (online && proc.reload) {
    const res = await http(proc.reload, { method: 'POST', timeoutMs: 10000 });
    log(`${proc.name}: configuration reloaded (${res.status})`);
    return 'reloaded';
  }
  if (online) await pm2Call(pm2, 'delete', proc.name);
  const options = { name: proc.name, script: proc.script, interpreter: proc.interpreter, args: proc.args, env: proc.env };
  await pm2Call(pm2, 'start', { ...options, cwd: dir, autorestart: true, out_file: path.join(dir, 'logs', `${proc.name}.log`), error_file: path.join(dir, 'logs', `${proc.name}.log`) });
  log(`${proc.name}: ${online ? 'restarted' : 'started'}`);
  return online ? 'restarted' : 'started';
}

async function traffic(seconds) {
  const until = Date.now() + seconds * 1000;
  let sent = 0;
  while (Date.now() < until) {
    await Promise.all([
      http(`${APPS.production}/health`).catch(() => null),
      http(`${APPS.production}/version`).catch(() => null),
      http(`${APPS.production}/api/tools/bias-check`, { method: 'POST', body: { question: 'How do you plan your week today?' } }).catch(() => null),
      http(`${APPS.staging}/health`).catch(() => null),
    ]);
    sent += 4;
    await sleep(250);
  }
  return sent;
}

async function query(expr) {
  const res = await http(`${PROM}/api/v1/query?query=${encodeURIComponent(expr)}`);
  const value = res.json?.data?.result?.[0]?.value?.[1];
  return value === undefined ? 'n/a' : Number(value).toFixed(4).replace(/\.?0+$/, '');
}

async function verifyTargets() {
  return waitFor('Prometheus to scrape production and staging', async () => {
    const res = await http(`${PROM}/api/v1/targets`);
    const targets = res.json.data.activeTargets.map((t) => ({ job: t.labels.job, instance: t.labels.instance, health: t.health, lastScrape: t.lastScrape }));
    const up = (job) => targets.some((t) => t.job === job && t.health === 'up');
    return up('proofsprint-production') && up('proofsprint-staging') ? targets : null;
  }, { timeoutMs: 90000, intervalMs: 3000 });
}

async function main() {
  const dir = path.join(opsRoot(), 'monitoring');
  const topic = arg('ntfy-topic', process.env.NTFY_TOPIC || '');
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  copyConfig(dir);

  const pm2 = require(path.dirname(toolPath('pm2')));
  await pm2Call(pm2, 'connect');
  const actions = {};
  try {
    const running = await pm2Call(pm2, 'list');
    for (const proc of processes(dir, topic)) {
      actions[proc.name] = await ensureProcess(pm2, running, proc, dir);
      await waitFor(`${proc.name} to be ready`, async () => (await http(proc.ready)).status === 200, { timeoutMs: 90000, intervalMs: 2000 });
    }
  } finally {
    pm2.disconnect();
  }

  const targets = await verifyTargets();
  const rulesRes = await http(`${PROM}/api/v1/rules?type=alert`);
  const rules = rulesRes.json.data.groups.flatMap((g) => g.rules.map((r) => ({ group: g.name, alert: r.name, severity: r.labels.severity, for: `${r.duration}s`, state: r.state })));
  if (rules.length < 5) fail(`Expected at least 5 alert rules, found ${rules.length}`);
  const amStatus = await http(`${ALERTMANAGER}/api/v2/status`);
  if (!amStatus.ok || !String(amStatus.json.config.original).includes('team-notifier')) fail('Alertmanager is not routing to the team-notifier receiver');

  log('Generating 15 seconds of live traffic so the dashboards have data...');
  const sent = await traffic(15);
  await sleep(6000);
  const snapshot = {
    'Production up (1 = up)': await query('up{job="proofsprint-production"}'),
    'Staging up (1 = up)': await query('up{job="proofsprint-staging"}'),
    'Production request rate (req/s, 1m)': await query('sum(rate(http_requests_total{job="proofsprint-production"}[1m]))'),
    'Production 5xx error ratio (1m)': await query('sum(rate(http_requests_total{job="proofsprint-production",status=~"5.."}[1m])) / sum(rate(http_requests_total{job="proofsprint-production"}[1m]))'),
    'Production p95 latency (s, 1m)': await query('histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{job="proofsprint-production"}[1m])))'),
    'Production memory (MB)': await query('process_resident_memory_bytes{job="proofsprint-production"} / 1024 / 1024'),
    'Production CPU (cores, 1m)': await query('rate(process_cpu_seconds_total{job="proofsprint-production"}[1m])'),
    'Running version': (await http(`${APPS.production}/version`)).json.version,
  };
  const alerts = (await http(`${ALERTMANAGER}/api/v2/alerts`)).json || [];

  console.log(`\nScrape targets:\n${table(targets, ['job', 'instance', 'health'])}`);
  console.log(`\nAlert rules loaded (${rules.length}):\n${table(rules, ['group', 'alert', 'severity', 'for', 'state'])}`);
  const snapRows = Object.entries(snapshot).map(([metric, value]) => ({ metric, value }));
  console.log(`\nLive metrics after ${sent} synthetic requests:\n${table(snapRows, ['metric', 'value'])}`);
  console.log(`\nActive alerts: ${alerts.length}`);
  console.log(`\nDashboards: Prometheus ${PROM}/alerts | Alertmanager ${ALERTMANAGER} | Team notifications ${NOTIFIER}${topic ? ` | https://ntfy.sh/${topic}` : ''}`);

  writeJson(path.join(reportsDir(), 'monitoring-report.json'), { actions, targets, rules, snapshot, activeAlerts: alerts.length });
  writeText(
    path.join(reportsDir(), 'monitoring-report.md'),
    ['# Monitoring report', '', '## Scrape targets', markdownTable(targets, ['job', 'instance', 'health']), '', '## Alert rules', markdownTable(rules, ['group', 'alert', 'severity', 'for', 'state']), '', '## Live metrics', markdownTable(snapRows, ['metric', 'value']), ''].join('\n'),
  );
  log('Monitoring stack is healthy and watching production');
}

main().catch((err) => fail(err.stack || err.message));
