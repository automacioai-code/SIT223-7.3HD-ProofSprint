'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, toInt, readOrCreateSecret, readBuildInfo } = require('../../src/config');
const { createStore } = require('../../src/store');
const { routeLabel } = require('../../src/metrics');
const { createChaos } = require('../../src/middleware/chaos');
const { createMetrics } = require('../../src/metrics');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ps-'));

describe('config', () => {
  test('uses safe defaults', () => {
    const config = loadConfig({ DATA_DIR: 'memory' });
    expect(config).toMatchObject({ env: 'development', port: 3000, dataDir: null, version: '0.0.0-dev', chaosKey: '' });
    expect(config.jwtSecret).toHaveLength(64);
  });

  test('reads environment-specific values', () => {
    const config = loadConfig({ DATA_DIR: 'memory', APP_ENV: 'production', PORT: '8080', APP_VERSION: '1.0.7', JWT_SECRET: 'x' });
    expect(config).toMatchObject({ env: 'production', port: 8080, version: '1.0.7', jwtSecret: 'x' });
  });

  test('persists the generated JWT secret in the data directory', () => {
    const dir = tmpDir();
    const first = readOrCreateSecret(dir);
    expect(readOrCreateSecret(dir)).toBe(first);
    expect(loadConfig({ DATA_DIR: dir }).jwtSecret).toBe(first);
  });

  test('reads version details from build-info.json, overridable by env', () => {
    const dir = tmpDir();
    const file = path.join(dir, 'build-info.json');
    fs.writeFileSync(file, JSON.stringify({ version: '1.0.42', gitSha: 'abc1234', buildNumber: 42 }));
    const info = readBuildInfo(file);
    expect(info).toEqual({ APP_VERSION: '1.0.42', GIT_SHA: 'abc1234', BUILD_NUMBER: '42' });
    expect(loadConfig({ DATA_DIR: 'memory' }, info)).toMatchObject({ version: '1.0.42', gitSha: 'abc1234', buildNumber: '42' });
    expect(loadConfig({ DATA_DIR: 'memory', APP_VERSION: '2.0.0' }, info).version).toBe('2.0.0');
    expect(readBuildInfo(path.join(dir, 'missing.json'))).toEqual({});
  });

  test('toInt falls back on invalid numbers', () => {
    expect(toInt('12', 1)).toBe(12);
    expect(toInt('abc', 1)).toBe(1);
  });
});

describe('store', () => {
  test('supports CRUD in memory', () => {
    const store = createStore();
    const row = store.insert('users', { email: 'a@b.co' });
    expect(store.findOne('users', (u) => u.id === row.id)).toMatchObject({ email: 'a@b.co' });
    expect(store.update('users', row.id, { name: 'A' }).name).toBe('A');
    expect(store.update('users', 'missing', {})).toBeNull();
    expect(store.count('users')).toBe(1);
    expect(store.remove('users', row.id)).toBe(true);
    expect(store.remove('users', row.id)).toBe(false);
    expect(store.find('users')).toEqual([]);
    expect(store.isWritable()).toBe(true);
    expect(() => store.find('nope')).toThrow(/Unknown collection/);
  });

  test('persists to disk atomically and reloads', () => {
    const dir = tmpDir();
    createStore({ dataDir: dir }).insert('sprints', { title: 'Saved' });
    const reloaded = createStore({ dataDir: dir });
    expect(reloaded.find('sprints')[0].title).toBe('Saved');
    expect(reloaded.isWritable()).toBe(true);
  });

  test('starts empty when the data file is corrupt', () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, 'proofsprint.json'), '{not json');
    expect(createStore({ dataDir: dir }).count('users')).toBe(0);
  });
});

describe('metrics.routeLabel', () => {
  test('uses the matched route to keep label cardinality low', () => {
    expect(routeLabel({ route: { path: '/:id' }, baseUrl: '/api/sprints', path: '/api/sprints/1' })).toBe('/api/sprints/:id');
    expect(routeLabel({ path: '/api/unknown' })).toBe('unmatched_api');
    expect(routeLabel({ path: '/styles.css' })).toBe('static');
  });
});

describe('chaos mode', () => {
  test('expires automatically after the requested window', () => {
    let now = 0;
    const metrics = createMetrics({ version: 't', gitSha: 't', env: 'test' });
    const chaos = createChaos({ chaosKey: 'k', metrics, now: () => now });
    expect(chaos.current().mode).toBe('off');
    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    chaos.middleware({ path: '/api/x' }, res, next);
    expect(next).toHaveBeenCalled();
    return Promise.resolve().then(() => {
      now = 1000;
      expect(chaos.current().until).toBe(0);
    });
  });
});
