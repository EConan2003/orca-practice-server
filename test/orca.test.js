'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createOrcaRunner, OrcaError, ALLOWED } = require('../src/orca/runner');
const { parseDeps, laneOf, createCachedRunner } = require('../src/orca/service');

const RUN = 'run_7f5cb91f8e76';

// Shapes copied from real `orca orchestration ... --json` output on this machine.
const SAMPLES = {
  'run-list': {
    runs: [
      { id: RUN, objective: 'Build and release orca-practice-server' },
      { id: 'run_legacy_local', objective: 'Legacy orchestration state (inspect only)', legacy: true },
    ],
  },
  'run-show': {
    runId: RUN,
    objective: 'Build and release orca-practice-server',
    removedWork: { coverage: 'complete', tasks: 0, dispatches: 0 },
  },
  'task-list': {
    tasks: [
      { id: 'task_b8083d340a88', status: 'completed', title: 'B1 server v1' },
      { id: 'task_0be5f222cc19', status: 'dispatched', title: 'D1 CI pipeline', dispatchId: 'ctx_7c79743c9651', assignee: 'term_c8afd78f' },
      { id: 'task_8e01b8e3917a', status: 'pending', title: 'D2 release', deps: '["task_0be5f222cc19"]' },
    ],
    runId: RUN,
  },
  'worker-list': {
    workers: [
      {
        dispatchId: 'ctx_7c79743c9651',
        taskId: 'task_0be5f222cc19',
        state: 'ready',
        outcome: 'in_progress',
        liveness: 'live',
        agent: 'claude',
        terminal: 'term_c8afd78f',
        terminalState: 'retained',
        workspace: 'ad6ded64-315a-40fc-84f9-18e5950d31f3::C:/Users/Huyen/orca/workspaces/orca-practice-server/deploy',
        host: 'local',
      },
    ],
    scope: { run: RUN, source: 'flag' },
  },
  'gate-list': { gates: [{ id: 'gate_1', status: 'pending', question: 'Release v1.0.0?' }], runId: RUN },
  inbox: {
    messages: [
      { id: 'msg_1', type: 'worker_done', from: 'term_a', to: 'run:' + RUN, subject: 'B1 done', handled: true, body: '<script>alert(1)</script>' },
      { id: 'msg_2', type: 'question', from: 'term_b', to: 'run:' + RUN, subject: 'Which port?', handled: false, body: '?' },
    ],
  },
};

// Fake runner: records calls, answers from SAMPLES, reports unknown runs like the real CLI.
function fakeRunner({ fail } = {}) {
  const calls = [];
  const runner = async (cmd, args = []) => {
    calls.push([cmd, ...args]);
    if (fail) throw fail;
    const flag = args.find((a) => a === '--run' || a === '--id');
    const runArg = flag ? args[args.indexOf(flag) + 1] : undefined;
    if (flag && runArg !== RUN) {
      throw new OrcaError(`Run ${runArg} was not found.`, 'run_not_found');
    }
    return JSON.parse(JSON.stringify(SAMPLES[cmd]));
  };
  runner.calls = calls;
  return runner;
}

const appWith = (runner) => createApp({ orcaDashboard: true, orcaRunner: runner });

