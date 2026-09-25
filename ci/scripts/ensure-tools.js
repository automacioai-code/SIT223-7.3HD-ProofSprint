'use strict';

/**
 * Downloads the portable DevOps tools the pipeline needs into <OPS_ROOT>/tools on first use
 * (no admin rights or installers needed), then reuses them on every later build.
 *   node ci/scripts/ensure-tools.js trivy prometheus      -> installs if missing
 *   node ci/scripts/ensure-tools.js trivy --print         -> prints the executable path
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { opsRoot, log, fail } = require('./lib');

const TOOLS = {
  'sonar-scanner': {
    version: '8.1.0.6389',
    url: (v) => `https://binaries.sonarsource.com/Distribution/sonar-scanner-cli/sonar-scanner-cli-${v}-windows-x64.zip`,
    folder: (v) => `sonar-scanner-${v}-windows-x64`,
    exe: path.join('bin', 'sonar-scanner.bat'),
  },
  trivy: {
    version: '0.74.0',
    url: (v) => `https://github.com/aquasecurity/trivy/releases/download/v${v}/trivy_${v}_windows-64bit.zip`,
    folder: (v) => `trivy-${v}`,
    extractIntoFolder: true,
    exe: 'trivy.exe',
  },
  prometheus: {
    version: '3.14.0',
    url: (v) => `https://github.com/prometheus/prometheus/releases/download/v${v}/prometheus-${v}.windows-amd64.zip`,
    folder: (v) => `prometheus-${v}.windows-amd64`,
    exe: 'prometheus.exe',
  },
  alertmanager: {
    version: '0.34.1',
    url: (v) => `https://github.com/prometheus/alertmanager/releases/download/v${v}/alertmanager-${v}.windows-amd64.zip`,
    folder: (v) => `alertmanager-${v}.windows-amd64`,
    exe: 'alertmanager.exe',
  },
  pm2: { version: '6', npm: true, folder: () => 'pm2', exe: path.join('node_modules', 'pm2', 'package.json') },
};

const toolsDir = () => path.join(opsRoot(), 'tools');

function toolPath(name) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool ${name}`);
  return path.join(toolsDir(), tool.folder(tool.version), tool.exe);
}

async function download(url, file) {
  log(`Downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
}

function extract(zip, dest) {
  fs.mkdirSync(dest, { recursive: true });
  // Windows 10+ ships bsdtar, which extracts .zip archives.
  const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', zip, '-C', dest], { stdio: 'inherit' });
}

async function install(name) {
  const tool = TOOLS[name];
  const target = toolPath(name);
  if (fs.existsSync(target)) return target;
  fs.mkdirSync(toolsDir(), { recursive: true });
  if (tool.npm) {
    const prefix = path.join(toolsDir(), tool.folder());
    log(`Installing ${name}@${tool.version} into ${prefix}`);
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npm, ['install', '--prefix', prefix, `${name}@${tool.version}`, '--no-audit', '--no-fund'], { stdio: 'inherit', shell: process.platform === 'win32' });
    return target;
  }
  const zip = path.join(toolsDir(), `${name}-${tool.version}.zip`);
  await download(tool.url(tool.version), zip);
  extract(zip, tool.extractIntoFolder ? path.join(toolsDir(), tool.folder(tool.version)) : toolsDir());
  fs.rmSync(zip, { force: true });
  if (!fs.existsSync(target)) throw new Error(`${name} was extracted but ${target} is missing`);
  log(`${name} ${tool.version} ready`);
  return target;
}

async function main() {
  const names = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const print = process.argv.includes('--print');
  for (const name of names) {
    const target = await install(name);
    if (print) process.stdout.write(`${name === 'pm2' ? path.dirname(target) : target}\n`);
  }
}

if (require.main === module) {
  main().catch((err) => fail(err.message));
}

module.exports = { TOOLS, toolPath, toolsDir, install };
