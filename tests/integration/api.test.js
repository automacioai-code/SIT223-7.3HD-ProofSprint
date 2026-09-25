'use strict';

const request = require('supertest');
const { buildApp, registerUser, createSprint } = require('./helpers');

describe('platform endpoints', () => {
  const { app } = buildApp();

  test('GET /health, /ready and /version report build information', async () => {
    const health = await request(app).get('/health').expect(200);
    expect(health.body).toMatchObject({ status: 'ok', version: '9.9.9' });
    await request(app).get('/ready').expect(200, { status: 'ready', storage: 'ok' });
    const version = await request(app).get('/version').expect(200);
    expect(version.body).toMatchObject({ version: '9.9.9', environment: 'test' });
  });

  test('GET /metrics exposes Prometheus metrics', async () => {
    await request(app).get('/health');
    const res = await request(app).get('/metrics').expect(200);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('proofsprint_app_info');
    expect(res.text).toContain('process_resident_memory_bytes');
  });

  test('serves the web app and the participant page', async () => {
    const home = await request(app).get('/').expect(200);
    expect(home.text).toContain('ProofSprint');
    const page = await request(app).get('/i/abc').expect(200);
    expect(page.text).toContain('interview');
    expect(home.headers['x-powered-by']).toBeUndefined();
    expect(home.headers['content-security-policy']).toBeDefined();
  });

  test('unknown routes return JSON 404s and bad JSON returns 400', async () => {
    await request(app).get('/api/nope').expect(404);
    await request(app).get('/nope.html').expect(404);
    await request(app).post('/api/tools/bias-check').set('Content-Type', 'application/json').send('{bad').expect(400);
  });

  test('POST /api/tools/bias-check validates and flags questions', async () => {
    const res = await request(app).post('/api/tools/bias-check').send({ question: 'Would you buy this?' }).expect(200);
    expect(res.body.ok).toBe(false);
    await request(app).post('/api/tools/bias-check').send({}).expect(400);
  });
});

