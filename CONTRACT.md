# CONTRACT: orca-practice-server

This file is the interface between the **build** and **deploy** lanes. Only the orchestrator edits
it, and only after the human approves. Lanes implement exactly what it says; if it is wrong or
incomplete, lanes `ask` the orchestrator instead of working around it.

## 1. Runtime

| Item | Value |
|---|---|
| Runtime | Node.js **22** (pinned in `.nvmrc`; CI uses `node-version-file: .nvmrc`) |
| Framework | Express 4 |
| `package.json` `engines.node` | `">=22 <23"` |
| Container base image | `node:22-alpine` |

## 2. Commands

All run from the repo root. CI and the Dockerfile rely on exactly these.

| Command | Meaning | Must |
|---|---|---|
| `npm ci` | Install from `package-lock.json` | Succeed on a clean checkout; lockfile always in sync |
| `npm run lint` | ESLint (flat config, `eslint.config.js`) | Exit 0 with no errors |
| `npm test` | Tests with `node:test` + `supertest` | Exit 0; must not bind a fixed port |
| `npm start` | Start the server (production entry point) | Listen on `PORT`; work with dev deps omitted (`npm ci --omit=dev`) |

Test and lint tools (`eslint`, `supertest`, ...) are `devDependencies`. Runtime deps (`express`)
are `dependencies`.

## 3. Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | TCP port the HTTP server listens on (all interfaces) |
| `NODE_ENV` | unset | Standard Node meaning; the image sets `production` |
| `ORCA_DASHBOARD` | `off` | Initial state of the Orca dashboard feature flag: `on`/`true`/`1` enable it, anything else disables it (see 4.1) |
| `ORCA_CLI` | `orca` | Orca CLI executable the dashboard runs (read-only `orca orchestration ... --json` commands) |

No other env vars are read. No secrets are needed at runtime. `.env.example` (build lane) lists
these variables with their defaults.

## 4. HTTP API

All responses are JSON (`Content-Type: application/json`), except `GET /dashboard` (HTML, section 4.1).

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/health` | - | `200 {"status":"ok"}` |
| GET | `/api/items` | - | `200 [{"id": ..., "name": "..."}, ...]` (in-memory store) |
| POST | `/api/items` | `{"name": <non-empty string>}` | `201 {"id": ..., "name": "..."}` |
| POST | `/api/items` | invalid body (missing, empty or non-string `name`) | `400 {"error": "<message>"}` |

`/health` is the liveness endpoint used by the Docker `HEALTHCHECK`, `deploy/smoke.sh` and CI.

### 4.1 Feature flags and the Orca dashboard

The Orca dashboard is a feature of this server that shows every Orca orchestration feature
(runs, tasks and their DAG, workers/dispatches, messages, decision gates, lanes, merge gate,
issue routing) with live state read from the Orca CLI. It is behind the feature flag
`orcaDashboard`. Its initial state comes from `ORCA_DASHBOARD` (default off); it can be toggled
at runtime without a restart. Runtime state is in memory and resets on restart.

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/features` | - | `200 {"orcaDashboard": {"enabled": <bool>}}` (always available) |
| PUT | `/api/features/orca-dashboard` | `{"enabled": <bool>}` | `200 {"orcaDashboard": {"enabled": <bool>}}`; `400` if `enabled` is not a boolean; `403 {"error": ...}` unless the request comes from a loopback address |
| GET | `/dashboard` | - | `200` HTML page (the only non-JSON response); `404 {"error":"orca dashboard is disabled"}` when off |
| GET | `/api/orca/features` | - | `200 [{"id", "name", "category", "description", "commands": [...]}...]` static catalog of Orca orchestration features |
| GET | `/api/orca/runs` | - | `200 {"source": "live", "runs": [...]}` or `200 {"source": "unavailable", "error": "...", "runs": []}` |
| GET | `/api/orca/runs/:id` | - | `200 {"source", "run", "tasks", "workers", "gates"}`; `404` for an unknown run |
| GET | `/api/orca/inbox` | `?limit=<1-100>` (default 50) | `200 {"source", "messages": [...]}` |
| GET | `/api/orca/learn` | - | `200 {"lifecycle": [...], "glossary": [...], "states": {...}}` static teaching content (see 4.2) |
| GET | `/api/orca/runs/:id/timeline` | - | `200 {"source", "events": [{"at", "kind", "title", "taskId"?, "messageId"?, "lane"?, ...}]}` oldest first; `404` for an unknown run |
| GET | `/api/orca/runs/:id/tasks/:taskId` | - | `200 {"source", "task": {"id", "title", "status", "deps", "parentId", "spec", "result", "createdAt", "completedAt"}}`; `404` if the task is not in the run; loopback only (`403` otherwise) |
| GET | `/api/orca/messages/:id` | - | `200 {"source", "message": {"id", "runId", "type", "from", "to", "subject", "priority", "body", "payload", "createdAt", "deliveredAt"}}`; `404` if unknown; loopback only |
| GET | `/api/orca/workers/:dispatchId/output` | `?limit=<1-200>` (default 50) | `200 {"source", "dispatchId", "outputSource", "entries": [...]}` recent worker output; loopback only |

