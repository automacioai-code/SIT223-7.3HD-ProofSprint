'use strict';

/**
 * Shared helpers for the Jenkins pipeline scripts. Plain Node.js (no dependencies), so every
 * stage runs the same way on a Windows or Linux Jenkins agent.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log('[pipeline]', ...args);

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index > -1 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) {
    return process.argv[index + 1];
  }
  return fallback;
}

const flag = (name) => process.argv.includes(`--${name}`);

async function http(url, { method = 'GET', headers = {}, body, timeoutMs = 5000, form } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const finalHeaders = { ...headers };
  let payload;
  if (form) {
    payload = new URLSearchParams(form).toString();
    finalHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  } else if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    finalHeaders['Content-Type'] = finalHeaders['Content-Type'] || 'application/json';
  }
  try {
    const res = await fetch(url, { method, headers: finalHeaders, body: payload, signal: controller.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, ok: res.ok, text, json };
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(description, check, { timeoutMs = 60000, intervalMs = 2000 } = {}) {
  const started = Date.now();
  let lastError = '';
  while (Date.now() - started < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (err) {
      lastError = err.message;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for ${description}${lastError ? ` (${lastError})` : ''}`);
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Parses KEY=VALUE environment files (comments and blank lines ignored, CRLF safe). */
function readEnvFile(file) {
  const env = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return env;
}

function opsRoot() {
  return process.env.OPS_ROOT || path.join(process.env.JENKINS_HOME || path.join(REPO_ROOT, '.ops'), 'proofsprint-ops');
}

const reportsDir = () => path.join(process.cwd(), 'reports');

function table(rows, columns) {
  const widths = columns.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const line = (cells) => cells.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join(' | ');
  return [line(columns), widths.map((w) => '-'.repeat(w)).join('-|-'), ...rows.map((r) => line(columns.map((c) => r[c])))].join('\n');
}

function markdownTable(rows, columns) {
  const head = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |`;
  return [head, ...rows.map((r) => `| ${columns.map((c) => String(r[c] ?? '').replace(/\|/g, '/')).join(' | ')} |`)].join('\n');
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(message) {
  console.error(`[pipeline] FAILED: ${message}`);
  process.exit(1);
}

module.exports = {
  REPO_ROOT,
  sleep,
  log,
  arg,
  flag,
  http,
  waitFor,
  writeJson,
  readJson,
  writeText,
  readEnvFile,
  opsRoot,
  reportsDir,
  table,
  markdownTable,
  sha256,
  fail,
};
