# Phase 5 Plan: Office Kanban Task Mutation Actions (TDD)

Date: 2026-06-09  
Worktree: `/srv/orion/worktrees/office-task-actions`  
Branch: `orion/office-task-actions`

## Goal

Make Office actually run Kanban from the operator UI: create tasks, move task columns, assign a task to an agent/profile, block/unblock, complete, and protect destructive actions with explicit confirmation.

This phase is planning-only. Implementation must be strict TDD: write focused failing tests first, verify RED, implement the smallest production change, verify GREEN, then refactor.

## Current code observed

- Backend wrapper: `src/main/kanban.ts`
  - Existing CLI-backed functions: `createTask`, `assignTask`, `completeTask`, `blockTask`, `unblockTask`, `archiveTask`, `specifyTask`, `reclaimTask`, `commentTask`, `dispatchOnce`.
  - Existing safety gap: mutation helpers validate remote-only mode but most do not validate missing `taskId`/`assignee` inputs.
  - Existing move semantics are command-specific; there is no generic move-to-status helper.
- IPC: `src/main/index.ts`
  - Existing handlers already expose `kanban-create-task`, `kanban-assign-task`, `kanban-complete-task`, `kanban-block-task`, `kanban-unblock-task`, `kanban-archive-task`, `kanban-specify-task`, `kanban-reclaim-task`, `kanban-comment-task`, and `kanban-dispatch-once`.
  - No explicit IPC wrapper exists for a single validated task mutation action contract.
- Preload: `src/preload/index.ts` and `src/preload/index.d.ts`
  - Kanban methods are exposed to the renderer and type-declared.
  - Existing API-surface test (`tests/preload-api-surface.test.ts`) checks preload/type parity.
- Renderer Kanban board: `src/renderer/src/screens/Kanban/Kanban.tsx`
  - Already has drag/drop and card buttons for complete, block, unblock, archive, specify, reclaim, dispatch, and create task.
  - Drag/drop permits only: any -> done, todo/ready/running -> blocked, blocked -> ready.
  - Done/archive use `window.confirm`; block uses `window.prompt`.
  - HQ virtual board is read-only.
- Office actions: `src/renderer/src/screens/Office/officeActions.ts` and `src/renderer/src/screens/Office/Office.tsx`
  - Current side panel only navigates/open chats/restarts gateway. It does not surface task mutation actions.
  - Existing tests: `tests/office-actions.test.ts`, `tests/office-renderer.test.ts`, `tests/office-status.test.ts`.

## Desired user workflows

1. **Move task columns**
   - Operator can move valid transitions from task panel and board controls.
   - Allowed transitions remain explicit and safe:
     - `todo|ready|running -> blocked` via `blockTask(reason?)`.
     - `blocked -> ready` via `unblockTask`.
     - `todo|ready|running|blocked -> done` via `completeTask(result?)`, confirmation required.
   - Unsupported transitions return a visible error and do not call IPC.

2. **Assign to agent/profile**
   - Operator can assign/unassign a selected Kanban task to an Office profile/agent.
   - `assignee === null` maps to CLI `none`.
   - Assignment should refresh the board/task detail after success.

3. **Block/unblock**
   - Block prompts for optional reason.
   - Unblock requires no prompt.
   - Both should be disabled on the HQ virtual board.

4. **Complete**
   - Completion is destructive-enough to require confirmation.
   - Optional result prompt can be added, but completion must still work without a result.
   - On success, refresh counts and close/update detail if needed.

5. **Create task**
   - Existing Kanban create modal stays as the canonical create flow.
   - Office may provide a shortcut that opens/navigates to Kanban with create modal if routing state support is added; otherwise keep Open Kanban and avoid duplicating a full create form in Office.

6. **Safe confirmation for destructive actions**
   - Required: complete and archive.
   - Recommended: board remove/hard delete if surfaced later.
   - Not required: assign, block, unblock, specify, reclaim, create.

## Architecture plan

### 1. Add a small shared action model for task mutations

Create a pure renderer/shared helper module before changing UI wiring, for example:

- `src/renderer/src/screens/Kanban/kanbanActions.ts`

Responsibilities:

- Define `KanbanTaskMutationAction` descriptors used by card buttons and task detail/Office panels.
- Define `isValidKanbanTransition(from, to)`.
- Define `requiresKanbanConfirmation(action)`.
- Define `buildKanbanTaskActions(task, { isHqActive, selectedAgentId? })` to keep UI button availability deterministic and testable.

Do not place Electron/window calls in this module; keep it pure for fast unit tests.

### 2. Harden backend mutation wrapper inputs

In `src/main/kanban.ts`, add missing input validation to existing mutation functions:

