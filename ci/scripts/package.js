'use strict';

/**
 * Build stage: assembles a versioned, self-contained release folder dist/proofsprint-<version>
 * (application code + lockfile + build-info.json). Jenkins then installs production-only
 * dependencies into it and compresses it into proofsprint-<version>.tgz.
 */

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, arg, writeJson, log, fail } = require('./lib');

const INCLUDE = ['src', 'public', 'package.json', 'package-lock.json'];

function main() {
  const version = arg('version');
  if (!/^\d+\.\d+\.\d+$/.test(version || '')) fail('--version must look like 1.0.42');
  const dist = path.join(REPO_ROOT, 'dist');
  const out = path.join(dist, `proofsprint-${version}`);
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  for (const item of INCLUDE) {
    fs.cpSync(path.join(REPO_ROOT, item), path.join(out, item), { recursive: true });
  }
  const pkgFile = path.join(out, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  pkg.version = version;
  fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

  const info = {
    name: 'proofsprint',
    version,
    gitSha: arg('sha', 'local'),
    buildNumber: Number(arg('build', '0')),
    builtAt: new Date().toISOString(),
    node: process.version,
    builtBy: process.env.JOB_NAME ? `Jenkins ${process.env.JOB_NAME}` : 'local',
  };
  writeJson(path.join(out, 'build-info.json'), info);
  writeJson(path.join(dist, 'build-info.json'), info);
  log(`Release folder ready: ${out}`);
}

main();
