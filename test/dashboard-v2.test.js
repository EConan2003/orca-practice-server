'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const request = require('supertest');
const { createApp } = require('../src/app');
const { createOrcaRunner, OrcaError } = require('../src/orca/runner');
const { toIso, parseJsonField, normalizeWorkerOutput, MAX_ENTRY_TEXT } = require('../src/orca/normalize');
const { featureCatalog } = require('../src/orca/catalog');
const { learnContent } = require('../src/orca/learn');
const { DISABLED_ERROR } = require('../src/features');

const RUN = 'run_7f5cb91f8e76';
const TERM_DEPLOY = 'term_c8afd78f-c26f-4c0d-a5e1-a3a61ad42a10';
const TERM_BUILD = 'term_d29873ad-fa14-4c3b-a6e5-d364bf38d819';
const WS = 'ad6ded64-315a-40fc-84f9-18e5950d31f3::C:/Users/Huyen/orca/workspaces/orca-practice-server/';

// Internal fields Orca returns with --full that must never reach a client.
const INTERNAL_TASK = {
  created_by_terminal_handle: 'term_secret',
  created_by_pane_key: 'pane_secret',
  created_by_process_incarnation: 'inc_secret',
  created_by_run_generation: 7,
};
const INTERNAL_MSG = {
  delivery_contract: 'current_delivery',
  sender_pane_key: 'pane_secret',
  pointer_enter_pending: 0,
  pointer_pty_id: 'pty_secret',
  pointer_process_incarnation: 'inc_secret',
};

