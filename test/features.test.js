'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const request = require('supertest');
const { createApp } = require('../src/app');
const { parseFlag, isLoopback, DISABLED_ERROR } = require('../src/features');

// The flag-off tests never reach the runner; fail loudly if they do.
const noRunner = () => Promise.reject(new Error('runner must not be called'));

const GATED = [
  '/dashboard',
  '/dashboard/',
  '/api/orca/features',
  '/api/orca/runs',
  '/api/orca/runs/run_abc',
  '/api/orca/runs/not-a-run',
  '/api/orca/inbox',
  '/api/orca/anything',
];

describe('parseFlag (ORCA_DASHBOARD)', () => {
  for (const v of ['on', 'ON', 'On', 'true', 'TRUE', 'True', '1', ' on ']) {
    test(`"${v}" enables`, () => assert.equal(parseFlag(v), true));
  }
  for (const v of [undefined, null, '', 'off', 'false', '0', 'yes', 'enabled', '2', 'onn', 1, true]) {
    test(`${JSON.stringify(v)} disables`, () => assert.equal(parseFlag(v), false));
  }
});

describe('isLoopback', () => {
  for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
    test(`${a} is loopback`, () => assert.equal(isLoopback(a), true));
  }
  for (const a of [undefined, '', '10.0.0.5', '192.168.1.10', '::ffff:10.0.0.5', '127.0.0.2', '0.0.0.0', 'localhost', '::']) {
    test(`${JSON.stringify(a)} is not loopback`, () => assert.equal(isLoopback(a), false));
  }
});

describe('flag off', () => {
  test('defaults to off when ORCA_DASHBOARD is unset', { skip: process.env.ORCA_DASHBOARD !== undefined }, async () => {
    const app = createApp({ orcaRunner: noRunner });
    const res = await request(app).get('/api/features');
    assert.deepEqual(res.body, { orcaDashboard: { enabled: false } });
    const page = await request(app).get('/dashboard');
    assert.equal(page.status, 404);
    assert.deepEqual(page.body, { error: DISABLED_ERROR });
  });

  for (const path of GATED) {
    test(`GET ${path} returns 404 disabled`, async () => {
      const res = await request(createApp({ orcaDashboard: false, orcaRunner: noRunner })).get(path);
      assert.equal(res.status, 404);
      assert.match(res.headers['content-type'], /application\/json/);
      assert.deepEqual(res.body, { error: DISABLED_ERROR });
    });
  }

  test('/health and /api/items are unaffected', async () => {
    const app = createApp({ orcaDashboard: false, orcaRunner: noRunner });
    assert.equal((await request(app).get('/health')).status, 200);
    assert.equal((await request(app).get('/api/items')).status, 200);
  });
});

describe('GET /api/features', () => {
  test('reports the flag state', async () => {
    const on = await request(createApp({ orcaDashboard: true, orcaRunner: noRunner })).get('/api/features');
    assert.equal(on.status, 200);
    assert.match(on.headers['content-type'], /application\/json/);
    assert.deepEqual(on.body, { orcaDashboard: { enabled: true } });

    const off = await request(createApp({ orcaDashboard: false, orcaRunner: noRunner })).get('/api/features');
    assert.deepEqual(off.body, { orcaDashboard: { enabled: false } });
  });
});

describe('PUT /api/features/orca-dashboard', () => {
  test('toggles on and off at runtime, effective immediately', async () => {
    const app = createApp({ orcaDashboard: false, orcaRunner: noRunner });
    assert.equal((await request(app).get('/dashboard')).status, 404);

    const on = await request(app).put('/api/features/orca-dashboard').send({ enabled: true });
    assert.equal(on.status, 200);
    assert.deepEqual(on.body, { orcaDashboard: { enabled: true } });
    assert.deepEqual((await request(app).get('/api/features')).body, { orcaDashboard: { enabled: true } });

    const page = await request(app).get('/dashboard');
    assert.equal(page.status, 200);
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.text, /<title>Orca dashboard<\/title>/);

    const off = await request(app).put('/api/features/orca-dashboard').send({ enabled: false });
    assert.equal(off.status, 200);
    assert.deepEqual(off.body, { orcaDashboard: { enabled: false } });
    const gone = await request(app).get('/dashboard');
    assert.equal(gone.status, 404);
    assert.deepEqual(gone.body, { error: DISABLED_ERROR });
  });

  const invalid = [
    ['missing', {}],
    ['string "true"', { enabled: 'true' }],
    ['number 1', { enabled: 1 }],
    ['null', { enabled: null }],
    ['array', { enabled: [true] }],
  ];
  for (const [label, body] of invalid) {
    test(`enabled ${label} returns 400 and leaves the flag unchanged`, async () => {
      const app = createApp({ orcaDashboard: false, orcaRunner: noRunner });
      const res = await request(app).put('/api/features/orca-dashboard').send(body);
      assert.equal(res.status, 400);
      assert.match(res.headers['content-type'], /application\/json/);
      assert.equal(typeof res.body.error, 'string');
      assert.deepEqual((await request(app).get('/api/features')).body, { orcaDashboard: { enabled: false } });
    });
  }

  test('no body returns 400', async () => {
    const res = await request(createApp({ orcaRunner: noRunner, orcaDashboard: false })).put('/api/features/orca-dashboard');
    assert.equal(res.status, 400);
  });

  test('a forwarding header does not change the loopback decision', async () => {
    // Loopback client claiming to be remote: still allowed, the header is ignored.
    const res = await request(createApp({ orcaDashboard: false, orcaRunner: noRunner }))
      .put('/api/features/orca-dashboard')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ enabled: true });
    assert.equal(res.status, 200);
  });

  // A real request from a non-loopback socket address: listen on all interfaces and connect
  // through this machine's own LAN address. Skipped when the machine has no such address.
  const lanAddress = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);

  test('returns 403 from a non-loopback address, even with X-Forwarded-For: 127.0.0.1', { skip: !lanAddress && 'no non-loopback IPv4 interface' }, async (t) => {
    const app = createApp({ orcaDashboard: false, orcaRunner: noRunner });
    const server = await new Promise((resolve, reject) => {
      const s = app.listen(0, '0.0.0.0', () => resolve(s));
      s.on('error', reject);
    });
    t.after(() => server.close());
    const base = `http://${lanAddress.address}:${server.address().port}`;

    const res = await request(base)
      .put('/api/features/orca-dashboard')
      .set('X-Forwarded-For', '127.0.0.1')
      .send({ enabled: true });
    assert.equal(res.status, 403);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(typeof res.body.error, 'string');

    const state = await request(base).get('/api/features');
    assert.deepEqual(state.body, { orcaDashboard: { enabled: false } });
  });
});
