# Phase 3 plan: embedded 3D Kanban board visualisation (TDD)

Date: 2026-06-09
Worktree: `/srv/orion/worktrees/office-kanban-board`
Scope: Hermes Desktop Electron/React/TypeScript native Office screen.

## Goal

Add a **read-only Kanban board inside the native 3D Office** so the Office view shows visible columns and task cards for existing Hermes Kanban work. The board must be fed by the current Kanban/OfficeStatus pipeline, must show running/blocked/done states, and must not mutate tasks in this phase.

The deliverable for Phase 3 is a tested read-only visualization:

- visible 3D board in `Office3D`
- deterministic columns
- cards grouped by status
- visual emphasis for `running`, `blocked`, and recently `done`
- no drag/drop, move, assign, archive, comment, specify, unblock, or other mutation affordance
- graceful empty/loading/error handling through existing Office status refresh behavior

## Current code inspected

### Main Kanban source: `src/main/kanban.ts`

Existing interfaces include `KanbanTask`, `KanbanBoard`, details, comments, events, and runs. The task shape already has the card fields this phase needs:

- `id`
- `title`
- `body`
- `assignee`
- `status`
- `priority`
- `tenant`
- `workspace_kind`
- `workspace_path`
- timestamps including `started_at` and `completed_at`
- `result`
- `skills`

`listTasks({ profile, includeArchived: false })` already returns `KanbanTask[]` and is used by OfficeStatus today for counts. Existing Kanban mutations are separate functions and must not be called from the Office visualization.

### Main Office status aggregation: `src/main/office-status.ts`

Current `OfficeStatus` includes only summarized Kanban counts per profile:

```ts
export interface OfficeKanbanCounts {
  todo: number;
  ready: number;
  running: number;
  blocked: number;
  doneRecent: number;
}
```

`OfficeProfileStatus.kanban` is counts only. `OfficeStatusDependencies.listKanbanTasks` already fetches full Kanban tasks but `summarizeKanban` discards card detail. This is the clean expansion point: preserve read-only task summaries alongside the existing counts.

Important existing behavior to keep:

- `reduceOfficeAgentState` uses `kanban.running` and `kanban.blocked` to set agent state.
- `getOfficeStatus` calls `listKanbanTasks(id)` once per profile.
- default dependency uses `kanban.listTasks({ profile: p, includeArchived: false })` and falls back to `[]` on errors.

### Renderer status mapping: `src/renderer/src/screens/Office/officeStatus.ts`

`officeStatusToAgents` maps `OfficeStatus.profiles[]` into `OfficeAgent[]` and preserves `kanban` counts on each agent. This should be extended to carry read-only Kanban board data to Office3D via `OfficeAgent`, not by adding a second IPC call in the renderer.

### 3D office: `src/renderer/src/screens/Office/office3d/Office3D.tsx`

Current scene renders:

- room shell
- interior walls
- workstations/furniture
- animated agents
- orbit controls

There is no board object yet. Best integration point is a new child component inside `Office3D`, rendered after room/walls and before or alongside furniture/agents. Keep layout/math pure and testable in separate modules.

## Proposed data model changes

### Main process exported types

Add a compact read-only card type in `src/main/office-status.ts`:

```ts
export interface OfficeKanbanCard {
  id: string;
  title: string;
  status: string;
  assignee?: string | null;
  priority?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  result?: string | null;
  skills?: string[];
}
```

Extend `OfficeProfileStatus`:

```ts
kanban: OfficeKanbanCounts;
kanbanCards: OfficeKanbanCard[];
```

Rationale:

- keeps existing `kanban` counts stable for current Office cards/agent state
- avoids exposing full task body/workspace paths in the 3D board unnecessarily
- gives renderer enough data for visible columns and state badges
- preserves the one existing OfficeStatus IPC data flow

### Renderer/3D types

Extend `OfficeAgent` in `src/renderer/src/screens/Office/office3d/core/types.ts` with:

```ts
kanbanCards?: OfficeKanbanCard[];
```

Then `officeStatusToAgents` maps `profile.kanbanCards ?? []` into each agent.

