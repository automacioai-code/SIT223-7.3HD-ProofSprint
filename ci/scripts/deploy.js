'use strict';

/**
 * Deploy (staging) and Release (production) stages.
 * Installs the versioned artefact from the artefact repository into its own release folder,
 * (re)starts it under PM2 with the environment's configuration (deploy/<env>.env), verifies it
 * with health, version and smoke tests, and rolls back to the previous release on failure.
 *   node ci/scripts/deploy.js --env staging --version 1.0.12 [--simulate-failure]
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('./lib');
const { runSmoke } = require('./smoke');
const { toolPath } = require('./ensure-tools');

const { REPO_ROOT, arg, flag, opsRoot, readEnvFile, readJson, writeJson, http, waitFor, log, fail, sha256, reportsDir, table } = lib;

// Keep PM2 and the apps it supervises running after this Jenkins build finishes.
process.env.JENKINS_NODE_COOKIE = 'dontKillMe';
process.env.BUILD_ID = 'dontKillMe';
process.env.PM2_HOME = process.env.PM2_HOME || path.join(opsRoot(), 'pm2');

const tarBin = () => (process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar');

function loadPm2() {
  return require(path.dirname(toolPath('pm2')));
}

const pm2Call = (pm2, method, ...args) =>
  new Promise((resolve, reject) => pm2[method](...args, (err, res) => (err ? reject(err) : resolve(res))));

function verifiedArtifact(version) {
  const dir = path.join(opsRoot(), 'artifact-repo', 'proofsprint', version);
  const tgz = path.join(dir, `proofsprint-${version}.tgz`);
  if (!fs.existsSync(tgz)) fail(`Artefact ${version} is not in the artefact repository (${dir})`);
  const expected = fs.readFileSync(`${tgz}.sha256`, 'utf8').split(/\s+/)[0];
  const actual = sha256(tgz);
  if (actual !== expected) fail(`Checksum mismatch for ${tgz}`);
  log(`Artefact verified: ${path.basename(tgz)} sha256 ${actual.slice(0, 16)}...`);
  return tgz;
}

function installRelease(envDir, version) {
  const tgz = verifiedArtifact(version);
  const releases = path.join(envDir, 'releases');
  const target = path.join(releases, version);
  if (fs.existsSync(path.join(target, 'build-info.json'))) {
    log(`Release folder already present: ${target}`);
    return target;
  }
  const tmp = path.join(releases, `.extract-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  execFileSync(tarBin(), ['-xzf', tgz, '-C', tmp], { stdio: 'inherit' });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(path.join(tmp, `proofsprint-${version}`), target);
  fs.rmSync(tmp, { recursive: true, force: true });
  log(`Installed release ${version} into ${target}`);
  return target;
}

function chaosKey(envDir, enabled) {
  if (!enabled) return '';
  const file = path.join(envDir, 'chaos.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(24).toString('hex'));
  return fs.readFileSync(file, 'utf8').trim();
}

async function startApp(pm2, ctx, release) {
  const info = readJson(path.join(release, 'build-info.json'), {});
  try {
    await pm2Call(pm2, 'delete', ctx.name);
  } catch {
    // first deployment: nothing to stop
  }
  fs.mkdirSync(path.join(ctx.envDir, 'logs'), { recursive: true });
  await pm2Call(pm2, 'start', {
    name: ctx.name,
    script: path.join(release, 'src', 'server.js'),
    cwd: release,
    env: {
      ...ctx.envConfig,
      DATA_DIR: path.join(ctx.envDir, 'data'),
      CHAOS_KEY: ctx.chaosKey,
      APP_VERSION: info.version,
      GIT_SHA: info.gitSha,
      BUILD_NUMBER: String(info.buildNumber),
    },
    out_file: path.join(ctx.envDir, 'logs', 'app.out.log'),
    error_file: path.join(ctx.envDir, 'logs', 'app.err.log'),
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    max_memory_restart: '300M',
    kill_timeout: 5000,
  });
  return info.version;
}

async function verify(ctx, expectedVersion) {
  await waitFor(`${ctx.name} /health`, async () => (await http(`${ctx.base}/health`)).status === 200, { timeoutMs: 60000, intervalMs: 1500 });
  return runSmoke({ base: ctx.base, expectedVersion });
}

async function rollback(pm2, ctx, previous) {
  if (!previous || !fs.existsSync(previous.path)) {
    log('No previous release to roll back to; stopping the failed release.');
    await pm2Call(pm2, 'delete', ctx.name).catch(() => null);
    return null;
  }
  log(`ROLLBACK: restoring ${previous.version} on ${ctx.env}`);
  await startApp(pm2, ctx, previous.path);
  await waitFor('rolled-back release', async () => (await http(`${ctx.base}/version`)).json?.version === previous.version, { timeoutMs: 60000, intervalMs: 1500 });
  log(`ROLLBACK complete: ${ctx.env} is serving ${previous.version} again`);
  return previous.version;
}

function pruneReleases(envDir, keep) {
  const releases = path.join(envDir, 'releases');
  const folders = fs
    .readdirSync(releases)
    .filter((f) => /^\d+\.\d+\.\d+$/.test(f))
    .map((f) => ({ f, t: fs.statSync(path.join(releases, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { f } of folders.slice(5)) {
    if (!keep.includes(f)) fs.rmSync(path.join(releases, f), { recursive: true, force: true });
  }
}

function record(ctx, entry) {
  const historyFile = path.join(ctx.envDir, 'history.json');
  const history = readJson(historyFile, []);
  history.unshift(entry);
  writeJson(historyFile, history.slice(0, 50));
  writeJson(path.join(reportsDir(), `deploy-${ctx.env}.json`), entry);
}

async function main() {
  const env = arg('env');
  const version = arg('version');
  if (!['staging', 'production'].includes(env)) fail('--env must be staging or production');
  const envDir = path.join(opsRoot(), 'environments', env);
  const envConfig = readEnvFile(path.join(REPO_ROOT, 'deploy', `${env}.env`));
  const ctx = {
    env,
    envDir,
    envConfig,
    name: `proofsprint-${env}`,
    base: `http://127.0.0.1:${envConfig.PORT}`,
    chaosKey: chaosKey(envDir, envConfig.CHAOS_ENABLED === 'true'),
  };
  const previous = readJson(path.join(envDir, 'current.json'));
  log(`Deploying ProofSprint ${version} to ${env} (${ctx.base}); previous release: ${previous ? previous.version : 'none'}`);

  const release = installRelease(envDir, version);
  const pm2 = loadPm2();
  await pm2Call(pm2, 'connect');
  const started = Date.now();
  try {
    await startApp(pm2, ctx, release);
    const expected = flag('simulate-failure') ? `${version}-simulated-bad-release` : version;
    if (flag('simulate-failure')) log('SIMULATION: post-deploy verification is expected to fail to demonstrate automatic rollback');
    const smoke = await verify(ctx, expected);
    console.log(table(smoke.results, ['test', 'result', 'ms', 'detail']));
    writeJson(path.join(reportsDir(), `smoke-${env}.json`), { base: ctx.base, ...smoke });
    if (!smoke.ok) {
      const restored = await rollback(pm2, ctx, previous);
      record(ctx, { env, version, result: 'rolled-back', restored, at: new Date().toISOString(), smoke: smoke.results });
      fail(`Post-deploy verification failed on ${env}; ${restored ? `rolled back to ${restored}` : 'release stopped'}`);
    }
    const current = { version, path: release, deployedAt: new Date().toISOString(), previous: previous ? previous.version : null, url: ctx.base };
    writeJson(path.join(envDir, 'current.json'), current);
    pruneReleases(envDir, [version, previous && previous.version].filter(Boolean));
    record(ctx, { env, version, result: 'deployed', seconds: Math.round((Date.now() - started) / 1000), ...current });
    log(`${env} is now serving ProofSprint ${version} at ${ctx.base}`);
  } finally {
    pm2.disconnect();
  }
}

main().catch((err) => fail(err.stack || err.message));
