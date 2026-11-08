'use strict';

const { RUN_ID, DISPATCH_ID } = require('./runner');
const {
  parseDeps,
  laneOf,
  normalizeTask,
  normalizeMessage,
  normalizeWorkerOutput,
} = require('./normalize');

// Path id formats from CONTRACT 4.1.
const IDS = {
  run: RUN_ID,
  task: /^task_[A-Za-z0-9]+$/,
  message: /^msg_[A-Za-z0-9_]+$/,
  dispatch: DISPATCH_ID,
};

const NOT_FOUND_CODES = new Set(['run_not_found', 'task_not_found', 'dispatch_not_found', 'message_not_found']);

const list = (value) => (Array.isArray(value) ? value : []);
const validId = (kind, id) => typeof id === 'string' && IDS[kind].test(id);
const badRequest = (what) => ({ status: 400, body: { error: `invalid ${what} id` } });
const notFound = (what, id) => ({ status: 404, body: { error: `${what} not found: ${id}` } });

function errorMessage(err) {
  return (err && err.message) || 'orca CLI unavailable';
}

// Wraps a runner with a short-lived cache keyed by the full command line. Settled results
// (including failures) are kept for ttlMs so an auto-refreshing page does not hammer the
// CLI, and concurrent requests for the same key share one process.
function createCachedRunner(runner, { ttlMs = 3000, now = Date.now } = {}) {
  const cache = new Map();
  return function cachedRun(cmd, args = []) {
    const key = JSON.stringify([cmd, args]);
    const t = now();
    const hit = cache.get(key);
    if (hit && (hit.settledAt === null || t - hit.settledAt < ttlMs)) return hit.promise;

    for (const [k, v] of cache) {
      if (v.settledAt !== null && t - v.settledAt >= ttlMs) cache.delete(k);
    }
    const entry = { settledAt: null, promise: null };
    entry.promise = Promise.resolve()
      .then(() => runner(cmd, args))
      .finally(() => {
        entry.settledAt = now();
      });
    // Keep a rejected promise from being reported as unhandled while it sits in the cache.
    entry.promise.catch(() => {});
    cache.set(key, entry);
    return entry.promise;
  };
}

// Runs several CLI calls. Returns {values} when all succeed, {notFound} when Orca says an
// id does not exist, otherwise {error} (CLI unavailable or failing).
async function settleAll(calls) {
  const results = await Promise.allSettled(calls);
  const missing = results.find(
    (r) => r.status === 'rejected' && r.reason && NOT_FOUND_CODES.has(r.reason.code),
  );
  if (missing) return { notFound: missing.reason };
  const failed = results.find((r) => r.status === 'rejected');
  if (failed) return { error: errorMessage(failed.reason) };
  return { values: results.map((r) => r.value || {}) };
}

const KIND_ORDER = { task_created: 0, message: 1, task_completed: 2 };

function buildTimeline(runId, tasks, messages, workers) {
  const laneByDispatch = {};
  const laneByTask = {};
  for (const w of workers) {
    const lane = laneOf(w && w.workspace);
    if (!lane) continue;
    if (w.dispatchId) laneByDispatch[w.dispatchId] = lane;
    if (w.taskId && !laneByTask[w.taskId]) laneByTask[w.taskId] = lane;
  }
  const withLane = (event, lane) => (lane ? { ...event, lane } : event);

  const events = [];
  for (const t of tasks) {
    const lane = laneByTask[t.id];
    if (t.createdAt) {
      events.push(withLane({ at: t.createdAt, kind: 'task_created', title: t.title, taskId: t.id, deps: t.deps }, lane));
    }
    if (t.completedAt) {
      const result = t.result && typeof t.result === 'object' ? t.result : {};
      const event = {
        at: t.completedAt,
        kind: 'task_completed',
        title: t.title,
        taskId: t.id,
        status: t.status,
        outcome: typeof result.outcome === 'string' ? result.outcome : t.status,
      };
      if (typeof result.messageId === 'string') event.messageId = result.messageId;
      events.push(withLane(event, lane));
    }
  }
  for (const m of messages) {
    if (m.runId !== runId) continue;
    const payload = m.payload && typeof m.payload === 'object' ? m.payload : {};
    const toDispatch = /^dispatch:(ctx_[A-Za-z0-9]+)$/.exec(m.to || '');
    const dispatchId = typeof payload.dispatchId === 'string' ? payload.dispatchId : toDispatch ? toDispatch[1] : null;
    const taskId = typeof payload.taskId === 'string' ? payload.taskId : null;
    const event = {
      at: m.createdAt,
      kind: 'message',
      type: m.type,
      title: m.subject || m.type,
      messageId: m.id,
      from: m.from,
      to: m.to,
      priority: m.priority,
    };
    if (taskId) event.taskId = taskId;
    if (dispatchId) event.dispatchId = dispatchId;
    if (typeof payload.outcome === 'string') event.outcome = payload.outcome;
    events.push(withLane(event, (dispatchId && laneByDispatch[dispatchId]) || (taskId && laneByTask[taskId])));
  }

  // Oldest first; undated events last. Ties: created < messages < completed, then input order.
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      if (a.e.at !== b.e.at) {
        if (!a.e.at) return 1;
        if (!b.e.at) return -1;
        return a.e.at < b.e.at ? -1 : 1;
      }
      return KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] || a.i - b.i;
    })
    .map(({ e }) => e);
}