- `assignTask`: reject missing `taskId`; reject undefined `assignee` differently from explicit `null` if necessary.
- `completeTask`, `blockTask`, `unblockTask`, `archiveTask`, `specifyTask`, `reclaimTask`, `commentTask`: reject missing/blank `taskId`.
- Keep existing remote-only behavior first if current convention requires it; otherwise validate inputs first consistently. Tests should lock the chosen behavior.

No new generic `moveTask` backend is required unless the Hermes CLI grows one. The renderer should map status moves to existing command-specific IPC methods.

### 3. Keep IPC explicit and typed

Existing IPC channels are adequate. Phase 5 implementation should verify and, if needed, extend:

- `kanban-assign-task(taskId, assignee, profile?)`
- `kanban-complete-task(taskId, result?, profile?)`
- `kanban-block-task(taskId, reason?, profile?)`
- `kanban-unblock-task(taskId, profile?)`
- `kanban-create-task(input, profile?)`

Add tests that parse `src/main/index.ts` and `src/preload/index.ts` to assert every required mutation channel is registered and exposed. This guards future regressions without requiring Electron to boot.

### 4. Renderer board actions

Refactor `Kanban.tsx` so current behavior is covered by tests before modification:

- Move transition rules to `kanbanActions.ts` and replace local `isValidDragTransition`.
- Add assign/unassign controls to cards or task detail:
  - A compact card action may be Assign to active profile when a profile prop exists.
  - Task detail should expose an assignee select/list using Office profiles if available, or a text input as a fallback.
- Add busy state per task/action (`task.id:action`) if a single task can show multiple action buttons.
- Disable all mutation controls when `isHqActive` is true.
- Ensure every successful mutation calls `loadAll(true)` and refreshes open detail.

### 5. Office task panel integration

Office should not duplicate Kanban internals; it should drive the same action model.

Implementation options, in order of preference:

1. **Navigate + contextual Kanban panel**: Office side-panel action Open Kanban tasks navigates to Kanban with optional profile filter/selected assignee. Add Create task shortcut only if Layout can pass route state.
2. **Embedded selected-agent task actions**: Office selected-agent panel lists active/blocked task counts and offers:
   - Assign selected task to this agent only when a selected Kanban task context exists.
   - Open blocked tasks navigates to Kanban filtered to blocked/profile.
3. **Minimal Phase 5**: keep Office as launcher and make Kanban fully operational; document Office deep-linking as follow-up if current Layout has no route-state mechanism.

Do not add blind mutation buttons to Office without a concrete selected task context.

## Test plan: write RED tests first

Use this environment for all commands:

```bash
ssh -i /root/.ssh/orion_home -o BatchMode=yes orion@172.30.104.213 \
  'export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH; cd /srv/orion/worktrees/office-task-actions && <command>'
```

### A. Backend mutation validation tests

Add `tests/kanban-actions-main.test.ts`.

Mock dependencies before importing `src/main/kanban.ts`:

- `src/main/hermes`: `isRemoteOnlyMode()` false.
- `src/main/config`: local mode.
- `child_process.execFile`: capture CLI args and synthesize success.
- `src/main/installer`: deterministic `HERMES_HOME`, `HERMES_PYTHON`, `hermesCliArgs`, `getEnhancedPath`.

Exact test cases:

- `assignTask("task-1", "default", "profile-a")` invokes `kanban assign task-1 default` with `-p profile-a` when profile is non-default.
- `assignTask("task-1", null)` invokes `kanban assign task-1 none`.
- `completeTask("task-1", "shipped")` invokes `kanban complete task-1 --result shipped`.
- `blockTask("task-1", "waiting on user")` invokes `kanban block task-1 "waiting on user"`.
- `unblockTask("task-1")` invokes `kanban unblock task-1`.
- `createTask({ title, assignee, priority, workspace, triage })` invokes expected flags and parses JSON `{ id }`.
- Each mutation rejects blank `taskId` without invoking `execFile`.
- `commentTask("task-1", "   ")` rejects empty comments without invoking `execFile`.

RED command:

```bash
npm test -- tests/kanban-actions-main.test.ts
```

Expected RED before implementation: blank-task validation assertions fail for functions that currently invoke CLI with an empty ID.

GREEN command:

```bash
npm test -- tests/kanban-actions-main.test.ts tests/kanban-unsupported.test.ts
```

### B. IPC/preload mutation surface tests

Extend or add `tests/kanban-ipc-surface.test.ts`.

Exact assertions:

- `src/main/index.ts` registers handlers for:
  - `kanban-create-task`
  - `kanban-assign-task`
  - `kanban-complete-task`
  - `kanban-block-task`
  - `kanban-unblock-task`
  - `kanban-archive-task`
  - `kanban-specify-task`
  - `kanban-reclaim-task`
  - `kanban-comment-task`
