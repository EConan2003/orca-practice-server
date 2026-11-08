TASK DF1: Version build args (feature F1, deploy side), as defined in CONTRACT.md at the sha
the orchestrator gave you.
- Dockerfile: ARG APP_VERSION and ARG GIT_SHA, passed through as ENV in the final stage.
- ci.yml and release.yml pass both as build args. In releases, APP_VERSION is the tag
  (from docker/metadata-action); GIT_SHA is the commit sha in both workflows.
- deploy/smoke.sh also calls GET /version. In release runs it must return the tag being
  released; in CI runs it must return 200 with a non-empty commit.
- The /version endpoint comes from the build lane (BF1). Until BF1 is merged, expect the
  /version check to fail. When the orchestrator sends "main updated", merge origin/main and
  get CI green.
DONE WHEN: your PR is green; you report the run URL, job results and diff file list.