describe('createOrcaRunner', () => {
  // Fake execFile(file, args, options, callback).
  function fakeExec(reply) {
    const calls = [];
    const execFile = (file, args, options, cb) => {
      calls.push({ file, args, options });
      setImmediate(() => reply(cb));
    };
    execFile.calls = calls;
    return execFile;
  }

  test('runs `<cli> orchestration <cmd> ...args --json` with timeout and windowsHide', async () => {
    const execFile = fakeExec((cb) => cb(null, JSON.stringify({ ok: true, result: { runs: [] } }), ''));
    const run = createOrcaRunner({ cli: 'orca-test', execFile });
    assert.deepEqual(await run('task-list', ['--run', RUN]), { runs: [] });
    const [call] = execFile.calls;
    assert.equal(call.file, 'orca-test');
    assert.deepEqual(call.args, ['orchestration', 'task-list', '--run', RUN, '--json']);
    assert.equal(call.options.timeout, 10000);
    assert.equal(call.options.windowsHide, true);
    assert.equal(call.options.shell, undefined);
  });

  test('uses ORCA_CLI semantics: defaults to "orca"', async () => {
    const execFile = fakeExec((cb) => cb(null, '{"ok":true,"result":{}}', ''));
    await createOrcaRunner({ cli: undefined, execFile })('run-list');
    assert.equal(execFile.calls[0].file, process.env.ORCA_CLI || 'orca');
  });

  test('ok:false (non-zero exit) throws with the Orca error code', async () => {
    const stdout = JSON.stringify({ ok: false, error: { code: 'run_not_found', message: 'Run run_x was not found.' } });
    const err = Object.assign(new Error('Command failed'), { code: 1 });
    const run = createOrcaRunner({ execFile: fakeExec((cb) => cb(err, stdout, 'error: run_not_found')) });
    await assert.rejects(run('run-show', ['--id', 'run_x']), { name: 'OrcaError', code: 'run_not_found', message: 'Run run_x was not found.' });
  });

  test('non-JSON output throws', async () => {
    const run = createOrcaRunner({ execFile: fakeExec((cb) => cb(null, 'hello', '')) });
    await assert.rejects(run('run-list'), { code: 'bad_output' });
  });

  test('spawn error (ENOENT) throws', async () => {
    const err = Object.assign(new Error('spawn orca ENOENT'), { code: 'ENOENT' });
    const run = createOrcaRunner({ execFile: fakeExec((cb) => cb(err, '', '')) });
    await assert.rejects(run('run-list'), { code: 'ENOENT' });
  });

  test('timeout throws', async () => {
    const err = Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' });
    const run = createOrcaRunner({ execFile: fakeExec((cb) => cb(err, '', '')) });
    await assert.rejects(run('run-list'), { code: 'timeout' });
  });

  test('only read-only commands are allowed', () => {
    assert.deepEqual(Object.keys(ALLOWED).sort(), ['gate-list', 'inbox', 'run-list', 'run-show', 'task-list', 'worker-list']);
  });

  const refused = [
    ['mutating command', 'task-update', ['--id', 'task_1']],
    ['mutating command', 'send', []],
    ['mutating command', 'reset', []],
    ['unknown flag', 'run-list', ['--all', 'x']],
    ['flag not allowed for command', 'task-list', ['--id', RUN]],
    ['invalid run id', 'task-list', ['--run', 'run_x; rm -rf /']],
    ['run id starting with a dash', 'task-list', ['--run', '--all']],
    ['odd argument count', 'task-list', ['--run']],
    ['non-numeric limit', 'inbox', ['--limit', '5 --full']],
    ['inherited property name', 'constructor', []],
  ];
  for (const [label, cmd, args] of refused) {
    test(`refuses ${label} without running anything`, async () => {
      const execFile = fakeExec((cb) => cb(null, '{"ok":true,"result":{}}', ''));
      const run = createOrcaRunner({ execFile });
      assert.throws(() => run(cmd, args), OrcaError);
      assert.equal(execFile.calls.length, 0);
    });
  }
});

