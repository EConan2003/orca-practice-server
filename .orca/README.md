# Orca orchestration practice: build + deploy lanes

Specs for practicing feature orchestration: one orchestrator and two lane agents (build, deploy)
in separate Orca worktrees, building a Node 22 API and releasing it through GitHub Actions to GHCR.

## Files

| File | What it is | Used by |
|---|---|---|
| orchestrator.md | Kickoff prompt for the orchestrator | Paste into the agent in the main checkout |
| lanes/build.md, lanes/deploy.md | Lane briefs: ownership and rules | Prepended to every task spec for that lane |
| lanes/build.allow, lanes/deploy.allow | Path regexes per lane | Lane guard config and merge-gate check |
| specs/B1.md | Server v1 | build |
| specs/D1.md | CI pipeline | deploy |
| specs/D2.md | Release pipeline (depends on D1) | deploy |
| specs/F1-feature.md | Cross-lane /version feature, orchestrator steps | orchestrator |
| specs/BF1.md, specs/DF1.md | F1 lane tasks | build, deploy |
| specs/F2-dashboard.md | Orca dashboard behind a feature flag | dashboard worktree (build paths) |
| specs/F3-dashboard-learn.md | Dashboard v2: learn mode, details, history | dashboard worktree (build paths) |
| ROUTING.md | Which lane owns which failure | Copied into CONTRACT.md |
| lane-guard.sh | Pre-commit hook blocking out-of-lane commits | Installed as .githooks/pre-commit |
| drills.md | Scenarios that test the rules | You, after v0.1.0 |

A task spec sent to a worker is always the lane brief plus the task file:

    cat .orca/lanes/build.md .orca/specs/B1.md | orca orchestration task-create --spec-file - --task-title "B1 server v1"

## Steps

1. Prerequisites: Node 22, git, `gh auth status` OK, Orca running. Docker locally is optional.
2. In this folder: `git init -b main`, commit .orca/, then `orca repo add --path .`
3. Open the repo in Orca, start an agent (Claude) in the main checkout, and paste orchestrator.md.
4. Approve the gates when the orchestrator asks: GitHub repo creation, first push, branch protection, tags.
5. After v0.1.0 ships, send specs/F1-feature.md to the orchestrator, then run the drills.
