'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Environment-specific configuration. Every value comes from environment variables so the
 * same Docker image can be promoted unchanged from staging to production (12-factor).
 */

function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The JWT signing secret is generated on first start and kept in the data volume, so it is
 * never stored in the repository, the image or the Jenkins logs.
 */
function readOrCreateSecret(dataDir) {
  if (!dataDir) {
    return crypto.randomBytes(32).toString('hex');
  }
  const file = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(file)) {
    return fs.readFileSync(file, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

function resolveDataDir(value) {
  if (value === 'memory') {
    return null;
  }
  return value || path.join(process.cwd(), 'data');
}

const DEFAULTS = {
  APP_ENV: 'development',
  HOST: '0.0.0.0',
  LOG_LEVEL: 'info',
  JWT_TTL: '8h',
  CHAOS_KEY: '',
  APP_VERSION: '0.0.0-dev',
  GIT_SHA: 'local',
  BUILD_NUMBER: '0',
};

/** Version details baked into the build artefact by the Jenkins Build stage (build-info.json). */
function readBuildInfo(file = path.join(__dirname, '..', 'build-info.json')) {
  try {
    const info = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { APP_VERSION: info.version, GIT_SHA: info.gitSha, BUILD_NUMBER: String(info.buildNumber) };
  } catch {
    return {};
  }
}

const definedOnly = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));

function loadConfig(env = process.env, buildInfo = readBuildInfo()) {
  const e = { ...DEFAULTS, ...definedOnly(buildInfo), ...definedOnly(env) };
  const dataDir = resolveDataDir(e.DATA_DIR);
  return {
    env: e.APP_ENV,
    port: toInt(e.PORT, 3000),
    host: e.HOST,
    logLevel: e.LOG_LEVEL,
    dataDir,
    jwtSecret: e.JWT_SECRET || readOrCreateSecret(dataDir),
    jwtTtl: e.JWT_TTL,
    bcryptRounds: toInt(e.BCRYPT_ROUNDS, 10),
    authRateLimit: toInt(e.AUTH_RATE_LIMIT, 50),
    chaosKey: e.CHAOS_KEY,
    version: e.APP_VERSION,
    gitSha: e.GIT_SHA,
    buildNumber: e.BUILD_NUMBER,
  };
}

module.exports = { loadConfig, toInt, readOrCreateSecret, readBuildInfo };