describe('authentication', () => {
  const { app } = buildApp();

  test('register, login and fetch the current user', async () => {
    const { token, email } = await registerUser(app, 'mia@deakin.edu.au');
    expect(token).toEqual(expect.any(String));
    const login = await request(app).post('/api/auth/login').send({ email, password: 'correct-horse-1' }).expect(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`).expect(200);
    expect(me.body.user).toMatchObject({ email: 'mia@deakin.edu.au', name: 'Founder' });
    expect(me.body.user.passwordHash).toBeUndefined();
  });

  test('rejects duplicates, weak passwords, bad credentials and bad tokens', async () => {
    await registerUser(app, 'dup@deakin.edu.au');
    await request(app).post('/api/auth/register').send({ email: 'dup@deakin.edu.au', password: 'correct-horse-1' }).expect(409);
    await request(app).post('/api/auth/register').send({ email: 'x@deakin.edu.au', password: 'short' }).expect(400);
    await request(app).post('/api/auth/register').send({ email: 'not-an-email', password: 'correct-horse-1' }).expect(400);
    await request(app).post('/api/auth/login').send({ email: 'dup@deakin.edu.au', password: 'wrong-password' }).expect(401);
    await request(app).get('/api/auth/me').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-token').expect(401);
  });

  test('rate-limits repeated login attempts', async () => {
    const limited = buildApp({ authRateLimit: 2 }).app;
    await request(limited).post('/api/auth/login').send({});
    await request(limited).post('/api/auth/login').send({});
    await request(limited).post('/api/auth/login').send({}).expect(429);
  });
});

describe('validation sprints', () => {
  const { app } = buildApp();

  test('create, list, read, update, launch and delete a sprint', async () => {
    const { token } = await registerUser(app);
    const auth = { Authorization: `Bearer ${token}` };
    const sprint = await createSprint(app, token);
    expect(sprint).toMatchObject({ status: 'draft', title: 'Validate ProofSprint' });
    expect(sprint.assumptions[0].category).toBe('problem');
    expect(sprint.bias.score).toBe(100);

    const list = await request(app).get('/api/sprints').set(auth).expect(200);
    expect(list.body.sprints).toHaveLength(1);
    await request(app).get(`/api/sprints/${sprint.id}`).set(auth).expect(200);

    const patched = await request(app)
      .patch(`/api/sprints/${sprint.id}`)
      .set(auth)
      .send({ title: 'Renamed', questions: [{ text: 'Would you use our app?' }, { text: 'How do you plan today?' }] })
      .expect(200);
    expect(patched.body.sprint.title).toBe('Renamed');
    expect(patched.body.sprint.bias).toMatchObject({ flagged: 1, score: 50 });

    const launched = await request(app).post(`/api/sprints/${sprint.id}/launch`).set(auth).expect(200);
    expect(launched.body.inviteUrl).toBe(`/i/${sprint.inviteToken}`);
    await request(app).delete(`/api/sprints/${sprint.id}`).set(auth).expect(204);
    await request(app).get(`/api/sprints/${sprint.id}`).set(auth).expect(404);
  });

  test('validates input and hides other founders\' sprints', async () => {
    const owner = await registerUser(app);
    const other = await registerUser(app);
    const sprint = await createSprint(app, owner.token);
    const asOther = { Authorization: `Bearer ${other.token}` };
    await request(app).get(`/api/sprints/${sprint.id}`).set(asOther).expect(404);
    await request(app).post('/api/sprints').set(asOther).send({ idea: 'x' }).expect(400);
    await request(app).post('/api/sprints').set(asOther).send({ title: 'T', idea: 'short' }).expect(400);
    await request(app).patch(`/api/sprints/${sprint.id}`).set({ Authorization: `Bearer ${owner.token}` }).send({ questions: [] }).expect(400);
    await request(app).get('/api/sprints').expect(401);
  });
});

describe('participant interviews and insights', () => {
  const { app } = buildApp();

  test('full chat interview flow feeds the insight report', async () => {
    const { token } = await registerUser(app);
    const sprint = await createSprint(app, token);
    const base = `/api/interviews/${sprint.inviteToken}`;

    const info = await request(app).get(base).expect(200);
    expect(info.body).toMatchObject({ title: 'Validate ProofSprint', open: false });
    await request(app).post(`${base}/start`).send({ consent: true }).expect(409);

    await request(app).post(`/api/sprints/${sprint.id}/launch`).set('Authorization', `Bearer ${token}`).expect(200);
    await request(app).post(`${base}/start`).send({ consent: false }).expect(400);
    const start = await request(app).post(`${base}/start`).send({ consent: true, alias: 'Sam' }).expect(201);

    let reply = { body: { done: false, question: start.body.question } };
    let guard = 0;
    while (!reply.body.done && guard < 20) {
      reply = await request(app)
        .post(`${base}/${start.body.interviewId}/answer`)
        .send({ text: 'It is really hard and frustrating to find people to talk to every single week' })
        .expect(200);
      guard += 1;
    }
    expect(reply.body.done).toBe(true);
    await request(app).post(`${base}/${start.body.interviewId}/answer`).send({ text: 'extra' }).expect(409);
    await request(app).post(`${base}/missing/answer`).send({ text: 'hi' }).expect(404);
    await request(app).get('/api/interviews/not-a-token').expect(404);

    const insights = await request(app).get(`/api/sprints/${sprint.id}/insights`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(insights.body.insights.interviews).toEqual({ total: 1, completed: 1 });
    expect(insights.body.insights.decision).toBe('keep-testing');
  });
});

describe('incident simulation (chaos mode)', () => {
  test('is disabled without a key', async () => {
    const { app } = buildApp();
    await request(app).post('/api/admin/chaos').send({ mode: 'errors' }).expect(404);
  });

  test('requires the key, then fails API calls until switched off', async () => {
    const { app } = buildApp({ chaosKey: 'secret-key' });
    await request(app).post('/api/admin/chaos').set('X-Chaos-Key', 'wrong').send({ mode: 'errors' }).expect(403);
    await request(app).post('/api/admin/chaos').set('X-Chaos-Key', 'secret-key').send({ mode: 'bogus' }).expect(400);
    const on = await request(app).post('/api/admin/chaos').set('X-Chaos-Key', 'secret-key').send({ mode: 'errors', durationSeconds: 30 }).expect(200);
    expect(on.body.mode).toBe('errors');
    await request(app).post('/api/tools/bias-check').send({ question: 'How?' }).expect(500);
    await request(app).get('/health').expect(200);
    const status = await request(app).get('/api/admin/chaos').set('X-Chaos-Key', 'secret-key').expect(200);
    expect(status.body.mode).toBe('errors');
    await request(app).post('/api/admin/chaos').set('X-Chaos-Key', 'secret-key').send({ mode: 'off' }).expect(200);
    await request(app).post('/api/tools/bias-check').send({ question: 'How?' }).expect(200);
  });

  test('latency mode slows API calls down', async () => {
    const { app } = buildApp({ chaosKey: 'k' });
    await request(app).post('/api/admin/chaos').set('X-Chaos-Key', 'k').send({ mode: 'latency', durationSeconds: 5 }).expect(200);
    const started = Date.now();
    await request(app).post('/api/tools/bias-check').send({ question: 'How?' }).expect(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
  });
});