describe('helpers', () => {
  test('parseDeps parses the JSON-encoded string into an array', () => {
    assert.deepEqual(parseDeps('["task_a","task_b"]'), ['task_a', 'task_b']);
    assert.deepEqual(parseDeps(['task_a']), ['task_a']);
    assert.deepEqual(parseDeps(undefined), []);
    assert.deepEqual(parseDeps(''), []);
    assert.deepEqual(parseDeps('not json'), []);
    assert.deepEqual(parseDeps('{"a":1}'), []);
  });

  test('laneOf returns the last path segment of a workspace', () => {
    assert.equal(laneOf('repo::C:/Users/x/orca/workspaces/server/dashboard'), 'dashboard');
    assert.equal(laneOf('repo::C:\\work\\build\\'), 'build');
    assert.equal(laneOf('/srv/deploy'), 'deploy');
    assert.equal(laneOf(undefined), null);
  });

  test('cache reuses results for 3 s, then calls the CLI again', async () => {
    let t = 1000;
    let n = 0;
    const cached = createCachedRunner(async () => ++n, { ttlMs: 3000, now: () => t });
    assert.equal(await cached('run-list', []), 1);
    t += 2999;
    assert.equal(await cached('run-list', []), 1);
    assert.equal(await cached('inbox', ['--limit', '5']), 2, 'different key is not shared');
    t += 1;
    assert.equal(await cached('run-list', []), 3);
  });

  test('concurrent requests share one CLI call', async () => {
    let n = 0;
    const cached = createCachedRunner(() => new Promise((r) => setTimeout(() => r(++n), 5)));
    const [a, b] = await Promise.all([cached('run-list', []), cached('run-list', [])]);
    assert.equal(a, 1);
    assert.equal(b, 1);
  });
});

describe('GET /api/orca/features', () => {
  test('returns the static catalog covering every Orca feature', async () => {
    const res = await request(appWith(fakeRunner())).get('/api/orca/features');
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    for (const f of res.body) {
      assert.equal(typeof f.id, 'string');
      assert.equal(typeof f.name, 'string');
      assert.equal(typeof f.category, 'string');
      assert.equal(typeof f.description, 'string');
      assert.ok(Array.isArray(f.commands) && f.commands.length > 0, f.id);
    }
    const ids = res.body.map((f) => f.id);
    for (const id of ['runs', 'tasks', 'workers', 'messaging', 'gates', 'worktree-placement', 'lanes', 'merge-gate', 'issue-routing', 'contract-changes', 'recovery']) {
      assert.ok(ids.includes(id), `missing ${id}`);
    }
    const all = res.body.flatMap((f) => f.commands).join('\n');
    for (const cmd of [
      'run-create', 'run-use', 'run-list', 'run-show',
      'task-create', 'task-list', 'task-update', '--deps',
      'worker-start', 'worker-show', 'worker-read', 'worker-stop', 'worker-abandon', 'worker-release', 'worker-keep-open', 'worker-list', 'dispatch',
      'send', 'check', 'reply', 'inbox', 'ask', 'worker_done', 'escalation',
      'gate-create', 'gate-resolve', 'gate-list',
      'current', 'new-top-level', 'name:<lane>', '--on', '--environment',
      '.allow', 'pre-commit', 'gh pr merge --squash', 'main updated', 'ROUTING', 'CONTRACT.md',
      'reset', 'request-show',
    ]) {
      assert.ok(all.includes(cmd), `catalog does not mention ${cmd}`);
    }
  });
});

describe('GET /api/orca/runs', () => {
  test('lists runs from the CLI with source live', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get('/api/orca/runs');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(res.body.source, 'live');
    assert.deepEqual(res.body.runs, SAMPLES['run-list'].runs);
    assert.deepEqual(runner.calls, [['run-list']]);
  });

  test('runner failure gives 200 source unavailable with the error', async () => {
    const fail = new OrcaError('could not run orca: spawn orca ENOENT', 'ENOENT');
    const res = await request(appWith(fakeRunner({ fail }))).get('/api/orca/runs');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { source: 'unavailable', error: fail.message, runs: [] });
  });

  test('results are cached between requests', async () => {
    const runner = fakeRunner();
    const app = appWith(runner);
    await request(app).get('/api/orca/runs');
    await request(app).get('/api/orca/runs');
    assert.equal(runner.calls.length, 1);
  });
});

