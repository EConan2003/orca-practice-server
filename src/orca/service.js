'use strict';

const { RUN_ID } = require('./runner');

// task-list returns deps as a JSON-encoded string ("[\"task_a\"]"); expose an array.
function parseDeps(deps) {
  if (Array.isArray(deps)) return deps.filter((d) => typeof d === 'string');
  if (typeof deps !== 'string' || deps.trim() === '') return [];
  try {
    const parsed = JSON.parse(deps);
    return Array.isArray(parsed) ? parsed.filter((d) => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

// Workspaces look like "<repoId>::<path>"; the lane is the path's last segment.
function laneOf(workspace) {
  if (typeof workspace !== 'string') return null;
  const sep = workspace.indexOf('::');
  const path = sep >= 0 ? workspace.slice(sep + 2) : workspace;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

const list = (value) => (Array.isArray(value) ? value : []);

function errorMessage(err) {
  return (err && err.message) || 'orca CLI unavailable';
}

// Wraps a runner with a short-lived cache keyed by command line. Settled results (including
// failures) are kept for ttlMs so an auto-refreshing page does not hammer the CLI, and
// concurrent requests for the same key share one process.
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

  // Returns {status, body}: 400 invalid id, 404 unknown run, else 200 (live or unavailable).
  async function getRun(id) {
    if (typeof id !== 'string' || !RUN_ID.test(id)) {
      return { status: 400, body: { error: 'invalid run id' } };
    }
    const args = ['--run', id];
    const results = await Promise.allSettled([
      run('run-show', ['--id', id]),
      run('task-list', args),
      run('worker-list', args),
      run('gate-list', args),
    ]);
    const notFound = results.find(
      (r) => r.status === 'rejected' && r.reason && r.reason.code === 'run_not_found',
    );
    if (notFound) {
      return { status: 404, body: { error: `run not found: ${id}` } };
    }
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) {
      return {
        status: 200,
        body: {
          source: 'unavailable',
          error: errorMessage(failed.reason),
          run: null,
          tasks: [],
          workers: [],
          gates: [],
        },
      };
    }
    const [show, tasks, workers, gates] = results.map((r) => r.value || {});
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

  return { listRuns, getRun, inbox };
}

module.exports = { parseDeps, laneOf, createCachedRunner, createOrcaService };
