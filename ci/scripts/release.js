'use strict';

/**
 * Release stage bookkeeping after the production deployment succeeds: creates the annotated
 * Git tag v<version>, pushes it when Git credentials are available, and writes the release
 * manifest and release notes that are archived with the build.
 *   node ci/scripts/release.js --version 1.0.12
 */

const path = require('path');
const { execFileSync } = require('child_process');
const { REPO_ROOT, arg, opsRoot, readJson, writeJson, writeText, reportsDir, log } = require('./lib');

function git(args, options = {}) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}

function tryGit(args, options) {
  try {
    return { ok: true, out: git(args, options) };
  } catch (err) {
    return { ok: false, out: String(err.stderr || err.message).trim().split('\n').pop() };
  }
}

function tagRelease(version, previousVersion) {
  const tag = `v${version}`;
  tryGit(['tag', '-d', tag]);
  const tagged = tryGit(['tag', '-a', tag, '-m', `ProofSprint ${version} released to production by Jenkins build ${process.env.BUILD_NUMBER || 'local'}`]);
  const previousTag = previousVersion ? `v${previousVersion}` : null;
  const range = previousTag && tryGit(['rev-parse', '--verify', previousTag]).ok ? `${previousTag}..HEAD` : '-15';
  const notes = tryGit(['log', '--pretty=format:- %h %s (%an)', range]).out;
  const pushed = tryGit(['push', 'origin', tag, '--force'], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    timeout: 30000,
  });
  log(pushed.ok ? `Pushed tag ${tag} to origin` : `Tag ${tag} created locally (push skipped: ${pushed.out})`);
  return { tag, tagged: tagged.ok, pushed: pushed.ok, notes };
}

function main() {
  const version = arg('version');
  const production = readJson(path.join(opsRoot(), 'environments', 'production', 'current.json'), {});
  const index = readJson(path.join(opsRoot(), 'artifact-repo', 'proofsprint', 'index.json'), { versions: [] });
  const artifact = index.versions.find((v) => v.version === version) || {};
  const release = tagRelease(version, production.previous);
  const manifest = {
    version,
    tag: release.tag,
    gitSha: tryGit(['rev-parse', 'HEAD']).out,
    artifact: `proofsprint-${version}.tgz`,
    sha256: artifact.sha256 || null,
    environment: 'production',
    url: production.url || null,
    deployedAt: production.deployedAt || null,
    previousVersion: production.previous || null,
    tagPushed: release.pushed,
    jenkinsBuild: process.env.BUILD_URL || null,
  };
  writeJson(path.join(reportsDir(), 'release-manifest.json'), manifest);
  const notes = release.notes || '- (no commits found)';
  writeText(
    path.join(reportsDir(), 'release-notes.md'),
    `# ProofSprint ${version}\n\nReleased to production ${manifest.deployedAt} (previous: ${manifest.previousVersion || 'none'}).\nArtefact ${manifest.artifact} sha256 ${manifest.sha256}\n\n## Changes\n${notes}\n`,
  );
  log(`Release ${release.tag} recorded (${release.tagged ? 'tag created' : 'tag failed'}); manifest in reports/release-manifest.json`);
}

main();
