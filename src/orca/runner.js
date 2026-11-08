'use strict';

const childProcess = require('node:child_process');

const RUN_ID = /^run_[A-Za-z0-9_]+$/;
const LIMIT = /^[0-9]{1,3}$/;

// The only Orca commands the dashboard may run, all read-only, with the flags each one
// accepts and the pattern its value must match. Anything else is refused before exec.
const ALLOWED = {
  'run-list': {},
  'run-show': { '--id': RUN_ID },
  'task-list': { '--run': RUN_ID },
  'worker-list': { '--run': RUN_ID },
  'gate-list': { '--run': RUN_ID },
  inbox: { '--limit': LIMIT },
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
  if (!Array.isArray(args) || args.length % 2 !== 0) {
    throw new OrcaError('orca arguments must be flag/value pairs', 'bad_arguments');
  }
  const flags = ALLOWED[cmd];
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    const pattern = Object.prototype.hasOwnProperty.call(flags, flag) ? flags[flag] : null;
    if (!pattern || typeof value !== 'string' || !pattern.test(value)) {
      throw new OrcaError(`orca argument not allowed: ${cmd} ${flag}`, 'bad_arguments');
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

module.exports = { ALLOWED, RUN_ID, OrcaError, createOrcaRunner };
