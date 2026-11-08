TASK F2: Orca dashboard, a toggleable feature of orca-practice-server.

You work in the dedicated worktree "dashboard" (its own lane branch), created for this feature.
You own the same paths as the build lane: src/**, test/**, package.json, package-lock.json,
eslint.config.js, .env.example. The lane guard enforces this. CONTRACT.md section 3 and 4.1 are the
source of truth; read them first (git log -1 -- CONTRACT.md gives the contract sha).

GOAL
A dashboard page at GET /dashboard that shows EVERY Orca orchestration feature, with live state
for the ones that have state, behind the feature flag `orcaDashboard` that can be toggled on/off.

1. Feature flag (src/features.js)
   - Initial state from ORCA_DASHBOARD: "on", "true", "1" (case-insensitive) enable; anything else
     or unset disables. createApp(options) accepts overrides so tests don't touch process.env:
     createApp({ orcaDashboard: true|false, orcaRunner }) (both optional).
   - GET /api/features and PUT /api/features/orca-dashboard exactly as in CONTRACT 4.1.
     PUT is allowed only from loopback (127.0.0.1, ::1, ::ffff:127.0.0.1); otherwise 403.
     Non-boolean `enabled` gives 400.
   - While off, /dashboard and every /api/orca/* route return 404 {"error":"orca dashboard is disabled"}.
     Check the flag per request (runtime toggle must take effect immediately).

2. Orca data layer (src/orca/)
   - A runner that calls child_process.execFile(ORCA_CLI || "orca", ["orchestration", <cmd>, ...args, "--json"])
     with a 10 s timeout and windowsHide, parses stdout JSON, and returns result on ok:true,
     throws on ok:false / non-JSON / spawn error (ENOENT). Inject it (createApp option) so tests
     use a fake runner and never require Orca.
   - ONLY these read-only commands may be run: run-list, run-show --id, task-list --run,
     worker-list --run, gate-list --run, inbox --limit. Never run a mutating command. Validate
     run ids against /^run_[A-Za-z0-9_]+$/ before passing them (400 otherwise).
   - Output shapes (real samples from this machine):
     run-list    -> {"runs":[{"id":"run_7f5cb91f8e76","objective":"..."},{"id":"run_legacy_local","objective":"...","legacy":true}]}
     run-show    -> {"runId":"...","objective":"...","removedWork":{...}}
     task-list   -> {"tasks":[{"id":"task_...","status":"completed|dispatched|pending|...","title":"...","dispatchId?":"ctx_...","assignee?":"term_...","deps?":"[\"task_...\"]"}],"runId":"..."}
                    NOTE: deps is a JSON-encoded string; parse it into an array.
     worker-list -> {"workers":[{"dispatchId","taskId","state","outcome?","liveness","agent?","terminal?","terminalState","workspace":"<repoId>::<path>","host","attention?":[...]}],"scope":{...}}
     gate-list   -> {"gates":[...],"runId":"..."}
     inbox       -> {"messages":[{"id","type":"question|escalation|worker_done|status|...","from","to","subject","priority?","handled","body","payload?"}]}
   - Run `orca orchestration <cmd> --help` / `--json` yourself to confirm shapes (read-only commands only).
   - Cache results for 3 s to avoid hammering the CLI when the page auto-refreshes.
   - Unavailable CLI => 200 with "source":"unavailable" and "error" (see CONTRACT 4.1).

3. Feature catalog: GET /api/orca/features returns a static list covering at least:
   runs (run-create/use/list/show), tasks + dependency DAG (task-create/list/update, --deps),
   workers & dispatches (worker-start/show/read/stop/abandon/release/keep-open/list, dispatch),
   messaging (send/check/reply/inbox, ask, worker_done, escalation), decision gates
   (gate-create/resolve/list), worktree placement (current, new-top-level, name:<lane>, remote
   --on/--environment), lanes + lane guard (.orca/lanes/*.allow, pre-commit hook), merge gate
   (allow-list check, CI green, squash merge, "main updated"), issue routing (ROUTING table),
   contract changes (gate + CONTRACT.md), recovery (reset, request-show). Each item:
   {id, name, category, description, commands}.

4. Page (src/dashboard/index.html, served by GET /dashboard)
   - Self-contained: inline CSS and JS, no CDN, no build step. Fetches the JSON endpoints.
   - Sections: header with run picker + flag status + "source" indicator (live / unavailable);
     summary tiles (tasks by status, workers by state, open gates, unhandled messages);
     task DAG (tasks as nodes grouped by dependency depth, deps drawn as arrows or listed);
     workers/dispatches table (dispatch, task, agent, state, liveness, terminal state, lane =
     last path segment of workspace); messages timeline (type badge, from -> to, subject,
     handled); gates list; lanes panel; feature catalog grid showing every feature from
     /api/orca/features, each marked with live counts where the data exists.
   - Auto-refresh every 5 s (pausable). Works in light and dark (prefers-color-scheme), readable
     at phone width. Escape all Orca-provided strings (no innerHTML with raw data).
   - A visible on/off toggle that calls PUT /api/features/orca-dashboard is NOT needed on the
     page (turning it off would hide the page); instead show the current flag state and the
     command to toggle it (curl -X PUT ... and ORCA_DASHBOARD=on).

5. Tests (node:test + supertest, fake runner; no real Orca, no fixed port), at least:
   flag default off -> 404 on /dashboard and /api/orca/*; ORCA_DASHBOARD parsing;
   GET/PUT /api/features incl. 400 and 403 (non-loopback: fake req via X-Forwarded-For is NOT
   enough; set trust proxy off and test the helper directly or via a supertest agent bound to a
   non-loopback address if feasible, otherwise unit-test the loopback check function);
   toggle on -> /dashboard 200 text/html; runs/run detail/inbox happy paths with the fake runner;
   deps string parsed to array; invalid run id 400; unknown run 404; runner failure ->
   source "unavailable"; existing /health and /api/items tests still pass.
   Also add ORCA_DASHBOARD and ORCA_CLI to .env.example.

6. Verify: npm ci, npm run lint, npm test all exit 0. Then start the server locally with
   ORCA_DASHBOARD=on PORT=<free port> and confirm with curl that /dashboard is 200 HTML and
   /api/orca/runs returns "source":"live" with run run_7f5cb91f8e76 listed. Toggle it off with
   curl -X PUT and confirm /dashboard is 404. Stop the server.

7. Commit, push your branch, open a PR to main titled "F2: Orca dashboard (feature flag)".
   Finish with worker_done per the lane brief (summary, changed files, command results, PR URL,
   the curl evidence from step 6, open questions). A non-zero exit from lint/test means the task
   is not done: fix it within your paths.
