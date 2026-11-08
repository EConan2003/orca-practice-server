# orca-practice-server

A small Node 22 Express API, built and released by an Orca orchestrator and two lane agents
(build, deploy). The interface between the lanes is [CONTRACT.md](CONTRACT.md). The orchestration
specs live in [.orca/](.orca/README.md).

## Quick start

```sh
nvm use            # Node 22, from .nvmrc
npm ci
npm run lint
npm test
npm start          # http://localhost:3000/health -> {"status":"ok"}
```

`PORT` overrides the port (default 3000).

## Container

```sh
docker pull ghcr.io/econan2003/orca-practice-server:<vX.Y.Z or sha-short>
docker run --rm -e PORT=3000 -p 3000:3000 ghcr.io/econan2003/orca-practice-server:<tag>
```

## Pipelines

- **CI** (`.github/workflows/ci.yml`): every PR and push to `main`. Lint, test, docker build, smoke test.
- **Release** (`.github/workflows/release.yml`): on a `v*.*.*` tag. Reuses CI, pushes the image to
  GHCR (`vX.Y.Z`, `sha-<short>`) and creates a GitHub Release.

## Lanes

| Lane | Owns |
|---|---|
| build | `src/`, `test/`, `package*.json`, `eslint.config.js`, `.env.example` |
| deploy | `.github/workflows/`, `Dockerfile`, `.dockerignore`, `deploy/` |
| orchestrator | everything else: contract, docs, repo config, `.orca/`, `.githooks/` |

A pre-commit lane guard (`.githooks/pre-commit`) blocks out-of-lane commits in lane worktrees.
