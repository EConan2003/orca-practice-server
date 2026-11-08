'use strict';

// Turns raw `orca orchestration ... --json --full` records into the shapes in CONTRACT 4.1.
// Every output object is built from an explicit field list, so internal fields Orca adds
// (created_by_*, sender_pane_key, pointer_*, delivery_contract, ...) are never exposed.

const MAX_ENTRY_TEXT = 4000;

const str = (v) => (typeof v === 'string' ? v : null);

// Orca stores some fields as JSON strings. Bad JSON keeps the raw string; empty/null is null.
function parseJsonField(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return value;
  if (value.trim() === '') return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// Timestamps arrive as ISO with Z, as "2026-11-08 08:36:32" (UTC, no zone) or as epoch ms.
// Returns ISO 8601 UTC with Z ("2026-11-08T08:36:32.000Z"), or null if unparseable.
function toIso(value) {
  if (value === null || value === undefined || value === '') return null;
  let date;
  if (typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'string') {
    let s = value.trim();
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) {
      s = `${s.replace(' ', 'T')}Z`; // no zone given: Orca's SQLite timestamps are UTC
    }
    if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
    date = new Date(s);
  } else {
    return null;
  }
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDeps(deps) {
  const parsed = parseJsonField(deps);
  return Array.isArray(parsed) ? parsed.filter((d) => typeof d === 'string') : [];
}

// Workspaces look like "<repoId>::<path>"; the lane is the path's last segment.
function laneOf(workspace) {
  if (typeof workspace !== 'string') return null;
  const sep = workspace.indexOf('::');
  const path = sep >= 0 ? workspace.slice(sep + 2) : workspace;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

// task-list --full row -> CONTRACT task detail.
function normalizeTask(raw) {
  const t = raw || {};
  return {
    id: str(t.id),
    title: str(t.task_title) || str(t.display_name) || str(t.title) || str(t.id),
    status: str(t.status),
    deps: parseDeps(t.deps),
    parentId: str(t.parent_id),
    spec: str(t.spec),
    result: parseJsonField(t.result),
    createdAt: toIso(t.created_at),
    completedAt: toIso(t.completed_at),
  };
}

// inbox --full row -> CONTRACT message detail.
function normalizeMessage(raw) {
  const m = raw || {};
  return {
    id: str(m.id),
    runId: str(m.run_id),
    type: str(m.type),
    from: str(m.from_handle),
    to: str(m.to_handle),
    subject: str(m.subject),
    priority: str(m.priority),
    body: str(m.body),
    payload: parseJsonField(m.payload),
    createdAt: toIso(m.created_at),
    deliveredAt: toIso(m.delivered_at),
  };
}

function clip(text) {
  const s = typeof text === 'string' ? text : text === undefined || text === null ? '' : JSON.stringify(text);
  return s.length > MAX_ENTRY_TEXT
    ? { text: s.slice(0, MAX_ENTRY_TEXT), truncated: true }
    : { text: s, truncated: false };
}

function blockText(block) {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'tool-call': {
      const input = block.input && typeof block.input === 'object' ? block.input : {};
      const name = str(block.name) || 'tool';
      if (typeof input.command === 'string') {
        return `${name}: ${input.description ? `${input.description}\n` : ''}$ ${input.command}`;
      }
      return `${name} ${JSON.stringify(block.input === undefined ? {} : block.input)}`;
    }
    case 'tool-result':
      return block.output;
    default:
      // Unknown block types: show their type name, plus any text they carry.
      return typeof block.text === 'string' ? `[${block.type}] ${block.text}` : `[${block.type}]`;
  }
}

// worker-read result -> {outputSource, entries: [{role, kind, text, at?, truncated?}]}.
function normalizeWorkerOutput(raw) {
  const r = raw || {};
  const entries = [];
  const push = (role, kind, text, at) => {
    const { text: t, truncated } = clip(text);
    const entry = { role: str(role) || 'unknown', kind: str(kind) || 'unknown', text: t };
    const iso = toIso(at);
    if (iso) entry.at = iso;
    if (truncated) entry.truncated = true;
    entries.push(entry);
  };

  const messages = r.transcript && Array.isArray(r.transcript.messages) ? r.transcript.messages : null;
  if (messages) {
    for (const m of messages) {
      const blocks = m && Array.isArray(m.blocks) ? m.blocks : [];
      for (const b of blocks) {
        if (b && typeof b === 'object') push(m.role, str(b.type) || 'unknown', blockText(b), m.timestamp);
      }
    }
  }
  const term = r.terminal && typeof r.terminal === 'object' ? r.terminal : null;
  const lines = term && Array.isArray(term.tail) ? term.tail : term && Array.isArray(term.lines) ? term.lines : null;
  if (lines) {
    for (const line of lines) push('terminal', 'line', typeof line === 'string' ? line : JSON.stringify(line));
  }
  return {
    outputSource: str(r.source) || (messages ? 'transcript' : lines ? 'terminal' : null),
    entries,
  };
}

module.exports = {
  MAX_ENTRY_TEXT,
  parseJsonField,
  toIso,
  parseDeps,
  laneOf,
  normalizeTask,
  normalizeMessage,
  normalizeWorkerOutput,
};