// Shapes copied from real `orca orchestration ... --json --full` output on this machine.
function fixtures() {
  return {
    tasks: [
      {
        id: 'task_b8083d340a88', run_id: RUN, parent_id: null, task_title: 'B1 server v1', display_name: null,
        spec: 'ROLE: build\nImplement server v1.', status: 'completed', deps: '[]',
        result: JSON.stringify({ provenance: 'worker_report', outcome: 'succeeded', messageId: 'msg_4bf7687f973e', subject: 'B1 done', body: 'Done.', filesModified: ['src/app.js'] }),
        created_at: '2026-11-08 08:36:32', completed_at: '2026-11-08T08:40:25.801Z', ...INTERNAL_TASK,
      },
      {
        id: 'task_0be5f222cc19', run_id: RUN, parent_id: null, task_title: 'D1 CI pipeline', display_name: null,
        spec: 'ROLE: deploy', status: 'completed', deps: '[]',
        result: JSON.stringify({ outcome: 'succeeded', messageId: 'msg_6994d4f7647d' }),
        created_at: '2026-11-08 08:36:33', completed_at: '2026-11-08T10:00:29.944Z', ...INTERNAL_TASK,
      },
      {
        id: 'task_8e01b8e3917a', run_id: RUN, parent_id: null, task_title: 'D2 release', display_name: null,
        spec: 'ROLE: deploy, release', status: 'completed', deps: '["task_0be5f222cc19"]',
        result: JSON.stringify({ outcome: 'succeeded', messageId: 'msg_a6fec79167ac' }),
        created_at: '2026-11-08 08:36:36', completed_at: '2026-11-08T10:10:07.006Z', ...INTERNAL_TASK,
      },
      {
        id: 'task_0d26033afd92', run_id: RUN, parent_id: 'task_7e9d7fa904ca', task_title: 'F3 dashboard v2', display_name: null,
        spec: 'TASK F3', status: 'dispatched', deps: 'not json', result: '{broken',
        created_at: '2026-11-08 10:28:21', completed_at: null, ...INTERNAL_TASK,
      },
    ],
    messages: [
      {
        id: 'msg_a6fec79167ac', run_id: RUN, from_handle: TERM_DEPLOY, to_handle: `run:${RUN}`,
        subject: 'D2 done: v0.1.0 released', body: 'Added release.yml', type: 'worker_done', priority: 'normal', thread_id: null,
        payload: JSON.stringify({ taskId: 'task_8e01b8e3917a', dispatchId: 'ctx_95a520c3be59', outcome: 'succeeded', filesModified: ['.github/workflows/release.yml'] }),
        read: 1, sequence: 22, created_at: '2026-11-08T10:10:07Z', delivered_at: '2026-11-08T10:10:07Z', ...INTERNAL_MSG,
      },
      {
        id: 'msg_e7c48c6f040e', run_id: RUN, from_handle: 'term_06fab150', to_handle: 'dispatch:ctx_7c79743c9651',
        subject: 'FYI: build lane dispatch changed', body: 'FYI', type: 'status', priority: 'normal', thread_id: null,
        payload: null, read: 1, sequence: 3, created_at: '2026-11-08T08:45:00Z', delivered_at: null, ...INTERNAL_MSG,
      },
      {
        id: 'msg_4bf7687f973e', run_id: RUN, from_handle: TERM_BUILD, to_handle: `run:${RUN}`,
        subject: 'B1 done', body: 'Built B1', type: 'worker_done', priority: 'normal', thread_id: null,
        payload: '{"taskId":"task_b8083d340a88","dispatchId":"ctx_c1a1b5ec7094","outcome":"succeeded"}',
        read: 1, sequence: 1, created_at: '2026-11-08T08:40:25Z', delivered_at: '2026-11-08T08:40:25Z', ...INTERNAL_MSG,
      },
      {
        id: 'msg_stop_224f2023be765ec44e700223', run_id: RUN, from_handle: TERM_DEPLOY, to_handle: `run:${RUN}`,
        subject: 'Worker stopped without reporting', body: 'Stopped', type: 'escalation', priority: 'high', thread_id: null,
        payload: '{bad json', read: 1, sequence: 5, created_at: '2026-11-08T09:00:00Z', delivered_at: '2026-11-08T09:00:00Z', ...INTERNAL_MSG,
      },
      {
        id: 'msg_otherrun1', run_id: 'run_other', from_handle: 'term_x', to_handle: 'run:run_other',
        subject: 'Other run', body: 'x', type: 'status', priority: 'normal', thread_id: null, payload: null,
        read: 0, sequence: 9, created_at: '2026-11-08T09:30:00Z', delivered_at: null, ...INTERNAL_MSG,
      },
    ],
    workers: [
      { dispatchId: 'ctx_95a520c3be59', taskId: 'task_8e01b8e3917a', state: 'succeeded', liveness: 'live', agent: 'claude', terminal: TERM_DEPLOY, terminalState: 'retained', workspace: `${WS}deploy`, host: 'local' },
      { dispatchId: 'ctx_7c79743c9651', taskId: 'task_0be5f222cc19', state: 'succeeded', liveness: 'unverifiable', agent: 'claude', terminal: TERM_DEPLOY, terminalState: 'retained', workspace: `${WS}deploy`, host: 'local' },
      { dispatchId: 'ctx_c1a1b5ec7094', taskId: 'task_b8083d340a88', state: 'succeeded', liveness: 'unverifiable', workspace: `${WS}build`, host: 'local' },
    ],
    output: {
      ctx_95a520c3be59: {
        dispatchId: 'ctx_95a520c3be59', source: 'transcript', provider: 'claude',
        transcript: {
          messages: [
            { id: 'a', role: 'assistant', timestamp: 1794132419516, blocks: [{ type: 'tool-call', name: 'Bash', input: { command: 'orca orchestration ask', description: 'Ask' }, callId: 't1' }] },
            { id: 'b', role: 'tool', timestamp: 1794132420778, blocks: [{ type: 'tool-result', output: 'Question msg_x sent.', callId: 't1' }] },
            { id: 'c', role: 'assistant', blocks: [{ type: 'text', text: 'x'.repeat(5000) }] },
            { id: 'd', role: 'reasoning', blocks: [{ type: 'thinking-signature', data: 'opaque' }, { type: 'image' }, null] },
          ],
        },
        warnings: ['clipped'],
      },
      ctx_7c79743c9651: {
        dispatchId: 'ctx_7c79743c9651', source: 'terminal',
        terminal: { handle: TERM_DEPLOY, status: 'running', tail: ['$ npm test', 'ok 1'], truncated: false },
      },
    },
  };
}

