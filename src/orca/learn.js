'use strict';

// Static teaching content for the dashboard's Learn view (CONTRACT 4.2).
// Sources: `orca orchestration <cmd> --help`, `orca skills get orchestration` (and its
// references), and this repo's .orca/ conventions. Where something is a convention of this
// project rather than built into Orca, the text says so.
//
// `example` names which live data from the selected run the page shows under "In this run".

const LIFECYCLE = [
  {
    id: 'run',
    title: 'Create a Run',
    explain:
      'A Run is the container for one objective. The coordinator (the agent in charge) creates it, and every Task, Dispatch, message and gate after that belongs to it. Commands without --run use the coordinator\'s newest Run, so pass --run to address an older one.',
    commands: [
      'orca orchestration run-create --objective "<goal>"',
      'orca orchestration run-list',
      'orca orchestration run-show --id <run_id>',
      'orca orchestration run-use',
    ],
    relatedFeatureIds: ['runs'],
    example: 'run',
  },
  {
    id: 'task',
    title: 'Plan Tasks and their dependencies',
    explain:
      'Each Task is one piece of work with a self-contained spec: the target, the change, what the worker may edit and the evidence that proves it is done. A Task can list other Tasks in --deps; it only becomes ready once all of them are completed. Together the Tasks and their deps form a DAG, which task-list --ready walks.',
    commands: [
      'orca orchestration task-create --spec "<work>" --deps \'["<task_id>"]\'',
      'orca orchestration task-list --ready',
      'orca orchestration task-list --run <run_id> --full',
    ],
    relatedFeatureIds: ['tasks'],
    example: 'task-deps',
  },
  {
    id: 'dispatch',
    title: 'Start a worker (Dispatch)',
    explain:
      'worker-start hands one Task to one agent terminal. That assignment is a Dispatch, with its own ctx_ id. --worktree picks where the worker runs: the current workspace, a new child or top-level worktree, or an existing one by name such as name:deploy. --on runs it on a connected Orca server.',
    commands: [
      'orca orchestration worker-start --task <task_id> --worktree name:<lane> --agent claude',
      'orca orchestration worker-start --spec "<task>" --worktree current --agent codex',
      'orca orchestration dispatch --task <task_id> --to <terminal>',
    ],
    relatedFeatureIds: ['workers', 'worktree-placement'],
    example: 'dispatches',
  },
  {
    id: 'work',
    title: 'The worker does the work in its lane',
    explain:
      'The worker follows the spec in its own workspace. In this project each lane worktree owns a set of paths, and a pre-commit lane guard rejects commits outside them. The coordinator does not watch the terminal or poll; it can inspect a worker with worker-show and read its recent output with worker-read.',
    commands: [
      'orca orchestration worker-list --run <run_id>',
      'orca orchestration worker-show --dispatch <dispatch_id>',
      'orca orchestration worker-read --dispatch <dispatch_id> --limit 50',
    ],
    relatedFeatureIds: ['workers', 'lanes'],
    example: 'worker-output',
  },
  {
    id: 'messages',
    title: 'Ask, reply and send',
    explain:
      'A worker that needs a decision runs ask and ends its turn, and Orca wakes it with the answer. The coordinator answers with reply. Either side can send a typed message; a message to a busy worker arrives when its current turn ends. Nobody polls: Orca wakes the recipient.',
    commands: [
      'orca orchestration ask --question "<question>"',
      'orca orchestration reply --id <msg_id> --body "<answer>"',
      'orca orchestration send --to dispatch:<dispatch_id> --subject "<topic>" --body "<text>"',
      'orca orchestration check',
      'orca orchestration inbox --limit 50',
    ],
    relatedFeatureIds: ['messaging', 'issue-routing'],
    example: 'questions',
  },
  {
    id: 'report',
    title: 'worker_done or escalation',
    explain:
      'A worker finishes by sending exactly one worker_done with --outcome succeeded or failed; that settles its Task. A worker that is blocked sends an escalation. If a worker ends its turn without reporting, Orca raises an escalation itself ("Worker stopped without reporting").',
    commands: [
      'orca orchestration send --type worker_done --outcome succeeded --subject "<status>" --body "<summary>"',
      'orca orchestration send --type escalation --subject "Blocked: <reason>" --body "<details>"',
    ],
    relatedFeatureIds: ['messaging', 'recovery'],
    example: 'reports',
  },
  {
    id: 'gate',
    title: 'Decision gate',
    explain:
      'A decision gate blocks a Task until someone answers a question, usually the human. In this project the coordinator opens one before any tag, release, repo-settings change, new secret or contract change, and continues only after it is resolved.',
    commands: [
      'orca orchestration gate-create --task <task_id> --question "<question>" --options \'["yes","no"]\'',
      'orca orchestration gate-list --run <run_id>',
      'orca orchestration gate-resolve --id <gate_id> --resolution "<answer>"',
    ],
    relatedFeatureIds: ['gates', 'contract-changes'],
    example: 'gates',
  },
  {
    id: 'merge',
    title: 'Merge gate',
    explain:
      'This step is a convention of this project, not an Orca command. When a lane reports worker_done, the coordinator checks that every changed file matches that lane\'s allow-list and that the PR\'s CI is green. Only then does it squash-merge the PR; otherwise it sends the problems back to the lane.',
    commands: [
      'git diff --name-only origin/main...origin/<lane branch>',
      'gh pr checks <pr>',
      'gh pr merge --squash <pr>',
    ],
    relatedFeatureIds: ['merge-gate', 'lanes'],
    example: 'merges',
  },
  {
    id: 'main-updated',
    title: '"main updated"',
    explain:
      'After a merge, the coordinator tells the other lanes with a message whose subject is "main updated". Each lane then merges origin/main into its own branch, so lanes never drift far from main. This is also a project convention, built on send.',
    commands: [
      'orca orchestration send --to dispatch:<other lane> --subject "main updated" --body "<what merged, sha>"',
      'git merge origin/main',
    ],
    relatedFeatureIds: ['messaging', 'merge-gate'],
    example: 'main-updated',
  },
  {
    id: 'follow-up',
    title: 'Follow-up dispatch',
    explain:
      'Lanes are persistent. Sending to a worker that has already finished does not start over: Orca turns the message into a follow-up Task on the same agent, with its context, and the worker reports it with its own worker_done. Finished workers close on their own unless kept open, and worker-read still works after release.',
    commands: [
      'orca orchestration send --to dispatch:<dispatch_id> --subject "<new work>" --body "<spec>"',
      'orca orchestration worker-keep-open --dispatch <dispatch_id>',
      'orca orchestration worker-release --dispatch <dispatch_id>',
    ],
    relatedFeatureIds: ['workers', 'messaging'],
    example: 'follow-ups',
  },
];