## Pure mapping and layout modules

Add pure renderer module:

`src/renderer/src/screens/Office/office3d/kanbanBoard.ts`

Suggested exports:

```ts
export type OfficeBoardColumnId = "todo" | "ready" | "running" | "blocked" | "done";

export interface OfficeBoardCardView {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  status: string;
  column: OfficeBoardColumnId;
  priority: number;
  accent: "normal" | "running" | "blocked" | "done";
  subtitle: string | null;
}

export interface OfficeBoardColumnView {
  id: OfficeBoardColumnId;
  label: string;
  cards: OfficeBoardCardView[];
}

export interface OfficeBoardViewModel {
  columns: OfficeBoardColumnView[];
  total: number;
}
```

Pure functions:

- `normalizeOfficeKanbanStatus(status: unknown): OfficeBoardColumnId`
  - `todo` -> `todo`
  - `ready`, `specified`, `queued`, `backlog` -> `ready`
  - `running`, `in_progress`, `active` -> `running`
  - `blocked`, `waiting`, `needs_input` -> `blocked`
  - `done`, `completed`, `closed` -> `done`
  - unknown -> `todo` or `ready` (choose one in tests; recommended: `todo` to avoid implying runnable work)
- `buildOfficeKanbanBoard(agents: OfficeAgent[], options?: { maxCardsPerColumn?: number }): OfficeBoardViewModel`
  - flatten cards from all agents
  - attach agent name/id
  - group by normalized status
  - deterministic sort within a column: accent severity (`blocked`, `running`, normal, `done`), priority descending, then title/id ascending
  - apply per-column cap for scene readability

Add pure 3D layout module:

`src/renderer/src/screens/Office/office3d/kanbanBoardLayout.ts`

Suggested exports:

- `BOARD_COLUMN_ORDER`
- `getBoardColumnAnchor(columnIndex: number)`
- `getBoardCardTransform(columnIndex: number, cardIndex: number)`
- constants for board/card dimensions

Rationale: React Three rendering can stay simple while tests cover deterministic positions without trying to snapshot WebGL.

## Rendering design

Add component:

`src/renderer/src/screens/Office/office3d/objects/KanbanBoard3D.tsx`

Responsibilities:

- render a wall-mounted or freestanding board in the existing office scene
- render five columns: Todo, Ready, Running, Blocked, Done
- render cards as small planes/boxes with local text labels
- use distinct accents:
  - running: green/blue glow or stripe
  - blocked: red/purple stripe
  - done: muted green/check indicator
  - normal: neutral card
- cards should be readable from the default camera and not overlap agent desks
- if no cards: render column headers plus an unobtrusive `No active Kanban tasks` note

Integration in `Office3D.tsx`:

```tsx
const board = useMemo(() => buildOfficeKanbanBoard(agents, { maxCardsPerColumn: 6 }), [agents]);
...
<KanbanBoard3D board={board} />
```

Keep it read-only:

- no `onPointerDown`, drag handlers, drop targets, or mutation callbacks
- no `window.hermesAPI.moveKanbanTask`/`updateKanbanTask`/etc. references
- optional hover/click for local selection can be deferred; if added, it must only show local details and never call mutation APIs

## Strict TDD plan

Use red-green-refactor for every step. Do not implement rendering before failing tests exist.

### Step 1: main-process task summaries in OfficeStatus

Create `src/main/office-status.test.ts`.

Failing tests first:

1. `getOfficeStatus includes read-only kanbanCards per profile`
   - inject `listProfiles` returning two profiles
   - inject `listKanbanTasks` returning task-like objects with `id`, `title`, `status`, `assignee`, `priority`, timestamps, `result`, `skills`
   - assert each `OfficeProfileStatus` has `kanbanCards` with sanitized fields
   - assert existing `kanban` counts still match

2. `getOfficeStatus does not leak task body or workspace path into kanbanCards`
   - task input contains `body`, `workspace_path`, `workspace_kind`
   - assert these keys are absent from output cards

3. `getOfficeStatus falls back to empty kanbanCards when listKanbanTasks fails`
   - dependency throws
   - assert `kanbanCards: []` and counts all zero