// Fake runner over the fixtures; records calls and reports unknown ids like the real CLI.
function fakeRunner({ fail } = {}) {
  const fx = fixtures();
  const calls = [];
  const runner = async (cmd, args = []) => {
    calls.push([cmd, ...args]);
    if (fail) throw fail;
    const arg = (flag) => args[args.indexOf(flag) + 1];
    const runArg = args.includes('--run') ? arg('--run') : args.includes('--id') ? arg('--id') : null;
    if (runArg !== null && runArg !== RUN) throw new OrcaError(`Run ${runArg} was not found.`, 'run_not_found');
    switch (cmd) {
      case 'task-list':
        return { runId: RUN, tasks: args.includes('--full') ? fx.tasks : fx.tasks.map((t) => ({ id: t.id, status: t.status, title: t.task_title })) };
      case 'inbox':
        return { messages: fx.messages.slice(0, Number(arg('--limit'))) };
      case 'worker-list':
        return { workers: fx.workers, scope: { run: RUN } };
      case 'run-show':
        return { runId: RUN, objective: 'Build and release' };
      case 'gate-list':
        return { gates: [], runId: RUN };
      case 'run-list':
        return { runs: [{ id: RUN, objective: 'Build and release' }] };
      case 'worker-read': {
        const out = fx.output[arg('--dispatch')];
        if (!out) throw new OrcaError(`Dispatch ${arg('--dispatch')} was not found.`, 'dispatch_not_found');
        return out;
      }
      default:
        throw new Error(`unexpected command ${cmd}`);
    }
  };
  runner.calls = calls;
  return runner;
}

const appWith = (runner, orcaDashboard = true) => createApp({ orcaDashboard, orcaRunner: runner });
const FORBIDDEN = /created_by|pointer_|sender_pane_key|delivery_contract|pane_secret|pty_secret|inc_secret|term_secret/;

const NEW_ROUTES = [
  '/api/orca/learn',
  `/api/orca/runs/${RUN}/timeline`,
  `/api/orca/runs/${RUN}/tasks/task_8e01b8e3917a`,
  '/api/orca/messages/msg_a6fec79167ac',
  '/api/orca/workers/ctx_95a520c3be59/output',
];
const DETAIL_ROUTES = NEW_ROUTES.slice(2);

describe('runner allow-list v2', () => {
  function fakeExec() {
    const calls = [];
    const execFile = (file, args, options, cb) => {
      calls.push(args);
      setImmediate(() => cb(null, '{"ok":true,"result":{}}', ''));
    };
    execFile.calls = calls;
    return execFile;
  }

  const allowed = [
    ['task-list', ['--run', RUN, '--full']],
    ['task-list', ['--full', '--run', RUN]],
    ['task-list', ['--run', RUN]],
    ['inbox', ['--limit', '100', '--full']],
    ['inbox', ['--limit', '1']],
    ['worker-read', ['--dispatch', 'ctx_95a520c3be59', '--limit', '200']],
    ['worker-read', ['--dispatch', 'ctx_95a520c3be59', '--limit', '1']],
  ];
  for (const [cmd, args] of allowed) {
    test(`allows ${cmd} ${args.join(' ')}`, async () => {
      const execFile = fakeExec();
      await createOrcaRunner({ execFile })(cmd, args);
      assert.deepEqual(execFile.calls[0], ['orchestration', cmd, ...args, '--json']);
    });
  }

  const refused = [
    ['--full on a command without it', 'run-list', ['--full']],
    ['--full on worker-list', 'worker-list', ['--run', RUN, '--full']],
    ['--full on worker-read', 'worker-read', ['--dispatch', 'ctx_a1', '--limit', '5', '--full']],
    ['a value after a boolean flag', 'task-list', ['--run', RUN, '--full', 'yes']],
    ['a repeated boolean flag', 'task-list', ['--run', RUN, '--full', '--full']],
    ['a repeated value flag', 'task-list', ['--run', RUN, '--run', RUN]],
    ['an unknown boolean flag', 'task-list', ['--run', RUN, '--ready']],
    ['a missing required flag', 'task-list', ['--full']],
    ['worker-read without --limit', 'worker-read', ['--dispatch', 'ctx_a1']],
    ['worker-read --limit 201', 'worker-read', ['--dispatch', 'ctx_a1', '--limit', '201']],
    ['worker-read --limit 0', 'worker-read', ['--dispatch', 'ctx_a1', '--limit', '0']],
    ['inbox --limit 101', 'inbox', ['--limit', '101']],
    ['worker-read with a bad dispatch id', 'worker-read', ['--dispatch', 'ctx_a-1', '--limit', '5']],
    ['worker-read --source', 'worker-read', ['--dispatch', 'ctx_a1', '--limit', '5', '--source', 'terminal']],
    ['worker-read --cursor', 'worker-read', ['--dispatch', 'ctx_a1', '--limit', '5', '--cursor', 'x']],
    ['a non-string flag', 'task-list', ['--run', RUN, 1]],
    ['mutating worker-stop', 'worker-stop', ['--dispatch', 'ctx_a1']],
    ['mutating gate-resolve', 'gate-resolve', []],
  ];
  for (const [label, cmd, args] of refused) {
    test(`refuses ${label}`, () => {
      const execFile = fakeExec();
      assert.throws(() => createOrcaRunner({ execFile })(cmd, args), OrcaError);
      assert.equal(execFile.calls.length, 0);
    });
  }
});

