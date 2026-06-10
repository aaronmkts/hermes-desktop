# Phase 4 plan: Office task/agent details side panel (strict TDD)

Date: 2026-06-09
Worktree: `/srv/orion/worktrees/office-task-panel`

## Goal

Clicking native Office agents (and task/workload affordances surfaced from their Kanban summaries) should open an in-app right side panel that gives the operator a read-heavy operational view:

- Agent identity and state from existing `OfficeStatus`.
- Task assignment/workload context from existing Kanban summary data.
- Blocked/running/ready/todo/done-recent status, with blocked work visually called out.
- Agent runtime context: gateway, platforms, recent sessions/messages, active session, last interaction, model/provider, description/personality.
- Navigation/action affordances already supported by Office (`Chat`, `Open Kanban`, `Open Gateway`, `Open Providers`, `Open Sessions/logs`, `Restart remote gateway`).

This phase should avoid new backend/task-detail fetches unless a test proves an existing field is insufficient. It should mostly compose existing Office status and Kanban board/task summaries.

## Current inspection notes

- `src/renderer/src/screens/Office/Office.tsx`
  - Already renders a native 3D Office and an inline right `<aside>` when `selectedAgent` is set.
  - Selection is driven by `Office3D` via `onSelectAgent={setSelectedId}`.
  - Existing panel shows identity, role, status, model, provider, gateway, reason, recent work, task counts, platform counts, operational rows, and action buttons.
  - Current implementation is monolithic and hard to unit-test as a details panel; factor presentation/summary logic without changing behavior first.
- `src/renderer/src/screens/Office/officeStatus.ts`
  - `officeStatusToAgents()` maps `OfficeStatus.profiles[].kanban` into `OfficeAgent.kanban` with defaults.
  - `buildOperatorCards()` already aggregates running/blocked/doneRecent task counts for top Office cards.
- `src/renderer/src/screens/Office/officeActions.ts`
  - `buildOfficeAgentActions()` and `buildOfficeAgentStatusRows()` are existing testable seams.
  - `buildOfficeAgentStatusRows()` only shows running/blocked counts when non-zero; does not yet present full workload distribution or explicit assignment context.
- `src/main/office-status.ts`
  - `OfficeProfileStatus` contains `kanban`, `platforms`, sessions, provider/model, gateway, description/personality.
  - `reduceOfficeAgentState()` already maps blocked Kanban tasks to `waiting` unless recent/running work or errors take precedence.
  - `summarizeKanban()` currently counts `todo`, `ready`, `running`, `blocked`, and recent done tasks from `listKanbanTasks(profile)`.
- `src/renderer/src/screens/Kanban/Kanban.tsx`
  - Kanban cards already show task title, priority, assignee, tenant, age, and open a detail modal with `kanbanGetTask()` when clicked.
  - Phase 4 Office should not duplicate the Kanban detail modal; use the Office side panel as the native agent/workload drill-down and keep `Open Kanban` as the task-detail escape hatch.
- Existing tests:
  - `tests/office-renderer.test.ts` covers `officeStatusToAgents()` and `buildOperatorCards()`.
  - `tests/office-status.test.ts` covers Office status aggregation and state reduction.
  - `tests/office-actions.test.ts` covers action/status-row helpers.

## Design direction

1. Extract the details side panel from `Office.tsx` into `src/renderer/src/screens/Office/OfficeDetailsPanel.tsx`.
2. Add pure helper(s) in `officeActions.ts` or a new `officeDetails.ts` for deriving display rows/sections from an `OfficeAgent`:
   - Full workload row: `todo`, `ready`, `running`, `blocked`, `doneRecent`.
   - Blocked summary row with warning severity when `blocked > 0`.
   - Assignment context row, phrased as profile-scoped/assigned work because OfficeStatus only has counts by profile today.
   - Active session/last interaction row when available.
   - Description/personality rows when available.
3. Keep panel source-of-truth as the already-loaded `selectedAgent` object; no new IPC in the panel during this phase.
4. Add stable accessible labels and test ids/classes for tests and future E2E:
   - `aria-label="Office details panel"`
   - close button label/title from `office.close`
   - workload section label such as `Workload`
   - blocked warning label/value when blocked tasks exist