4. `doneRecent count remains 24h-bounded while done cards remain visible`
   - one completed recent, one completed old
   - assert `doneRecent === 1`
   - assert both cards appear with status `done`/`completed` unless Phase 3 explicitly caps done cards upstream (recommended: keep visible; cap only renderer)

Implementation after red:

- add `OfficeKanbanCard` type
- widen `OfficeKanbanTaskInput` fields needed for summary
- add `summarizeKanbanCards(tasks)` pure helper
- include `kanbanCards` in `OfficeProfileStatus` output

Verification command:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
npm run test -- src/main/office-status.test.ts
```

### Step 2: renderer status-to-agent mapping

Create `src/renderer/src/screens/Office/officeStatus.test.ts`.

Failing tests first:

1. `officeStatusToAgents carries kanbanCards through to OfficeAgent`
   - build minimal OfficeStatus with one profile and two cards
   - assert `agents[0].kanbanCards` equals cards
   - assert existing `kanban` counts still default/merge correctly

2. `officeStatusToAgents defaults kanbanCards to [] for older OfficeStatus payloads`
   - omit cards
   - assert empty array

Implementation after red:

- update `OfficeAgent` type
- map `profile.kanbanCards ?? []`

Verification command:

```bash
npm run test -- src/renderer/src/screens/Office/officeStatus.test.ts
```

### Step 3: pure board view-model mapping

Create `src/renderer/src/screens/Office/office3d/kanbanBoard.test.ts`.

Failing tests first:

1. `normalizes statuses into visible Office board columns`
   - cover `todo`, `ready`, `running`, `blocked`, `done`, `completed`, `closed`, unknown

2. `buildOfficeKanbanBoard groups cards into fixed columns in deterministic order`
   - two agents with mixed cards
   - assert column order exactly `todo`, `ready`, `running`, `blocked`, `done`
   - assert cards include `agentId`, `agentName`, `priority`, `accent`, and stable sorted IDs

3. `blocked and running receive visual accents`
   - blocked -> `accent: "blocked"`
   - running -> `accent: "running"`
   - done/completed -> `accent: "done"`

4. `caps cards per column without mutating input agents`
   - generate more than cap
   - assert output count capped
   - assert input card arrays unchanged

Implementation after red:

- add `kanbanBoard.ts` pure module
- keep no React/Three imports in this module

Verification command:

```bash
npm run test -- src/renderer/src/screens/Office/office3d/kanbanBoard.test.ts
```

### Step 4: pure board layout mapping

Create `src/renderer/src/screens/Office/office3d/kanbanBoardLayout.test.ts`.

Failing tests first:

1. `returns one anchor per fixed column with increasing x positions`
2. `card transforms stack downward within a column without overlap`
3. `layout is deterministic for repeated calls`
4. `board bounds stay within the intended office wall area`

Implementation after red:

- add `kanbanBoardLayout.ts`
- export constants for board width/height/card spacing
- use existing `toWorld`/`SCALE` if helpful, but keep tests independent and deterministic

Verification command:

```bash
npm run test -- src/renderer/src/screens/Office/office3d/kanbanBoardLayout.test.ts
```

### Step 5: React rendering tests for the 3D board component

Create `src/renderer/src/screens/Office/office3d/objects/KanbanBoard3D.test.tsx`.

Use React Testing Library or `react-test-renderer` with mocks for drei text if needed. Keep the test focused on React tree intent, not WebGL raster output.

Failing tests first:

1. `renders all column labels`
   - render `KanbanBoard3D` with a small board model
   - assert Todo/Ready/Running/Blocked/Done labels exist

2. `renders task card titles and agent subtitles`
   - assert card title text exists
   - assert subtitle like `Alice · p2` exists

3. `renders empty-state text when total is zero`

4. `does not expose mutation callbacks or drag handlers`
   - shallow/tree inspect props on rendered card groups
   - assert no `onPointerDown`, `onPointerMove`, `onPointerUp`, `draggable`, or mutation callback props on card elements

Implementation after red:

- add `KanbanBoard3D.tsx`
- render Drei/Troika text consistently with existing local font setup
- keep component props limited to `{ board: OfficeBoardViewModel }`

Verification command:

```bash
npm run test -- src/renderer/src/screens/Office/office3d/objects/KanbanBoard3D.test.tsx
```

### Step 6: Office3D integration test

Create or extend `src/renderer/src/screens/Office/office3d/Office3D.test.tsx` with mocks for `@react-three/fiber`, `@react-three/drei`, heavy GLB-dependent children, and theme provider if necessary.

Failing tests first:

1. `Office3D builds a Kanban board from agents and renders KanbanBoard3D`
   - mock `KanbanBoard3D`
   - pass agents with cards
   - assert mock receives columns containing the expected task IDs

2. `Office3D renders an empty board when agents have no cards`

3. `Office3D does not pass mutation callbacks to KanbanBoard3D`
   - assert props only contain `board`

Implementation after red:

- import `buildOfficeKanbanBoard`
- compute with `useMemo`
- render `<KanbanBoard3D board={board} />`

Verification command:

```bash
npm run test -- src/renderer/src/screens/Office/office3d/Office3D.test.tsx
```

### Step 7: regression guard against accidental mutations

Add a static/read-only regression test, either in `kanbanBoard.test.ts` or a dedicated test:

- import the pure Office board modules and `KanbanBoard3D`
- assert no imports from `src/renderer/src/screens/Kanban/Kanban.tsx`
- assert no references to `moveTask`, `handleMove`, `handleDrop`, `archive`, `assign`, `unblock`, `specify`, `comment`, or `window.hermesAPI.*Kanban*` inside the Office 3D board files

This can be a simple Node/Vitest filesystem test over the relevant files. It is intentionally narrow: Phase 3 must be visualization-only.

### Step 8: full validation before commit

Run targeted tests as they are introduced, then run:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
npm run test -- src/main/office-status.test.ts src/renderer/src/screens/Office/officeStatus.test.ts src/renderer/src/screens/Office/office3d/kanbanBoard.test.ts src/renderer/src/screens/Office/office3d/kanbanBoardLayout.test.ts src/renderer/src/screens/Office/office3d/objects/KanbanBoard3D.test.tsx src/renderer/src/screens/Office/office3d/Office3D.test.tsx
npm run typecheck
npm run lint -- --max-warnings=0
```

