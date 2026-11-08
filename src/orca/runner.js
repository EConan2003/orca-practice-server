'use strict';

const childProcess = require('node:child_process');

const RUN_ID = /^run_[A-Za-z0-9_]+$/;
const DISPATCH_ID = /^ctx_[A-Za-z0-9]+$/;
const LIMIT_100 = /^(100|[1-9][0-9]?)$/;
const LIMIT_200 = /^(200|1[0-9]{2}|[1-9][0-9]?)$/;

// The only Orca commands the dashboard may run, all read-only. `values` are flags that take
// a value matching the pattern (all required); `booleans` are optional flags with no value.
// Anything else is refused before exec.
const ALLOWED = {
  'run-list': { values: {}, booleans: [] },
  'run-show': { values: { '--id': RUN_ID }, booleans: [] },
  'task-list': { values: { '--run': RUN_ID }, booleans: ['--full'] },
  'worker-list': { values: { '--run': RUN_ID }, booleans: [] },
  'gate-list': { values: { '--run': RUN_ID }, booleans: [] },
  inbox: { values: { '--limit': LIMIT_100 }, booleans: ['--full'] },
  'worker-read': { values: { '--dispatch': DISPATCH_ID, '--limit': LIMIT_200 }, booleans: [] },
};

class OrcaError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'OrcaError';
    this.code = code;
  }
}

function validate(cmd, args) {
  if (!Object.prototype.hasOwnProperty.call(ALLOWED, cmd)) {
    throw new OrcaError(`orca command not allowed: ${cmd}`, 'command_not_allowed');
  }
  if (!Array.isArray(args)) {
    throw new OrcaError('orca arguments must be an array', 'bad_arguments');
  }
  const { values, booleans } = ALLOWED[cmd];
  const seen = new Set();
  const refuse = (flag) => {
    throw new OrcaError(`orca argument not allowed: ${cmd} ${flag}`, 'bad_arguments');
  };
  for (let i = 0; i < args.length; ) {
    const flag = args[i];
    if (typeof flag !== 'string' || seen.has(flag)) refuse(flag);
    seen.add(flag);
    if (booleans.includes(flag)) {
      i += 1;
    } else if (Object.prototype.hasOwnProperty.call(values, flag)) {
      const value = args[i + 1];
      if (typeof value !== 'string' || !values[flag].test(value)) refuse(flag);
      i += 2;
    } else {
      refuse(flag);
    }
  }
  for (const flag of Object.keys(values)) {
    if (!seen.has(flag)) {
      throw new OrcaError(`orca argument missing: ${cmd} ${flag}`, 'bad_arguments');
    }
  }
}

// Parses the `--json` envelope: {"ok":true,"result":...} or {"ok":false,"error":{code,message}}.
function parseEnvelope(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  return parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean' ? parsed : null;
}

// Returns runner(cmd, args) -> Promise<result>, which runs
// `<cli> orchestration <cmd> ...args --json` and resolves with the envelope's result.
function createOrcaRunner({
  cli = process.env.ORCA_CLI || 'orca',
  timeoutMs = 10000,
  execFile = childProcess.execFile,
} = {}) {
  return function runOrca(cmd, args = []) {
    validate(cmd, args);
    const argv = ['orchestration', cmd, ...args, '--json'];
    return new Promise((resolve, reject) => {
      execFile(
        cli,
        argv,
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => {
          // Orca exits non-zero on ok:false but still prints the envelope, so read stdout first.
          const envelope = parseEnvelope(String(stdout || ''));
          if (envelope && envelope.ok) return resolve(envelope.result);
          if (envelope) {
            const e = envelope.error || {};
            return reject(
              new OrcaError(e.message || `orca ${cmd} failed`, e.code || 'orca_error'),
            );
          }
          if (err) {
            const code = err.killed ? 'timeout' : err.code || 'exec_failed';
            const reason = err.killed ? `timed out after ${timeoutMs} ms` : err.message;
            return reject(new OrcaError(`could not run ${cli}: ${reason}`, String(code)));
          }
          return reject(new OrcaError(`orca ${cmd} returned non-JSON output`, 'bad_output'));
        },
      );
    });
  };
}

module.exports = { ALLOWED, RUN_ID, DISPATCH_ID, OrcaError, createOrcaRunner };
