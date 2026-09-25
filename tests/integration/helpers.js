'use strict';

const request = require('supertest');
const pino = require('pino');
const { loadConfig } = require('../../src/config');
const { createStore } = require('../../src/store');
const { createApp } = require('../../src/app');

const IDEA =
  'Student founders waste months building products nobody needs because interviewing customers without bias is hard.';

function buildApp(overrides = {}) {
  const config = { ...loadConfig({ DATA_DIR: 'memory', APP_ENV: 'test', APP_VERSION: '9.9.9', BCRYPT_ROUNDS: '4' }), ...overrides };
  const store = createStore();
  const app = createApp({ config, store, logger: pino({ level: 'silent' }) });
  return { app, store, config };
}

async function registerUser(app, email = `founder${Date.now()}${Math.random()}@deakin.edu.au`) {
  const res = await request(app).post('/api/auth/register').send({ email, password: 'correct-horse-1', name: 'Founder' });
  return { token: res.body.token, user: res.body.user, email };
}

async function createSprint(app, token, body = {}) {
  const res = await request(app)
    .post('/api/sprints')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Validate ProofSprint', idea: IDEA, targetCustomer: 'Student founders', ...body });
  return res.body.sprint;
}

module.exports = { buildApp, registerUser, createSprint, IDEA };