Every `/dashboard` and `/api/orca/*` route returns `404 {"error":"orca dashboard is disabled"}`
while the flag is off. The dashboard is read-only: it never runs a mutating Orca command. When
the Orca CLI is missing or fails (as in the container), `/api/orca/*` still return 200 with
`"source": "unavailable"` and the error, and the page shows that state; `/health` is unaffected.

Path ids are validated before use: run `^run_[A-Za-z0-9_]+$`, task `^task_[A-Za-z0-9]+$`, message
`^msg_[A-Za-z0-9_]+$`, dispatch `^ctx_[A-Za-z0-9]+$`; anything else gives `400`. "Loopback only"
uses the socket address, as for `PUT /api/features/orca-dashboard`, because full task specs,
message bodies and worker transcripts can contain commands and paths.

### 4.2 Dashboard views

`/dashboard` has three views: **Live** (run state, as before), **History** (the run timeline from
`/api/orca/runs/:id/timeline`, filterable by event kind and lane) and **Learn** (the Orca
lifecycle, glossary and state meanings from `/api/orca/learn`, each linked to real examples from
the selected run). Tasks, workers and messages in every view open a read-only detail panel.

## 5. Container image and release

| Item | Value |
|---|---|
| Registry / image | `ghcr.io/econan2003/orca-practice-server` (owner lowercased, as GHCR requires) |
| Release trigger | push of a git tag matching `v*.*.*` runs `.github/workflows/release.yml` |
| Image tags | `vX.Y.Z` (from the git tag) and `sha-<short>` (7-char commit sha) |
| Exposed port | `3000` (`EXPOSE 3000`); override with `-e PORT=<p> -p <p>:<p>` |
| Process user | non-root |
| Healthcheck | `GET http://localhost:$PORT/health` must return 200 |
| Smoke test | `deploy/smoke.sh` polls `/health` for up to 30 s and requires 200 |
| GitHub Release | created by the release workflow with generated notes |
| Auth | `GITHUB_TOKEN` only, with the smallest `permissions:` block that works. No extra secrets. |

Tags and releases are created only by the orchestrator, after the human approves a gate.

## 6. CI

`.github/workflows/ci.yml` runs on `pull_request`, on `push` to `main`, and via `workflow_call`
(reused by `release.yml`). Jobs:

- `test`: checkout, setup-node from `.nvmrc` with npm cache, `npm ci`, `npm run lint`, `npm test`.
- `image` (needs `test`): docker build, run the container with `PORT` set, `deploy/smoke.sh`, stop.

No `continue-on-error`, and no skipped steps to hide failures.

## 7. Lanes and file ownership

Each lane is an Orca worktree. Only that lane's agent edits its paths. The pre-commit lane guard
(`.githooks/pre-commit`) enforces this with `.orca/lanes/<lane>.allow`; the orchestrator's merge
gate checks it again on every PR.

| Lane | Worktree | Branch | Owns |
|---|---|---|---|
| build | `build` | build lane branch | `src/**`, `test/**`, `package.json`, `package-lock.json`, `eslint.config.js`, `.env.example` |
| deploy | `deploy` | deploy lane branch | `.github/workflows/**`, `Dockerfile`, `.dockerignore`, `deploy/**` |
| orchestrator | main checkout | `main` | `CONTRACT.md`, `README.md`, `.gitignore`, `.gitattributes`, `.nvmrc`, `orca.yaml`, `.githooks/**`, `.orca/**` |

Lanes push only their lane branch and open PRs to `main`. Only the orchestrator merges
(`gh pr merge --squash`), pushes `main`, tags and releases.

## 8. Issue routing

Route by WHERE THE FIX GOES, not where the symptom appeared.

| Symptom | Owner |
|---|---|
| Unit test or lint fails (in CI or locally) | build |
| npm ci fails: lockfile out of sync or bad dependency | build |
| npm ci fails: setup-node, cache or Node version step | deploy |
| docker build fails (COPY, stage, base image) | deploy |
| Container up but /health fails: app ignores PORT | build |
| Container up but /health fails: EXPOSE, port, run args | deploy |
| GHCR push denied: workflow permissions | deploy |
| GHCR push denied: repo or package settings | human, via orchestrator |
| Any change to ports, commands, env vars, endpoints, Node version, image name | orchestrator (contract) + human |
| Unclear after one triage attempt | orchestrator |

Reports to the orchestrator include: the file, the symptom, the evidence (command and output, or
run URL and log excerpt) and a suggested fix in prose.

## 9. Changing this contract

1. A lane `ask`s the orchestrator, or the human requests a change.
2. The orchestrator opens a gate and the human approves.
3. The orchestrator commits the change to `main` and sends each affected lane a task that cites
   the new contract commit sha.
