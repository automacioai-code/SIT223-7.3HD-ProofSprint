'use strict';

/**
 * Alert notifier: Alertmanager's webhook receiver for the ProofSprint team. Every alert
 * (firing and resolved) is logged, shown on a live page at http://127.0.0.1:9095 and pushed to
 * the team's phones through ntfy.sh (topic in NTFY_TOPIC; no account needed).
 */

const http = require('http');
const fs = require('fs');

const PORT = Number(process.env.PORT || 9095);
const TOPIC = process.env.NTFY_TOPIC || '';
const LOG_FILE = process.env.LOG_FILE || '';
const events = [];
const stats = { received: 0, pushed: 0, pushFailed: 0 };

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

async function push(event) {
  if (!TOPIC) return;
  const firing = event.status === 'firing';
  try {
    const res = await fetch(`https://ntfy.sh/${TOPIC}`, {
      method: 'POST',
      headers: {
        Title: `${firing ? 'FIRING' : 'RESOLVED'}: ${event.alertname} (${event.env || 'all'})`,
        Priority: firing && event.severity === 'critical' ? '5' : '3',
        Tags: firing ? 'rotating_light' : 'white_check_mark',
      },
      body: `${event.summary}\n${event.description}`,
    });
    stats[res.ok ? 'pushed' : 'pushFailed'] += 1;
  } catch {
    stats.pushFailed += 1;
  }
}

function record(payload) {
  for (const alert of payload.alerts || []) {
    const event = {
      at: new Date().toISOString(),
      status: alert.status,
      alertname: alert.labels.alertname,
      severity: alert.labels.severity || 'none',
      env: alert.labels.env || '',
      summary: (alert.annotations && alert.annotations.summary) || '',
      description: (alert.annotations && alert.annotations.description) || '',
      startsAt: alert.startsAt,
    };
    events.unshift(event);
    stats.received += 1;
    if (LOG_FILE) fs.appendFileSync(LOG_FILE, `${JSON.stringify(event)}\n`);
    console.log(`[alert] ${event.status.toUpperCase()} ${event.alertname} env=${event.env} severity=${event.severity}: ${event.summary}`);
    push(event);
  }
  events.splice(100);
}

function page() {
  const rows = events
    .map((e) => `<tr class="${e.status}"><td>${escapeHtml(e.at)}</td><td><b>${escapeHtml(e.status.toUpperCase())}</b></td><td>${escapeHtml(e.alertname)}</td><td>${escapeHtml(e.env)}</td><td>${escapeHtml(e.severity)}</td><td>${escapeHtml(e.summary)}</td></tr>`)
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="5"><title>ProofSprint alerts</title>
<style>body{font:14px system-ui,sans-serif;margin:20px;color:#16181d}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #e5e7eb;padding:6px 8px;text-align:left}
tr.firing td{background:#fdecea}tr.resolved td{background:#e8f5ef}.muted{color:#6b7280}</style></head><body>
<h2>ProofSprint team alerts</h2><p class="muted">Alertmanager webhook receiver · ${stats.received} notifications received · ${TOPIC ? `pushed to ntfy.sh/${escapeHtml(TOPIC)}` : 'ntfy push disabled'} · refreshes every 5s</p>
<table><tr><th>Received</th><th>Status</th><th>Alert</th><th>Env</th><th>Severity</th><th>Summary</th></tr>${rows || '<tr><td colspan="6" class="muted">No alerts yet</td></tr>'}</table></body></html>`;
}

function metrics() {
  return [
    '# HELP alert_notifier_notifications_total Alert notifications received from Alertmanager',
    '# TYPE alert_notifier_notifications_total counter',
    `alert_notifier_notifications_total ${stats.received}`,
    '# HELP alert_notifier_push_total Notifications pushed to ntfy.sh',
    '# TYPE alert_notifier_push_total counter',
    `alert_notifier_push_total{result="ok"} ${stats.pushed}`,
    `alert_notifier_push_total{result="failed"} ${stats.pushFailed}`,
    '',
  ].join('\n');
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/webhook') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      try {
        record(JSON.parse(body));
        res.writeHead(200).end('ok');
      } catch {
        res.writeHead(400).end('bad payload');
      }
    });
    return;
  }
  const routes = {
    '/health': () => ['application/json', JSON.stringify({ status: 'ok' })],
    '/api/alerts': () => ['application/json', JSON.stringify({ ...stats, events })],
    '/metrics': () => ['text/plain; version=0.0.4', metrics()],
    '/': () => ['text/html; charset=utf-8', page()],
  };
  const route = routes[req.url.split('?')[0]];
  if (!route) return res.writeHead(404).end('not found');
  const [type, content] = route();
  return res.writeHead(200, { 'Content-Type': type }).end(content);
});

server.listen(PORT, '127.0.0.1', () => console.log(`alert-notifier listening on http://127.0.0.1:${PORT}`));