describe('normalization helpers', () => {
  test('toIso normalizes Orca timestamps to ISO 8601 UTC with Z', () => {
    assert.equal(toIso('2026-11-08 08:36:32'), '2026-11-08T08:36:32.000Z');
    assert.equal(toIso('2026-11-08T08:40:25.801Z'), '2026-11-08T08:40:25.801Z');
    assert.equal(toIso('2026-11-08T10:10:07Z'), '2026-11-08T10:10:07.000Z');
    assert.equal(toIso('2026-11-08T12:10:07+02:00'), '2026-11-08T10:10:07.000Z');
    assert.equal(toIso(1794132419516), new Date(1794132419516).toISOString());
    for (const bad of [null, undefined, '', 'yesterday', '12:00', {}]) assert.equal(toIso(bad), null);
  });

  test('parseJsonField keeps the raw string when JSON is bad', () => {
    assert.deepEqual(parseJsonField('{"a":1}'), { a: 1 });
    assert.equal(parseJsonField('{broken'), '{broken');
    assert.equal(parseJsonField(null), null);
    assert.equal(parseJsonField(''), null);
    assert.deepEqual(parseJsonField({ a: 1 }), { a: 1 });
  });

  test('worker output tolerates unknown blocks and truncates long text', () => {
    const { outputSource, entries } = normalizeWorkerOutput(fixtures().output.ctx_95a520c3be59);
    assert.equal(outputSource, 'transcript');
    assert.equal(entries.length, 5);
    assert.deepEqual(entries[0], {
      role: 'assistant', kind: 'tool-call', text: 'Bash: Ask\n$ orca orchestration ask', at: new Date(1794132419516).toISOString(),
    });
    assert.equal(entries[1].kind, 'tool-result');
    assert.equal(entries[1].text, 'Question msg_x sent.');
    assert.equal(entries[2].text.length, MAX_ENTRY_TEXT);
    assert.equal(entries[2].truncated, true);
    assert.deepEqual(entries[3], { role: 'reasoning', kind: 'thinking-signature', text: '[thinking-signature]' });
    assert.deepEqual(entries[4], { role: 'reasoning', kind: 'image', text: '[image]' });
  });

  test('worker output from terminal lines', () => {
    const r = normalizeWorkerOutput(fixtures().output.ctx_7c79743c9651);
    assert.equal(r.outputSource, 'terminal');
    assert.deepEqual(r.entries, [
      { role: 'terminal', kind: 'line', text: '$ npm test' },
      { role: 'terminal', kind: 'line', text: 'ok 1' },
    ]);
    assert.deepEqual(normalizeWorkerOutput({}), { outputSource: null, entries: [] });
  });
});