5. Keep `Office.tsx` responsible for state, polling, CEO persistence, and action handling; the extracted panel receives props and renders.

## Exact files to change

Primary implementation files:

- `src/renderer/src/screens/Office/Office.tsx`
  - Replace the inline selected-agent `<aside>` with `OfficeDetailsPanel`.
  - Keep state/action handlers in `Office.tsx`.
- `src/renderer/src/screens/Office/OfficeDetailsPanel.tsx` (new)
  - Presentational component for selected agent details and actions.
- `src/renderer/src/screens/Office/officeActions.ts`
  - Add/extend pure helper(s), or keep existing helpers but add workload/assignment display rows.
- `src/renderer/src/screens/Office/officeStatus.ts`
  - Only touch if tests show `officeStatusToAgents()` is missing required data or defaults.
- `src/renderer/src/screens/Office/office3d/core/types.ts`
  - Only touch if `OfficeAgent` lacks a field already present in `OfficeProfileStatus` and needed by panel.
- Locale files containing `office.*` strings, if the repo has locale JSON/resources for Office labels.

Test files:

- `tests/office-actions.test.ts`
  - Add RED unit tests for workload/assignment/blocked row derivation.
- `tests/office-renderer.test.ts`
  - Add/extend tests for OfficeStatus -> OfficeAgent data preservation if new fields are needed.
- `tests/office-details-panel.test.tsx` (new, preferred)
  - React Testing Library tests for panel rendering and actions.
  - Mock/stub only the presentational props; avoid rendering `Office3D`.
- Optional: `tests/office-status.test.ts`
  - Only add cases if main-process aggregation changes. Expected not needed for this phase.

## Strict TDD sequence

### 0. Baseline verification

Run before edits:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
cd /srv/orion/worktrees/office-task-panel
npm test -- tests/office-actions.test.ts tests/office-renderer.test.ts tests/office-status.test.ts
npm run typecheck
```

Expected: existing tests/typecheck pass. If not, record baseline failures before changing code.

### 1. RED: helper rows for workload and assignment context

Add failing tests to `tests/office-actions.test.ts` for a helper such as `buildOfficeAgentDetailRows(agent, now)` or for extended `buildOfficeAgentStatusRows(agent, now)`:

- Given an agent with `kanban: { todo: 2, ready: 1, running: 1, blocked: 3, doneRecent: 4 }`, expect a workload row/section value equivalent to `2 todo · 1 ready · 1 running · 3 blocked · 4 done today`.
- Given `blocked > 0`, expect a warning-severity blocked row and a value that includes the blocked count.
- Given an agent id/name and Kanban counts, expect an assignment/workload context row that makes clear these are profile-scoped assigned tasks for that agent/profile.
- Given `activeSessionId` and `lastInteractionAt`, expect active session/last interaction rows.
- Given `description` and `personality`, expect those rows.

RED command:

```bash
npm test -- tests/office-actions.test.ts
```

Expected RED: new helper/export or new rows do not exist yet.

### 2. GREEN: implement pure details helper

Implement minimal helper logic in `officeActions.ts` (or `officeDetails.ts`) to satisfy the tests.

GREEN command:

```bash
npm test -- tests/office-actions.test.ts
```

Then run targeted renderer/status regression:

```bash
npm test -- tests/office-renderer.test.ts tests/office-status.test.ts
```

### 3. RED: presentational details panel

Add `tests/office-details-panel.test.tsx` using React Testing Library.

Test cases:

- Renders selected agent name, role (`CEO`/employee), status, model/provider, gateway state, workload section, blocked warning, platform counts, and description/personality when supplied.
- Invokes `onClose` when close button is clicked.
- Renders actions from props and invokes `onAction(action)` when an enabled action button is clicked.
- Disabled actions are disabled and not invoked.
- Does not require `window.hermesAPI` or render `Office3D`.

RED command:

```bash
npm test -- tests/office-details-panel.test.tsx
```

Expected RED: component file does not exist.

### 4. GREEN: extract `OfficeDetailsPanel.tsx`

Create `OfficeDetailsPanel.tsx` and move the existing aside UI into it. Use the helper rows from step 2 for workload/status sections. Props should be narrow and testable, e.g.:

```ts
interface OfficeDetailsPanelProps {
  agent: OfficeAgent;
  isCeo: boolean;
  statusColor: string;
  statusRows: OfficeAgentStatusRow[];
  actions: OfficeAgentActionDescriptor[];
  actionBusy: string | null;
  onClose: () => void;
  onAction: (action: OfficeAgentActionDescriptor) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}
