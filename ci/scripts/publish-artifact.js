'use strict';

/**
 * Build stage: computes the SHA-256 checksum of the artefact and publishes it to the local
 * artefact repository (<OPS_ROOT>/artifact-repo), which Deploy and Release install from.
 */

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, arg, opsRoot, readJson, writeJson, log, fail, sha256 } = require('./lib');

function main() {
  const version = arg('version');
  const name = `proofsprint-${version}.tgz`;
  const artifact = path.join(REPO_ROOT, 'dist', name);
  if (!fs.existsSync(artifact)) fail(`Artefact not found: ${artifact}`);

  const checksum = sha256(artifact);
  fs.writeFileSync(`${artifact}.sha256`, `${checksum}  ${name}\n`);

  const repo = path.join(opsRoot(), 'artifact-repo', 'proofsprint');
  const target = path.join(repo, version);
  fs.mkdirSync(target, { recursive: true });
  fs.copyFileSync(artifact, path.join(target, name));
  fs.copyFileSync(`${artifact}.sha256`, path.join(target, `${name}.sha256`));
  fs.copyFileSync(path.join(REPO_ROOT, 'dist', 'build-info.json'), path.join(target, 'build-info.json'));

  const indexFile = path.join(repo, 'index.json');
  const index = readJson(indexFile, { versions: [] });
  index.versions = [...index.versions.filter((v) => v.version !== version), { version, sha256: checksum, publishedAt: new Date().toISOString() }];
  writeJson(indexFile, index);

  const sizeMb = (fs.statSync(artifact).size / 1024 / 1024).toFixed(1);
  log(`Artefact ${name} (${sizeMb} MB, sha256 ${checksum.slice(0, 16)}...) published to ${target}`);
}

main();