function createOrcaService({ runner, ttlMs = 3000, now } = {}) {
  const run = createCachedRunner(runner, { ttlMs, now });

  async function listRuns() {
    try {
      const result = await run('run-list', []);
      return { source: 'live', runs: list(result && result.runs) };
    } catch (err) {
      return { source: 'unavailable', error: errorMessage(err), runs: [] };
    }
  }

  // Each lookup returns {status, body}: 400 invalid id, 404 unknown, else 200 (live or unavailable).
  async function getRun(id) {
    if (!validId('run', id)) return badRequest('run');
    const args = ['--run', id];
    const r = await settleAll([
      run('run-show', ['--id', id]),
      run('task-list', args),
      run('worker-list', args),
      run('gate-list', args),
    ]);
    if (r.notFound) return notFound('run', id);
    if (r.error) {
      return {
        status: 200,
        body: { source: 'unavailable', error: r.error, run: null, tasks: [], workers: [], gates: [] },
      };
    }
    const [show, tasks, workers, gates] = r.values;
    return {
      status: 200,
      body: {
        source: 'live',
        run: show,
        tasks: list(tasks.tasks).map((t) => ({ ...t, deps: parseDeps(t && t.deps) })),
        workers: list(workers.workers).map((w) => ({ ...w, lane: laneOf(w && w.workspace) })),
        gates: list(gates.gates),
      },
    };
  }

  async function inbox(limit) {
    try {
      const result = await run('inbox', ['--limit', String(limit)]);
      return { source: 'live', messages: list(result && result.messages) };
    } catch (err) {
      return { source: 'unavailable', error: errorMessage(err), messages: [] };
    }
  }

  async function getTimeline(id) {
    if (!validId('run', id)) return badRequest('run');
    const r = await settleAll([
      run('task-list', ['--run', id, '--full']),
      run('inbox', ['--limit', '100', '--full']),
      run('worker-list', ['--run', id]),
    ]);
    if (r.notFound) return notFound('run', id);
    if (r.error) return { status: 200, body: { source: 'unavailable', error: r.error, runId: id, events: [] } };
    const [tasks, messages, workers] = r.values;
    const events = buildTimeline(
      id,
      list(tasks.tasks).map(normalizeTask),
      list(messages.messages).map(normalizeMessage),
      list(workers.workers),
    );
    return { status: 200, body: { source: 'live', runId: id, events } };
  }

  async function getTask(runId, taskId) {
    if (!validId('run', runId)) return badRequest('run');
    if (!validId('task', taskId)) return badRequest('task');
    const r = await settleAll([run('task-list', ['--run', runId, '--full'])]);
    if (r.notFound) return notFound('run', runId);
    if (r.error) return { status: 200, body: { source: 'unavailable', error: r.error, task: null } };
    const raw = list(r.values[0].tasks).find((t) => t && t.id === taskId);
    if (!raw) return notFound('task', taskId);
    return { status: 200, body: { source: 'live', task: normalizeTask(raw) } };
  }

  async function getMessage(id) {
    if (!validId('message', id)) return badRequest('message');
    const r = await settleAll([run('inbox', ['--limit', '100', '--full'])]);
    if (r.error) return { status: 200, body: { source: 'unavailable', error: r.error, message: null } };
    const raw = r.values && list(r.values[0].messages).find((m) => m && m.id === id);
    if (!raw) return notFound('message', id);
    return { status: 200, body: { source: 'live', message: normalizeMessage(raw) } };
  }

  async function getWorkerOutput(dispatchId, limit) {
    if (!validId('dispatch', dispatchId)) return badRequest('dispatch');
    const r = await settleAll([run('worker-read', ['--dispatch', dispatchId, '--limit', String(limit)])]);
    if (r.notFound) return notFound('dispatch', dispatchId);
    if (r.error) {
      return {
        status: 200,
        body: { source: 'unavailable', error: r.error, dispatchId, outputSource: null, entries: [] },
      };
    }
    const { outputSource, entries } = normalizeWorkerOutput(r.values[0]);
    return { status: 200, body: { source: 'live', dispatchId, outputSource, entries } };
  }

  return { listRuns, getRun, inbox, getTimeline, getTask, getMessage, getWorkerOutput };
}

module.exports = { IDS, parseDeps, laneOf, buildTimeline, createCachedRunner, createOrcaService };