describe('GET /api/orca/learn', () => {
  test('returns lifecycle, glossary and states', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get('/api/orca/learn');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /application\/json/);
    const { lifecycle, glossary, states } = res.body;
    assert.equal(runner.calls.length, 0, 'static content needs no CLI');

    assert.deepEqual(lifecycle.map((s) => s.id), ['run', 'task', 'dispatch', 'work', 'messages', 'report', 'gate', 'merge', 'main-updated', 'follow-up']);
    const catalogIds = new Set(featureCatalog().map((f) => f.id));
    for (const s of lifecycle) {
      assert.equal(typeof s.title, 'string');
      const sentences = s.explain.split(/(?<=[.!?])\s+/).filter(Boolean);
      assert.ok(sentences.length >= 2 && sentences.length <= 4, `${s.id}: ${sentences.length} sentences`);
      assert.ok(Array.isArray(s.commands) && s.commands.length > 0, s.id);
      assert.ok(s.relatedFeatureIds.length > 0, s.id);
      for (const id of s.relatedFeatureIds) assert.ok(catalogIds.has(id), `${s.id} references unknown feature ${id}`);
    }

    assert.ok(glossary.length >= 20, `${glossary.length} glossary terms`);
    const terms = new Set(glossary.map((g) => g.term));
    for (const t of ['Run', 'Task', 'Dispatch', 'Worker', 'Coordinator', 'Lane', 'Worktree', 'Spec', 'worker_done', 'escalation',
      'question', 'reply', 'Decision gate', 'Merge gate', 'Follow-up', 'keep-open', 'liveness', 'Terminal state', 'retained',
      'released', 'Contract', 'Lane guard', 'Issue routing']) {
      assert.ok(terms.has(t), `glossary misses ${t}`);
    }
    for (const g of glossary) {
      assert.equal(typeof g.meaning, 'string');
      assert.ok(Array.isArray(g.seeAlso));
      for (const s of g.seeAlso) assert.ok(terms.has(s), `${g.term} sees unknown term ${s}`);
    }

    for (const v of ['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked']) assert.ok(states.taskStatus[v], v);
    for (const v of ['ready', 'running', 'succeeded', 'failed']) assert.ok(states.workerState[v], v);
    for (const v of ['live', 'unverifiable']) assert.ok(states.liveness[v], v);
    for (const v of ['active', 'reclaimable', 'retained', 'release_pending', 'release_unknown', 'released']) assert.ok(states.terminalState[v], v);
    for (const v of ['question', 'escalation', 'worker_done', 'status']) assert.ok(states.messageType[v], v);
  });

  test('content is a fresh copy per call', () => {
    const a = learnContent();
    a.glossary.length = 0;
    assert.ok(learnContent().glossary.length >= 20);
  });
});

