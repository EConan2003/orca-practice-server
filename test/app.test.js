'use strict';

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');

describe('GET /health', () => {
  test('returns 200 {"status":"ok"}', async () => {
    const res = await request(createApp()).get('/health');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.deepEqual(res.body, { status: 'ok' });
  });
});

describe('/api/items', () => {
  let app;
  beforeEach(() => {
    app = createApp();
  });

  test('GET returns 200 and an empty array initially', async () => {
    const res = await request(app).get('/api/items');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.deepEqual(res.body, []);
  });

  test('POST with a valid name returns 201 and the item with an id', async () => {
    const res = await request(app).post('/api/items').send({ name: 'apple' });
    assert.equal(res.status, 201);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.name, 'apple');
    assert.ok(res.body.id !== undefined && res.body.id !== null);
  });

  test('POSTed items appear in GET with distinct ids', async () => {
    const a = await request(app).post('/api/items').send({ name: 'apple' });
    const b = await request(app).post('/api/items').send({ name: 'pear' });
    assert.notEqual(a.body.id, b.body.id);

    const res = await request(app).get('/api/items');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, [a.body, b.body]);
  });

  const invalidBodies = [
    ['missing name', {}],
    ['empty name', { name: '' }],
    ['numeric name', { name: 42 }],
    ['null name', { name: null }],
    ['array name', { name: ['a'] }],
    ['object name', { name: { x: 1 } }],
  ];
  for (const [label, body] of invalidBodies) {
    test(`POST with ${label} returns 400 {"error": ...}`, async () => {
      const res = await request(app).post('/api/items').send(body);
      assert.equal(res.status, 400);
      assert.match(res.headers['content-type'], /application\/json/);
      assert.equal(typeof res.body.error, 'string');
      assert.ok(res.body.error.length > 0);

      const list = await request(app).get('/api/items');
      assert.deepEqual(list.body, []);
    });
  }

  test('POST with no body returns 400', async () => {
    const res = await request(app).post('/api/items');
    assert.equal(res.status, 400);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(typeof res.body.error, 'string');
  });

  test('POST with malformed JSON returns 400 JSON error', async () => {
    const res = await request(app)
      .post('/api/items')
      .set('Content-Type', 'application/json')
      .send('{"name":');
    assert.equal(res.status, 400);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(typeof res.body.error, 'string');
  });

  test('stores are independent per app instance', async () => {
    await request(app).post('/api/items').send({ name: 'apple' });
    const res = await request(createApp()).get('/api/items');
    assert.deepEqual(res.body, []);
  });
});

describe('unknown routes', () => {
  test('return 404 JSON', async () => {
    const res = await request(createApp()).get('/nope');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(typeof res.body.error, 'string');
  });
});
