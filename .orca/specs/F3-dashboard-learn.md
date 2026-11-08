TASK F3: Orca dashboard v2: Learn mode, click-through details, run history timeline.

Same worktree "dashboard", same branch, same paths and rules as F2 (build-lane paths only:
src/**, test/**, package.json, package-lock.json, eslint.config.js, .env.example). First merge
origin/main into your branch (it has D1 CI, D2 release and this contract change).
CONTRACT.md sections 4.1 (new rows + id validation + loopback rule) and 4.2 are the source of
truth. Branch protection now requires CI checks `test` and `image` to pass on your PR.

All new endpoints sit behind the same orcaDashboard flag gate (404 while off) and stay read-only.

1. Runner allow-list (src/orca/runner.js): extend, still refusing everything else.
   - task-list: --run <RUN_ID>, optional boolean --full
   - inbox: --limit <1-100>, optional boolean --full
   - worker-read: --dispatch <ctx id>, --limit <1-200>
   Boolean flags have no value: adapt validate() so it accepts exactly the listed boolean flags
   and still rejects unknown flags/values. Keep the 3 s cache (cache key includes all args).

2. Real --json --full shapes on this machine (confirm yourself with read-only commands):
   task-list --full -> tasks[]: {id, run_id, parent_id, task_title, display_name, spec, status,
     deps: "<JSON string array>", result: "<JSON string or null>", created_at: "2026-11-08 08:36:32"
     (UTC, space-separated, no Z), completed_at: "2026-11-08T08:40:25.801Z" or null, plus
     created_by_* fields you must NOT expose}
   inbox --full -> messages[]: {id, run_id, from_handle, to_handle, subject, body, type, priority,
     thread_id, payload: "<JSON string or null>", read, sequence, created_at, delivered_at,
     plus sender_pane_key / pointer_* fields you must NOT expose}. Filter by run_id for a run.
   worker-read --dispatch <id> --limit n -> {dispatchId, source: "transcript"|"terminal", provider,
     transcript: {messages: [{id, role, blocks: [{type: "text"|"tool-call"|"tool-result"|..., ...}]}]}
     or terminal lines}. Normalize to entries: [{role, kind, text}] with text truncated to 4000
     chars per entry; tolerate unknown block types (render their type name).
   Parse every JSON-string field defensively (bad JSON -> keep the raw string).
   Normalize timestamps to ISO 8601 UTC with Z.

3. Endpoints (CONTRACT 4.1 table): /api/orca/learn, /api/orca/runs/:id/timeline,
   /api/orca/runs/:id/tasks/:taskId (loopback only), /api/orca/messages/:id (loopback only; look it
   up in inbox --full --limit 100), /api/orca/workers/:dispatchId/output (loopback only).
   Validate ids with the CONTRACT 4.1 regexes (400). Reuse the existing isLoopback(socket address)
   helper; never trust X-Forwarded-For. Unavailable CLI -> 200 "source":"unavailable" as before.
   Timeline events, oldest first: task_created (created_at), task_completed (completed_at, with
   outcome from result), and one per run message (question, escalation, worker_done, status,
   reply...) with type, from/to, subject, taskId/dispatchId from payload. Attach lane (last path
   segment of the dispatch's workspace from worker-list) where a dispatch is known.

4. Learn content (src/orca/learn.js, static): 
   - lifecycle: ordered steps Run -> Task (+deps) -> worker-start/Dispatch -> Worker works ->
     ask/reply and send (messages) -> worker_done / escalation -> decision gate -> merge gate ->
     "main updated" -> follow-up dispatch. Each step: {id, title, explain (2-4 plain sentences for
     a newcomer), commands: [...], relatedFeatureIds: [...catalog ids]}.
   - glossary: >= 20 terms (Run, Task, Dispatch, Worker, Coordinator, Lane, Worktree, Spec,
     worker_done, escalation, question, reply, Gate, Merge gate, Follow-up, keep-open, liveness,
     terminal state, retained/released, Contract, lane guard, issue routing...). {term, meaning, seeAlso}.
   - states: plain-language meaning of every value seen in the data: task status (pending, ready,
     dispatched, completed, failed, blocked...), worker state (ready, running, succeeded, failed...),
     liveness (live, unverifiable, ...), terminalState (active, reclaimable, retained,
     release_pending, release_unknown, released), message type.
   Wording must be accurate for Orca as observed; when unsure, check `orca orchestration --help`
   and `orca skills get orchestration` rather than inventing behavior.

5. Page (src/dashboard/index.html, still self-contained, no CDN, safe DOM building only):
   - View switcher: Live | History | Learn (keep the current Live content). Remember the view in
     the URL hash (#live/#history/#learn) so it survives refresh.
   - Detail panel (side drawer, full-screen on phones, Esc/close button, focus moved in and
     restored): clicking a task (DAG node, timeline event), a worker row, or a message opens it.
     Task: title, status with its explanation, deps (clickable), full spec (preformatted,
     scrollable), parsed result (outcome, summary, files). Worker: dispatch, task, lane, state +
     liveness + terminal state with explanations, recent output entries. Message: full body,
     parsed payload, links to its task/dispatch. If the endpoint returns 403 show "details are
     only available from this machine (loopback)".
   - History: vertical timeline grouped by day, icon/badge per kind, filters (kind checkboxes,
     lane select), counts, relative and absolute time; each event clickable.
   - Learn: lifecycle diagram (inline SVG or CSS flow, numbered steps, readable in both themes
     and at phone width); click a step to see its explanation, commands, and "In this run" examples
     drawn live from the selected run (e.g. the actual worker_done messages, the actual task with
     deps); searchable glossary; state reference tables.
   - Everywhere a status/state/type badge appears, add a hover/focus tooltip with the meaning
     from /api/orca/learn (title attribute is fine plus an accessible label).
   - Auto-refresh must not close an open detail panel or reset filters/scroll.

6. Tests (fake runner, no real Orca, no fixed port): runner allow-list incl. boolean flags and
   rejection of unknown ones; each new endpoint happy path; 400 bad ids; 403 non-loopback for the
   three detail endpoints (real non-loopback test like F2 if possible); 404 unknown task/message
   and unknown run; flag off -> 404 on all new routes; timeline ordering + timestamp normalization;
   created_by_*/pointer_* fields not exposed; learn content shape (>= 20 glossary terms, every
   catalog id referenced by lifecycle exists). Existing tests still pass.

7. Verify: npm ci, npm run lint, npm test exit 0. Start the server with ORCA_DASHBOARD=on on a free
   port and curl: /api/orca/learn, /api/orca/runs/run_7f5cb91f8e76/timeline (source live, events
   include the B1/D1/D2/F2 worker_done messages), a task detail for task_7e9d7fa904ca, a message
   detail for msg_a6fec79167ac, worker output for ctx_95a520c3be59. Stop the server.

8. Commit, push, open a PR to main titled "F3: Orca dashboard v2 (learn, details, history)", wait
   for CI `test` + `image` to be green, then worker_done per the lane brief (summary, changed
   files, command results, PR URL, CI run URL, curl evidence, open questions).