describe('GET /api/orca/runs/:id/timeline', () => {
  test('events are oldest first, normalized, laned and free of internal fields', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get(`/api/orca/runs/${RUN}/timeline`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'live');
    const { events } = res.body;
    assert.doesNotMatch(JSON.stringify(res.body), FORBIDDEN);

    const ats = events.map((e) => e.at);
    assert.deepEqual([...ats].sort(), ats, 'sorted oldest first');
    for (const at of ats) assert.match(at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    assert.deepEqual(events[0], { at: '2026-11-08T08:36:32.000Z', kind: 'task_created', title: 'B1 server v1', taskId: 'task_b8083d340a88', deps: [], lane: 'build' });
    const d2Created = events.find((e) => e.kind === 'task_created' && e.taskId === 'task_8e01b8e3917a');
    assert.deepEqual(d2Created.deps, ['task_0be5f222cc19']);

    // At 10:10:07 the worker_done message (…07.000Z) precedes the completion (…07.006Z).
    const doneIdx = events.findIndex((e) => e.messageId === 'msg_a6fec79167ac' && e.kind === 'message');
    const completedIdx = events.findIndex((e) => e.kind === 'task_completed' && e.taskId === 'task_8e01b8e3917a');
    assert.ok(doneIdx >= 0 && completedIdx > doneIdx);
    assert.deepEqual(events[doneIdx], {
      at: '2026-11-08T10:10:07.000Z', kind: 'message', type: 'worker_done', title: 'D2 done: v0.1.0 released',
      messageId: 'msg_a6fec79167ac', from: TERM_DEPLOY, to: `run:${RUN}`, priority: 'normal',
      taskId: 'task_8e01b8e3917a', dispatchId: 'ctx_95a520c3be59', outcome: 'succeeded', lane: 'deploy',
    });
    assert.deepEqual(events[completedIdx], {
      at: '2026-11-08T10:10:07.006Z', kind: 'task_completed', title: 'D2 release', taskId: 'task_8e01b8e3917a',
      status: 'completed', outcome: 'succeeded', messageId: 'msg_a6fec79167ac', lane: 'deploy',
    });

    // Dispatch from the recipient address gives the lane; bad JSON payload is tolerated.
    const fyi = events.find((e) => e.messageId === 'msg_e7c48c6f040e');
    assert.equal(fyi.dispatchId, 'ctx_7c79743c9651');
    assert.equal(fyi.lane, 'deploy');
    const stop = events.find((e) => e.messageId === 'msg_stop_224f2023be765ec44e700223');
    assert.equal(stop.type, 'escalation');
    assert.equal(stop.taskId, undefined);

    assert.ok(!events.some((e) => e.messageId === 'msg_otherrun1'), 'messages of other runs are excluded');
    assert.ok(!events.some((e) => e.kind === 'task_completed' && e.taskId === 'task_0d26033afd92'), 'open task has no completion');

    assert.deepEqual(runner.calls.map((c) => c.join(' ')).sort(), [
      'inbox --limit 100 --full', `task-list --run ${RUN} --full`, `worker-list --run ${RUN}`,
    ]);
  });

  test('cache keys include all args: --full and concise task-list are separate calls', async () => {
    const runner = fakeRunner();
    const app = appWith(runner);
    await request(app).get(`/api/orca/runs/${RUN}`);
    await request(app).get(`/api/orca/runs/${RUN}/timeline`);
    await request(app).get(`/api/orca/runs/${RUN}/timeline`);
    const taskCalls = runner.calls.filter((c) => c[0] === 'task-list').map((c) => c.join(' '));
    assert.deepEqual(taskCalls.sort(), [`task-list --run ${RUN}`, `task-list --run ${RUN} --full`]);
  });

  test('unknown run gives 404, invalid id 400, CLI failure 200 unavailable', async () => {
    assert.equal((await request(appWith(fakeRunner())).get('/api/orca/runs/run_nope/timeline')).status, 404);
    assert.equal((await request(appWith(fakeRunner())).get('/api/orca/runs/bad-id/timeline')).status, 400);
    const res = await request(appWith(fakeRunner({ fail: new OrcaError('spawn orca ENOENT', 'ENOENT') }))).get(`/api/orca/runs/${RUN}/timeline`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { source: 'unavailable', error: 'spawn orca ENOENT', runId: RUN, events: [] });
  });
});

describe('GET /api/orca/runs/:id/tasks/:taskId', () => {
  test('returns the contract task shape with parsed deps and result', async () => {
    const res = await request(appWith(fakeRunner())).get(`/api/orca/runs/${RUN}/tasks/task_8e01b8e3917a`);
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'live');
    assert.deepEqual(res.body.task, {
      id: 'task_8e01b8e3917a', title: 'D2 release', status: 'completed', deps: ['task_0be5f222cc19'], parentId: null,
      spec: 'ROLE: deploy, release', result: { outcome: 'succeeded', messageId: 'msg_a6fec79167ac' },
      createdAt: '2026-11-08T08:36:36.000Z', completedAt: '2026-11-08T10:10:07.006Z',
    });
    assert.doesNotMatch(JSON.stringify(res.body), FORBIDDEN);
  });

  test('bad JSON in deps and result is tolerated', async () => {
    const res = await request(appWith(fakeRunner())).get(`/api/orca/runs/${RUN}/tasks/task_0d26033afd92`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.task.deps, []);
    assert.equal(res.body.task.result, '{broken');
    assert.equal(res.body.task.parentId, 'task_7e9d7fa904ca');
    assert.equal(res.body.task.completedAt, null);
  });

  test('404 for an unknown task or run, 400 for bad ids', async () => {
    const app = appWith(fakeRunner());
    const unknownTask = await request(app).get(`/api/orca/runs/${RUN}/tasks/task_doesnotexist`);
    assert.equal(unknownTask.status, 404);
    assert.equal(typeof unknownTask.body.error, 'string');
    assert.equal((await request(app).get('/api/orca/runs/run_nope/tasks/task_8e01b8e3917a')).status, 404);
    for (const path of [
      `/api/orca/runs/${RUN}/tasks/task_a-b`, `/api/orca/runs/${RUN}/tasks/task_`, `/api/orca/runs/${RUN}/tasks/TASK_abc`,
      `/api/orca/runs/${RUN}/tasks/task_a_b`, '/api/orca/runs/run-x/tasks/task_abc',
    ]) {
      assert.equal((await request(app).get(path)).status, 400, path);
    }
  });

  test('CLI failure gives 200 unavailable', async () => {
    const res = await request(appWith(fakeRunner({ fail: new Error('boom') }))).get(`/api/orca/runs/${RUN}/tasks/task_8e01b8e3917a`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { source: 'unavailable', error: 'boom', task: null });
  });
});

