Route by WHERE THE FIX GOES, not where the symptom appeared.

| Symptom                                                         | Owner                   |
|-----------------------------------------------------------------|-------------------------|
| Unit test or lint fails (in CI or locally)                      | build                   |
| npm ci fails: lockfile out of sync or bad dependency            | build                   |
| npm ci fails: setup-node, cache or Node version step            | deploy                  |
| docker build fails (COPY, stage, base image)                    | deploy                  |
| Container up but /health fails: app ignores PORT                | build                   |
| Container up but /health fails: EXPOSE, port, run args          | deploy                  |
| GHCR push denied: workflow permissions                          | deploy                  |
| GHCR push denied: repo or package settings                      | human, via orchestrator |
| Any change to ports, commands, env vars, endpoints, Node version, image name | orchestrator (contract) + human |
| Unclear after one triage attempt                                | orchestrator            |