- `src/preload/index.ts` invokes each corresponding channel.
- `src/preload/index.d.ts` declares each corresponding `kanban*` method.

RED command:

```bash
npm test -- tests/kanban-ipc-surface.test.ts
```

Expected result may already be GREEN because the channels exist. If so, keep the test as characterization coverage before UI changes.

### C. Pure renderer action model tests

Add `tests/kanban-renderer-actions.test.ts` for the new pure helper.

Exact assertions:

- `isValidKanbanTransition("todo", "blocked")`, `("ready", "blocked")`, `("running", "blocked")`, `("blocked", "ready")`, and `("todo", "done")` are true.
- `("todo", "running")`, `("done", "ready")`, `("blocked", "running")`, and same-status transitions are false.
- `requiresKanbanConfirmation("complete")` and `requiresKanbanConfirmation("archive")` are true; assign/block/unblock/create are false.
- `buildKanbanTaskActions(task, { isHqActive: true })` returns only read-only/detail actions or marks all mutation actions disabled.
- `buildKanbanTaskActions(blockedTask, { isHqActive: false })` includes unblock and complete, excludes block.
- `buildKanbanTaskActions(readyTask, { selectedAgentId: "default" })` includes assign-to-selected-agent when assignee differs.

RED command:

```bash
npm test -- tests/kanban-renderer-actions.test.ts
```

Expected RED before implementation: module missing.

GREEN command:

```bash
npm test -- tests/kanban-renderer-actions.test.ts tests/office-actions.test.ts
```

### D. Renderer behavior tests

Prefer extracting small pure functions over mounting the entire Electron screen. If React tests are already configured, extend `tests/office-renderer.test.ts` or add `tests/kanban-renderer.test.ts`.

Exact behavior to cover:

- Complete action calls `window.confirm`; when false, no `kanbanCompleteTask` call occurs.
- Archive action calls `window.confirm`; when false, no `kanbanArchiveTask` call occurs.
- Block action calls `window.prompt` and passes the reason to `kanbanBlockTask`.
- Assign action passes selected profile/agent to `kanbanAssignTask`.
- HQ active mode disables/hides mutation buttons.
- Successful mutation invokes refresh (`kanbanListTasks`) and, if detail is open, `kanbanGetTask`.

RED command:

```bash
npm test -- tests/kanban-renderer.test.ts
```

If full component mounting is too brittle, keep the mutation orchestration in an exported hook/helper and test that instead.

### E. Typecheck and focused regression suite

After each GREEN step:

```bash
npm run typecheck
npm test -- tests/kanban-actions-main.test.ts tests/kanban-ipc-surface.test.ts tests/kanban-renderer-actions.test.ts tests/office-actions.test.ts tests/preload-api-surface.test.ts tests/kanban-unsupported.test.ts
```

Before final implementation commit:

```bash
npm test
npm run typecheck
```

## Mutation safety requirements

- Never mutate the HQ virtual board. Renderer must disable controls; backend should never receive mutation requests sourced from HQ tasks.
- Confirm before completing or archiving tasks.
- Do not confirm assign/block/unblock/create, but surface errors clearly.
- Validate missing `taskId` in the backend wrapper so a renderer bug cannot execute malformed CLI commands.
- Preserve `unsupportedMode` semantics: only actual remote-only unsupported results should set that flag.
- Keep all mutation calls profile-aware and pass the active profile through IPC.
- Refresh UI after success; do not optimistically move cards unless rollback/error handling is implemented.

## Acceptance criteria

- From Kanban, the operator can create a task, assign/unassign it, block it with a reason, unblock it, complete it after confirmation, and archive only after confirmation.
- Drag/drop and button transitions use one shared tested transition policy.
- Office selected-agent panel provides safe task-operation entry points without ambiguous act-on-nothing buttons.
- All mutation IPC/preload/type declarations are covered by tests.
- Backend wrapper rejects blank task IDs and does not spawn the CLI for invalid mutations.
- HQ board remains read-only.
- Focused tests, full `npm test`, and `npm run typecheck` pass on the remote worktree.

## Commit guidance

Implementation should use small TDD commits, for example:

1. `test(kanban): characterize mutation ipc and cli wrappers`
2. `fix(kanban): validate task mutation inputs`
3. `test(kanban): cover renderer task action policy`
4. `feat(kanban): share tested mutation action model`
5. `feat(office): surface safe kanban task operation entry points`

For this planning phase, commit only this document:

```bash
git add docs/plans/2026-06-09-office-task-actions.md
git commit -m "docs: plan office kanban task actions"
```
