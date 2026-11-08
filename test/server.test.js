'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

// Ask the OS for a free port so the test never binds a fixed one.
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// Starts src/server.js in a child process with extra env vars; resolves with its base URL.
async function startServer(t, env = {}) {
  const port = await freePort();
  const serverPath = path.join(__dirname, '..', 'src', 'server.js');
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill());

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 10000);
    child.stdout.on('data', (chunk) => {
      if (chunk.toString().includes('listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited early with code ${code}`));
    });
  });
  return `http://127.0.0.1:${port}`;
}

test('server listens on PORT and serves /health', async (t) => {
  const base = await startServer(t);
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: 'ok' });
});

test('ORCA_DASHBOARD=ON enables the dashboard; a missing ORCA_CLI reports unavailable', async (t) => {
  const missingCli = path.join(__dirname, 'no-such-orca-cli');
  const base = await startServer(t, { ORCA_DASHBOARD: 'ON', ORCA_CLI: missingCli });

  const flags = await fetch(`${base}/api/features`);
  assert.deepEqual(await flags.json(), { orcaDashboard: { enabled: true } });

  const page = await fetch(`${base}/dashboard`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);

  const runs = await fetch(`${base}/api/orca/runs`);
  assert.equal(runs.status, 200);
  const body = await runs.json();
  assert.equal(body.source, 'unavailable');
  assert.equal(typeof body.error, 'string');
  assert.deepEqual(body.runs, []);

  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('ORCA_DASHBOARD=off keeps the dashboard disabled', async (t) => {
  const base = await startServer(t, { ORCA_DASHBOARD: 'off' });
  const page = await fetch(`${base}/dashboard`);
  assert.equal(page.status, 404);
  assert.deepEqual(await page.json(), { error: 'orca dashboard is disabled' });
});