```

GREEN command:

```bash
npm test -- tests/office-details-panel.test.tsx tests/office-actions.test.ts
```

### 5. RED/GREEN: integrate into `Office.tsx`

Add/adjust tests if there is an existing Office component test seam. If rendering full `Office.tsx` is too heavy because of Three.js, avoid brittle full-component tests and verify by typecheck plus the extracted panel tests.

Implementation:

- Import `OfficeDetailsPanel` in `Office.tsx`.
- Remove the inline `<aside>` block and pass the same derived props to the panel.
- Preserve behavior of `handleAgentAction`, `selectedActions`, `selectedStatusRows`, close behavior, CEO badge, and status color.
- Ensure clicking an Office agent still selects it through existing `Office3D` callback.
- Ensure panel closes when the selected profile disappears on refresh (existing effect should still handle this).

Targeted command:

```bash
npm test -- tests/office-details-panel.test.tsx tests/office-actions.test.ts tests/office-renderer.test.ts tests/office-status.test.ts
```

### 6. Full verification

Run:

```bash
npm test
npm run typecheck
```

If time permits and Electron build dependencies are healthy:

```bash
npm run build
```

## Acceptance criteria

- Clicking a native Office agent opens a right side panel inside the Office screen; no external browser/webview is used.
- The panel shows:
  - agent name and role (CEO/employee),
  - state/status with state reason,
  - model/provider,
  - gateway running/stopped,
  - connected/error/configured platform counts,
  - recent sessions/messages and last interaction when available,
  - active session id when available,
  - description/personality when available,
  - full workload distribution: todo, ready, running, blocked, done today,
  - explicit blocked warning when blocked tasks exist,
  - assignment/profile context explaining that these Kanban counts are scoped to that selected agent/profile.
- The panel uses existing `OfficeStatus` / `OfficeAgent` data and does not introduce extra task-detail polling or per-click IPC in this phase.
- Existing Office actions still work from the panel:
  - Chat opens OneChat modal for selected profile.
  - Open Kanban/Gateway/Providers/Sessions navigates through existing `onNavigate` path.
  - Restart remote gateway uses existing `window.hermesAPI.restartGateway` availability/busy state.
- Panel close button clears selection.
- Existing `OfficeStatus` aggregation behavior is preserved:
  - running tasks make an agent active,
  - blocked tasks make an otherwise available agent waiting,
  - platform/auth errors still take precedence.
- Tests are written before implementation and fail RED for missing behavior before going GREEN.
- Final `npm test` and `npm run typecheck` pass, or any unrelated baseline failures are documented with command output.

## Risks and constraints

- `Office.tsx` currently has large inline style blocks. Extraction should avoid broad style rewrites; preserve visual behavior while making panel testable.
- Full `Office.tsx` rendering may be brittle because `Office3D` depends on Three/R3F. Prefer a presentational panel test seam over mocking the full 3D scene.
- OfficeStatus currently provides aggregate counts, not individual task titles. Do not promise task-title detail from Office unless a separate backend/API phase is added.
- HQ read-only Kanban tasks in `Kanban.tsx` are separate from Office profile Kanban counts; this phase should not attempt to merge or mutate HQ tasks.

## Commit guidance

Implementation commits after this plan should be small and TDD-oriented:

1. `test(office): specify agent detail workload rows`
2. `feat(office): derive details panel workload context`
3. `test(office): specify native details side panel`
4. `feat(office): extract office details side panel`
5. `test(office): cover office status detail regressions` (only if needed)

For this planning phase, commit only this plan document:

```bash
git add docs/plans/2026-06-09-office-task-panel.md
git commit -m "docs: plan office task details side panel"
```
