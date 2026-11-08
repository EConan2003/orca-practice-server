FEATURE F1: Expose the running version. (The human sends this to the orchestrator after v0.1.0 ships.)

Contract change, which needs the human's approval: GET /version returns
{"version": APP_VERSION or "dev", "commit": GIT_SHA or "unknown"}. The image must set
APP_VERSION and GIT_SHA at build time.

ORCHESTRATOR STEPS
1. Open a gate for the contract change and wait for approval.
2. Commit the change to CONTRACT.md on main and push. Record the sha.
3. Create the two lane tasks:
   cat .orca/lanes/build.md  .orca/specs/BF1.md | orca orchestration task-create --spec-file - --task-title "BF1 /version endpoint"
   cat .orca/lanes/deploy.md .orca/specs/DF1.md | orca orchestration task-create --spec-file - --task-title "DF1 version build args"
   Send each to its lane's existing dispatch (or worker-start --worktree name:<lane>), including
   the contract sha.
4. DF1's smoke check can't pass until BF1 is merged. Merge BF1 first, send deploy the
   "main updated" notice, then merge DF1 once its CI is green.
5. Open a gate for tag v0.2.0. After approval, push the tag and confirm the release run, the
   image and the release, then report.