describe('GET /api/orca/messages/:id', () => {
  test('returns the contract message shape with parsed payload', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get('/api/orca/messages/msg_a6fec79167ac');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, {
      source: 'live',
      message: {
        id: 'msg_a6fec79167ac', runId: RUN, type: 'worker_done', from: TERM_DEPLOY, to: `run:${RUN}`,
        subject: 'D2 done: v0.1.0 released', priority: 'normal', body: 'Added release.yml',
        payload: { taskId: 'task_8e01b8e3917a', dispatchId: 'ctx_95a520c3be59', outcome: 'succeeded', filesModified: ['.github/workflows/release.yml'] },
        createdAt: '2026-11-08T10:10:07.000Z', deliveredAt: '2026-11-08T10:10:07.000Z',
      },
    });
    assert.deepEqual(runner.calls, [['inbox', '--limit', '100', '--full']]);
  });

  test('ids with underscores are valid; bad payload JSON stays a string', async () => {
    const res = await request(appWith(fakeRunner())).get('/api/orca/messages/msg_stop_224f2023be765ec44e700223');
    assert.equal(res.status, 200);
    assert.equal(res.body.message.payload, '{bad json');
    assert.doesNotMatch(JSON.stringify(res.body), FORBIDDEN);
  });

  test('404 unknown, 400 bad id, 200 unavailable', async () => {
    assert.equal((await request(appWith(fakeRunner())).get('/api/orca/messages/msg_nothere')).status, 404);
    for (const bad of ['msg-1', 'msg_', 'message_1', 'msg_a-b']) {
      assert.equal((await request(appWith(fakeRunner())).get(`/api/orca/messages/${bad}`)).status, 400, bad);
    }
    const res = await request(appWith(fakeRunner({ fail: new Error('boom') }))).get('/api/orca/messages/msg_a6fec79167ac');
    assert.deepEqual(res.body, { source: 'unavailable', error: 'boom', message: null });
  });
});

