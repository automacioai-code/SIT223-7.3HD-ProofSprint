'use strict';

/**
 * Sends the pipeline result to the team channel (ntfy.sh push notification, no account needed).
 *   node ci/scripts/notify.js --status SUCCESS --topic proofsprint-alerts
 */

const { arg, http, log } = require('./lib');

async function main() {
  const status = arg('status', 'UNKNOWN');
  const topic = arg('topic', process.env.NTFY_TOPIC || '');
  if (!topic) return log('No ntfy topic configured; skipping notification');
  const version = process.env.VERSION || '';
  const ok = status === 'SUCCESS';
  const res = await http(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    headers: {
      Title: `ProofSprint pipeline #${process.env.BUILD_NUMBER || '?'} ${status}`,
      Priority: ok ? '3' : '5',
      Tags: ok ? 'white_check_mark,rocket' : 'x,rotating_light',
      ...(process.env.BUILD_URL ? { Click: process.env.BUILD_URL } : {}),
    },
    body: ok ? `v${version} built, tested, scanned and released to production.` : `v${version} failed. Open the Jenkins build for details.`,
    timeoutMs: 10000,
  }).catch((err) => ({ ok: false, status: err.message }));
  log(res.ok ? `Notification sent to ntfy.sh/${topic}` : `Notification not sent (${res.status})`);
}

main();