const GLOSSARY = [
  { term: 'Run', meaning: 'The container for one objective. It owns its Tasks, Dispatches, messages and gates.', seeAlso: ['Task', 'Coordinator'] },
  { term: 'Task', meaning: 'One unit of work with a spec, a status and optional dependencies (deps). Its id starts with task_.', seeAlso: ['Spec', 'Dependency (deps)', 'Dispatch'] },
  { term: 'Spec', meaning: 'The self-contained instructions of a Task: the target, the change, constraints, what may be edited and the evidence that proves it is done.', seeAlso: ['Task'] },
  { term: 'Dependency (deps)', meaning: 'A list of Task ids that must be completed before a Task becomes ready. Deps make the Tasks of a Run a DAG.', seeAlso: ['Task', 'Run'] },
  { term: 'Dispatch', meaning: 'One assignment of a Task to one worker terminal, with an id that starts with ctx_. Retrying or following up a Task creates a new Dispatch.', seeAlso: ['Worker', 'Follow-up'] },
  { term: 'Worker', meaning: 'An agent (for example claude or codex) running a Dispatch in an Orca terminal and reporting back with worker_done.', seeAlso: ['Dispatch', 'worker_done'] },
  { term: 'Coordinator', meaning: 'The agent that owns the Run: it plans Tasks, starts workers, answers questions and merges results. Orca wakes it when mail arrives.', seeAlso: ['Run', 'question'] },
  { term: 'Terminal handle', meaning: 'An id for an Orca terminal, starting with term_. Messages are addressed from and to handles, or to run:<id> and dispatch:<id>.', seeAlso: ['Dispatch'] },
  { term: 'Worktree', meaning: 'A separate Git checkout of the same repository. Workers editing the same files at once need separate worktrees.', seeAlso: ['Lane', 'Worktree placement'] },
  { term: 'Worktree placement', meaning: 'Where worker-start runs a worker: --worktree current, new-child, new-top-level, an existing one such as name:<lane>, or on a connected server with --on.', seeAlso: ['Worktree'] },
  { term: 'Lane', meaning: 'In this project, a persistent worktree and branch (build, deploy, dashboard) that owns a fixed set of paths.', seeAlso: ['Lane guard', 'Worktree'] },
  { term: 'Lane guard', meaning: 'A pre-commit hook (.githooks/pre-commit) that rejects commits touching files outside the lane\'s .orca/lanes/<lane>.allow patterns.', seeAlso: ['Lane', 'Merge gate'] },
  { term: 'worker_done', meaning: 'The single message a worker sends to finish, with --outcome succeeded or failed. It settles the Task.', seeAlso: ['escalation', 'Worker'] },
  { term: 'escalation', meaning: 'A message saying a worker is blocked and the coordinator must act. Orca also sends one when a worker stops without worker_done.', seeAlso: ['worker_done', 'question'] },
  { term: 'question', meaning: 'A message sent with ask. The worker ends its turn and Orca wakes it when the coordinator replies.', seeAlso: ['reply', 'Coordinator'] },
  { term: 'reply', meaning: 'The answer to a question, sent with reply --id <msg_id>. It reaches the asking worker and wakes it.', seeAlso: ['question'] },
  { term: 'status', meaning: 'An informational message, such as an FYI between lanes, a reply, or "main updated". It needs no particular action beyond reading.', seeAlso: ['main updated'] },
  { term: 'Inbox', meaning: 'All messages Orca holds, across recipients. check takes your own new mail; inbox shows mail, including already handled mail.', seeAlso: ['question', 'worker_done'] },
  { term: 'Decision gate', meaning: 'A question that blocks a Task until it is resolved, usually by the human. Created with gate-create and answered with gate-resolve.', seeAlso: ['Contract'] },
  { term: 'Merge gate', meaning: 'This project\'s checks before merging a lane PR: changed files match the lane allow-list, CI is green, then squash-merge.', seeAlso: ['Lane guard', 'main updated'] },
  { term: 'main updated', meaning: 'This project\'s message to the other lanes after a merge, telling them to merge origin/main into their branch.', seeAlso: ['Merge gate', 'Follow-up'] },
  { term: 'Follow-up', meaning: 'New work sent to a Dispatch that already finished. Orca records it as a new Task for the same agent, which reports it with worker_done.', seeAlso: ['Dispatch', 'keep-open'] },
  { term: 'keep-open', meaning: 'Keeps a worker\'s terminal open after it finishes (worker-keep-open or --keep-open) instead of the automatic release about 2 minutes after worker_done.', seeAlso: ['released', 'Follow-up'] },
  { term: 'liveness', meaning: 'Whether Orca can currently prove the worker\'s agent process is running. unverifiable alone never proves the worker exited.', seeAlso: ['Terminal state'] },
  { term: 'Terminal state', meaning: 'Process accounting for the worker\'s terminal (active, reclaimable, retained, released...). It is separate from Task status: a completed Task can still own a live terminal.', seeAlso: ['liveness', 'retained', 'released'] },
  { term: 'retained', meaning: 'Terminal state: the terminal is kept and not scheduled for automatic release, for example after keep-open or for an adopted terminal.', seeAlso: ['released', 'keep-open'] },
  { term: 'released', meaning: 'Terminal state: Orca closed the worker\'s own terminal. Its output stays readable with worker-read.', seeAlso: ['retained'] },
  { term: 'Contract', meaning: 'In this project, CONTRACT.md: the interface between lanes (commands, env vars, endpoints). Only the orchestrator changes it, after a gate.', seeAlso: ['Decision gate', 'Issue routing'] },
  { term: 'Issue routing', meaning: 'In this project, sending a problem to the lane where the fix goes, not where the symptom appeared, using .orca/ROUTING.md.', seeAlso: ['Lane', 'Contract'] },
  { term: 'Recovery', meaning: 'Retrying a failed attempt with worker-start --retry-of, checking a mutation with request-show, or resetting state with reset. Act only on proof.', seeAlso: ['liveness'] },
];