describe('GET /api/orca/workers/:dispatchId/output', () => {
  test('returns normalized transcript entries with the default limit 50', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get('/api/orca/workers/ctx_95a520c3be59/output');
    assert.equal(res.status, 200);
    assert.equal(res.body.source, 'live');
    assert.equal(res.body.dispatchId, 'ctx_95a520c3be59');
    assert.equal(res.body.outputSource, 'transcript');
    assert.equal(res.body.entries.length, 5);
    for (const e of res.body.entries) {
      assert.equal(typeof e.role, 'string');
      assert.equal(typeof e.kind, 'string');
      assert.ok(e.text.length <= MAX_ENTRY_TEXT);
    }
    assert.deepEqual(runner.calls, [['worker-read', '--dispatch', 'ctx_95a520c3be59', '--limit', '50']]);
  });

  test('terminal output and an explicit limit', async () => {
    const runner = fakeRunner();
    const res = await request(appWith(runner)).get('/api/orca/workers/ctx_7c79743c9651/output?limit=200');
    assert.equal(res.body.outputSource, 'terminal');
    assert.equal(res.body.entries.length, 2);
    assert.deepEqual(runner.calls, [['worker-read', '--dispatch', 'ctx_7c79743c9651', '--limit', '200']]);
  });

  test('404 unknown dispatch, 400 bad id or limit, 200 unavailable', async () => {
    assert.equal((await request(appWith(fakeRunner())).get('/api/orca/workers/ctx_unknown1/output')).status, 404);
    for (const path of ['/api/orca/workers/ctx_a-b/output', '/api/orca/workers/ctx_a_b/output', '/api/orca/workers/dispatch1/output',
      '/api/orca/workers/ctx_abc/output?limit=0', '/api/orca/workers/ctx_abc/output?limit=201', '/api/orca/workers/ctx_abc/output?limit=x']) {
      assert.equal((await request(appWith(fakeRunner())).get(path)).status, 400, path);
    }
    const res = await request(appWith(fakeRunner({ fail: new Error('boom') }))).get('/api/orca/workers/ctx_abc/output');
    assert.deepEqual(res.body, { source: 'unavailable', error: 'boom', dispatchId: 'ctx_abc', outputSource: null, entries: [] });
  });
});

describe('flag off', () => {
  for (const path of NEW_ROUTES) {
    test(`GET ${path} returns 404 disabled without calling the CLI`, async () => {
      const runner = fakeRunner();
      const res = await request(appWith(runner, false)).get(path);
      assert.equal(res.status, 404);
      assert.deepEqual(res.body, { error: DISABLED_ERROR });
      assert.equal(runner.calls.length, 0);
    });
  }
});

describe('loopback only detail endpoints', () => {
  test('loopback clients get details even with a forwarding header', async () => {
    for (const path of DETAIL_ROUTES) {
      const res = await request(appWith(fakeRunner())).get(path).set('X-Forwarded-For', '203.0.113.7');
      assert.equal(res.status, 200, path);
    }
  });

  // Real non-loopback requests: listen on all interfaces and connect through this machine's
  // LAN address. Skipped when there is no such address.
  const lanAddress = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);

  test('non-loopback clients get 403 on every detail endpoint, X-Forwarded-For: 127.0.0.1 or not', { skip: !lanAddress && 'no non-loopback IPv4 interface' }, async (t) => {
    const runner = fakeRunner();
    const server = await new Promise((resolve, reject) => {
      const s = appWith(runner).listen(0, '0.0.0.0', () => resolve(s));
      s.on('error', reject);
    });
    t.after(() => server.close());
    const base = `http://${lanAddress.address}:${server.address().port}`;
    for (const path of DETAIL_ROUTES) {
      for (const xff of [null, '127.0.0.1']) {
        const req = request(base).get(path);
        if (xff) req.set('X-Forwarded-For', xff);
        const res = await req;
        assert.equal(res.status, 403, `${path} xff=${xff}`);
        assert.equal(typeof res.body.error, 'string');
      }
    }
    // Non-detail routes stay readable from the network, as CONTRACT 4.1 says.
    assert.equal((await request(base).get(`/api/orca/runs/${RUN}/timeline`)).status, 200);
    assert.equal((await request(base).get('/api/orca/learn')).status, 200);
    assert.ok(!runner.calls.some((c) => c[0] === 'worker-read'), 'no detail call reached the CLI');
  });
});

describe('dashboard page v2', () => {
  test('has the three views, the detail drawer and no HTML sinks', async () => {
    const res = await request(appWith(fakeRunner())).get('/dashboard');
    assert.equal(res.status, 200);
    for (const id of ['view-live', 'view-history', 'view-learn', 'drawer', 'history-filters', 'flow', 'glossary-search', 'states']) {
      assert.ok(res.text.includes(`id="${id}"`), id);
    }
    for (const endpoint of ['/api/orca/learn', '/timeline', '/tasks/', '/api/orca/messages/', '/output?limit=']) {
      assert.ok(res.text.includes(endpoint), endpoint);
    }
    assert.doesNotMatch(res.text, /\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write|eval\(/);
    assert.doesNotMatch(res.text, /<script[^>]+src=|<link[^>]+stylesheet/i);
  });
});