If the full lint command is too broad for unrelated existing warnings, document the unrelated failures and run eslint on only changed files as a fallback. Do not merge with failing targeted tests.

## Acceptance criteria

- Office status payload includes read-only Kanban card summaries for each profile.
- Renderer maps card summaries into agents.
- Native `Office3D` renders a Kanban board with fixed visible columns.
- Cards are grouped by normalized status.
- Running, blocked, and done states are visually distinguishable.
- Empty board state is visible and non-disruptive.
- No task mutation APIs are imported, called, or reachable from the Office 3D board.
- Pure mapping/layout tests cover deterministic grouping and transforms.
- React rendering tests cover labels/cards/empty state and read-only behavior.
- Existing Office operator cards and agent state logic continue to pass.

## Risks and mitigations

- **WebGL tests can be brittle.** Mitigate by testing pure view-model/layout functions and mocking R3F/Drei in React tests.
- **OfficeStatus payload could grow too large.** Mitigate by sending compact card summaries and applying renderer card caps.
- **Scene readability.** Mitigate with per-column cap and fixed board placement; defer scrolling/pagination to a later phase.
- **Accidental mutation affordances from existing Kanban screen.** Mitigate with no dependency on `screens/Kanban/Kanban.tsx` and a static regression test.
- **Backwards compatibility with older payloads.** Mitigate by defaulting `kanbanCards` to `[]` in `officeStatusToAgents`.

## Out of scope for Phase 3

- Drag/drop task movement
- task creation/editing/archive/assign/comment/specify/unblock
- task detail drawer
- board switching
- polling changes beyond current OfficeStatus refresh path
- persistence of Office board UI preferences
- replacing the existing full Kanban screen