// Plain-language meanings of every state value seen in Orca data. Values outside these
// lists are shown as reported, without an explanation.
const STATES = {
  taskStatus: {
    pending: 'Created, but not ready yet: it is waiting for its dependencies to complete.',
    ready: 'All dependencies are completed (or it has none), so a worker can be started for it.',
    dispatched: 'A worker has been given this Task and is working on it.',
    completed: 'Settled: a worker_done reported it finished (see the result for the outcome).',
    failed: 'Settled as failed: the worker reported failure, or its starts kept failing.',
    blocked: 'Cannot continue until something outside it is resolved, such as a decision gate.',
  },
  workerState: {
    ready: 'The agent started and accepted the Dispatch. Outcome in_progress means it has not reported yet.',
    running: 'The agent is working.',
    succeeded: 'The worker reported worker_done with outcome succeeded.',
    failed: 'The worker reported failure, or its start failed.',
    stopped: 'The worker was stopped with worker-stop.',
    abandoned: 'The Dispatch was fenced with worker-abandon; this does not prove the process exited.',
    outcome_unknown: 'Orca could not tell whether the start or stop took effect; inspect with worker-show.',
  },
  outcome: {
    in_progress: 'The worker has not reported yet.',
    succeeded: 'The worker reported success.',
    failed: 'The worker reported failure.',
  },
  liveness: {
    live: 'Orca can currently see the worker\'s agent running.',
    unverifiable: 'Orca cannot prove whether the agent is running right now, for example after a restart. This alone never proves it exited.',
  },
  terminalState: {
    active: 'The worker\'s terminal is in use by an unsettled Dispatch.',
    reclaimable: 'The worker settled and its terminal can be released; with autoReleaseAt it closes automatically unless reused or kept open.',
    retained: 'The terminal is kept and not scheduled for release (kept open, or not owned by Orca).',
    release_pending: 'A release was requested and is still in progress.',
    release_unknown: 'Orca could not confirm the release; follow the receipt\'s recovery action.',
    released: 'Orca closed the worker\'s own terminal. Its output is still readable with worker-read.',
  },
  messageType: {
    question: 'Sent with ask: the worker waits until the coordinator replies.',
    escalation: 'The sender is blocked and the coordinator must act (also sent by Orca when a worker stops without reporting).',
    worker_done: 'The worker\'s final report for its Dispatch, with an outcome.',
    status: 'Information only, such as an FYI, a reply or "main updated".',
    dispatch: 'Hands a Task to a terminal.',
    merge_ready: 'Says a change is ready to merge.',
    handoff: 'Hands work over to another agent.',
    decision_gate: 'Concerns a decision gate.',
    heartbeat: 'A periodic sign of life from a worker.',
  },
  gateStatus: {
    pending: 'Waiting for an answer; the Task it blocks cannot continue.',
    resolved: 'Answered with gate-resolve; the Task can continue.',
  },
  eventKind: {
    task_created: 'A Task was created in this Run.',
    task_completed: 'A Task was settled (completed or failed).',
    message: 'A message in this Run (see its type).',
  },
};

function learnContent() {
  // Fresh copies so callers cannot mutate the module's data.
  return JSON.parse(JSON.stringify({ lifecycle: LIFECYCLE, glossary: GLOSSARY, states: STATES }));
}

module.exports = { learnContent };
