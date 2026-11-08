TASK BF1: /version endpoint (feature F1, build side), as defined in CONTRACT.md at the sha the
orchestrator gave you.
- GET /version returns 200 {"version": APP_VERSION or "dev", "commit": GIT_SHA or "unknown"}.
- Read the env vars per request, not at startup, so tests can set them.
- Tests cover both the defaults and values set through the environment.
DONE WHEN: npm run lint and npm test pass; your PR is green; you report the PR URL and diff file list.
