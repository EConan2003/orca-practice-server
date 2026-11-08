'use strict';

// Static catalog of Orca orchestration features shown on the dashboard.
// `live` names the dashboard data that gives the feature a live count, if any.
const FEATURES = [
  {
    id: 'runs',
    name: 'Runs',
    category: 'Coordination',
    description:
      'A Run groups one objective with its tasks, dispatches, messages and gates. The coordinator creates or resumes one and binds to it.',
    commands: [
      'orca orchestration run-create',
      'orca orchestration run-use',
      'orca orchestration run-current',
      'orca orchestration run-list',
      'orca orchestration run-show --id <run>',
    ],
    live: 'runs',
  },
  {
    id: 'tasks',
    name: 'Tasks and dependency DAG',
    category: 'Planning',
    description:
      'Tasks carry a title, status and optional dependencies. A task becomes ready when every task in its --deps list is completed, which forms a DAG.',
    commands: [
      'orca orchestration task-create --deps <json_array>',
      'orca orchestration task-list --run <run>',
      'orca orchestration task-update --status <status>',
    ],
    live: 'tasks',
  },
  {
    id: 'workers',
    name: 'Workers and dispatches',
    category: 'Execution',
    description:
      'A dispatch hands one task to one supervised agent terminal. Workers can be inspected, read, stopped, abandoned, released or kept open after they finish.',
    commands: [
      'orca orchestration worker-start',
      'orca orchestration worker-show',
      'orca orchestration worker-read',
      'orca orchestration worker-stop',
      'orca orchestration worker-abandon',
      'orca orchestration worker-release',
      'orca orchestration worker-keep-open',
      'orca orchestration worker-list --run <run>',
      'orca orchestration dispatch',
      'orca orchestration dispatch-show',
    ],
    live: 'workers',
  },
  {
    id: 'messaging',
    name: 'Messaging',
    category: 'Communication',
    description:
      'Agents exchange typed messages (question, escalation, worker_done, status). Workers ask and are woken with the answer; they finish with exactly one worker_done.',
    commands: [
      'orca orchestration send --type <type>',
      'orca orchestration check',
      'orca orchestration reply',
      'orca orchestration inbox --limit <n>',
      'orca orchestration ask --question <text>',
      'orca orchestration send --type worker_done',
      'orca orchestration send --type escalation',
    ],
    live: 'messages',
  },
  {
    id: 'gates',
    name: 'Decision gates',
    category: 'Control',
    description:
      'A gate blocks a task until a human or the coordinator resolves a question, for example approving a contract change or a release.',
    commands: [
      'orca orchestration gate-create --task <task> --question <text>',
      'orca orchestration gate-resolve',
      'orca orchestration gate-list --run <run>',
    ],
    live: 'gates',
  },
  {
    id: 'worktree-placement',
    name: 'Worktree placement',
    category: 'Execution',
    description:
      'A worker runs in the current checkout, a new top-level or child worktree, an existing lane worktree (name:<lane>), or on a connected remote Orca server.',
    commands: [
      'orca orchestration worker-start --worktree current',
      'orca orchestration worker-start --worktree new-top-level',
      'orca orchestration worker-start --worktree new-child',
      'orca orchestration worker-start --worktree name:<lane>',
      'orca orchestration worker-start --on <saved-environment>',
      'orca orchestration worker-start --environment <selector>',
    ],
  },
  {
    id: 'lanes',
    name: 'Lanes and lane guard',
    category: 'Ownership',
    description:
      'Each lane is a worktree that owns a set of paths. A pre-commit hook rejects commits touching files outside the lane allow-list.',
    commands: [
      '.orca/lanes/<lane>.allow',
      "git config --worktree --add lane.allow '<regex>'",
      '.githooks/pre-commit',
    ],
    live: 'lanes',
  },
  {
    id: 'merge-gate',
    name: 'Merge gate',
    category: 'Control',
    description:
      'Before merging a lane PR the orchestrator checks changed files against the lane allow-list, requires green CI, squash-merges and tells the other lanes "main updated".',
    commands: [
      'git diff --name-only origin/main...HEAD',
      'gh pr checks <pr>',
      'gh pr merge --squash',
      'orca orchestration send --subject "main updated"',
    ],
  },
  {
    id: 'issue-routing',
    name: 'Issue routing',
    category: 'Communication',
    description:
      'Issues are routed by where the fix goes, not where the symptom appeared, using the ROUTING table. Reports carry file, symptom, evidence and a suggested fix.',
    commands: ['.orca/ROUTING.md', 'CONTRACT.md section 8'],
  },
  {
    id: 'contract-changes',
    name: 'Contract changes',
    category: 'Ownership',
    description:
      'CONTRACT.md is the interface between lanes. A change goes through a decision gate, the human approves, and affected lanes get a task citing the new contract sha.',
    commands: [
      'orca orchestration ask',
      'orca orchestration gate-create',
      'git log -1 -- CONTRACT.md',
    ],
  },
  {
    id: 'recovery',
    name: 'Recovery',
    category: 'Control',
    description:
      'Reset one explicit orchestration state scope, or ask whether a mutation request already took effect before retrying it.',
    commands: [
      'orca orchestration reset --tasks | --messages | --all',
      'orca orchestration request-show',
      'orca orchestration worker-start --retry-of <dispatch>',
    ],
  },
];

function featureCatalog() {
  return FEATURES.map((f) => ({ ...f, commands: [...f.commands] }));
}

module.exports = { featureCatalog };