describe('GET /api/orca/runs/:id', () => {
  test('returns run, tasks (deps parsed), workers (with lane) and gates', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get(`/api/orca/runs/${RUN}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'live');
    assert.deepEqual(res.body.run, SAMPLES['run-show']);
    assert.equal(res.body.tasks.length, 3);
    assert.deepEqual(res.body.tasks[2].deps, ['task_0be5f222cc19']);
    assert.deepEqual(res.body.tasks[0].deps, []);
    assert.equal(res.body.workers[0].lane, 'deploy');
    assert.equal(res.body.workers[0].dispatchId, 'ctx_7c79743c9651');
    assert.deepEqual(res.body.gates, SAMPLES['gate-list'].gates);
    assert.deepEqual(
      runner.calls.map((c) => c.join(' ')).sort(),
      [`gate-list --run ${RUN}`, `run-show --id ${RUN}`, `task-list --run ${RUN}`, `worker-list --run ${RUN}`],
    );
  });

  for (const bad of ['not-a-run', 'run_', 'run_a-b', 'run_a%3Bb', 'RUN_abc', '--all']) {
    test(`invalid run id ${bad} returns 400 without calling the CLI`, async () => {
      const runner = fakeRunner();
      const res = await request(appWith(runner)).get(`/api/orca/runs/${bad}`);
      assert.equal(res.status, 400);
      assert.equal(typeof res.body.error, 'string');
      assert.equal(runner.calls.length, 0);
    });
  }

  test('unknown run returns 404', async () => {
    const res = await request(appWith(fakeRunner())).get('/api/orca/runs/run_doesnotexist');
    assert.equal(res.status, 404);
    assert.match(res.headers['content-type'], /application\/json/);
    assert.equal(typeof res.body.error, 'string');
  });

  test('runner failure gives 200 source unavailable', async () => {
    const fail = new OrcaError('timed out', 'timeout');
    const res = await request(appWith(fakeRunner({ fail }))).get(`/api/orca/runs/${RUN}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { source: 'unavailable', error: 'timed out', run: null, tasks: [], workers: [], gates: [] });
  });
});

describe('GET /api/orca/inbox', () => {
  test('returns messages with the default limit 50', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get('/api/orca/inbox');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'live');
    assert.deepEqual(res.body.messages, SAMPLES.inbox.messages);
    assert.deepEqual(runner.calls, [['inbox', '--limit', '50']]);
  });

  test('passes a valid limit through', async () => {
    const runner = fakeRunner();
    await request(appWith(runner)).get('/api/orca/inbox?limit=100');
    await request(appWith(runner)).get('/api/orca/inbox?limit=1');
    assert.deepEqual(runner.calls, [['inbox', '--limit', '100'], ['inbox', '--limit', '1']]);
  });

  for (const bad of ['0', '101', '-1', 'abc', '1.5', '']) {
    test(`limit=${bad} returns 400`, async () => {
      const runner = fakeRunner();
      const res = await request(appWith(runner)).get(`/api/orca/inbox?limit=${bad}`);
      assert.equal(res.status, 400);
      assert.equal(runner.calls.length, 0);
    });
  }

  test('runner failure gives 200 source unavailable', async () => {
    const res = await request(appWith(fakeRunner({ fail: new Error('boom') }))).get('/api/orca/inbox');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { source: 'unavailable', error: 'boom', messages: [] });
  });
});

describe('GET /dashboard', () => {
  test('serves the self-contained page', async () => {
    const res = await request(appWith(fakeRunner())).get('/dashboard');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/html/);
    assert.doesNotMatch(res.text, /<script[^>]+src=/i, 'no external scripts');
    assert.doesNotMatch(res.text, /<link[^>]+stylesheet/i, 'no external stylesheets');
    assert.doesNotMatch(res.text, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/, 'no HTML sinks');
    assert.match(res.text, /prefers-color-scheme: dark/);
    for (const endpoint of ['/api/features', '/api/orca/runs', '/api/orca/inbox', '/api/orca/features']) {
      assert.ok(res.text.includes(endpoint), `page fetches ${endpoint}`);
    }
  });
});
