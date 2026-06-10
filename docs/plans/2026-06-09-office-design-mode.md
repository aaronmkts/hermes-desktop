# Phase 2 plan: native ORION Office design/edit mode (strict TDD)

Date: 2026-06-09
Worktree: `/srv/orion/worktrees/office-design-mode`
Branch: `orion/office-design-mode`

## Goal

Add an in-app room design mode to the native ORION Office so users can enter edit mode, select furniture, move/rotate it, assign desks to agents, save the custom layout, and reset to the default layout. This phase should build on the existing native React/Three Office, but keep layout editing mostly as deterministic state transitions with tests first.

## Current code shape inspected

- `src/renderer/src/screens/Office/Office.tsx`
  - Owns agent/status loading, selected agent side panel, desktop-local CEO state, and renders `<Office3D agents selectedId onSelectAgent />`.
  - Existing local persistence pattern: `localStorage` with a namespaced key (`hermes:office:ceo`).
- `src/renderer/src/screens/Office/office3d/Office3D.tsx`
  - Builds workstations via `buildWorkstations(agentIds, ceoId)` and renders static furniture arrays (`REST_FURNITURE`, `EXECUTIVE_DECOR`) plus agent simulation.
  - `Canvas` uses `onPointerMissed` to clear agent selection; `OrbitControls` are always enabled.
- `src/renderer/src/screens/Office/office3d/objects/furniture.tsx`
  - `FurniturePieces` renders `FurniturePlacement[]`; `Workstations` renders `Workstation[]`; individual GLB item component is internal.
  - Good seam for selectable furniture wrappers and for rendering a model from persisted `FurniturePlacement` data.
- `src/renderer/src/screens/Office/office3d/core/types.ts`
  - Contains agent/render types; office layout data should either live in `layout.ts` or a new `layoutModel.ts` to avoid mixing simulation actor types with persistence/editing types.
- `src/renderer/src/screens/Office/office3d/layout.ts`
  - Current layout is generated code/constants: `FurnitureType`, `FurniturePlacement`, `Workstation`, `buildWorkstations`, `REST_FURNITURE`, `EXECUTIVE_DECOR`.
  - This is the right source for a default layout adapter, but not the right place for all edit reducer logic.
- Test runner: Vitest (`npm test`); renderer tests already exist under `src/renderer/src/screens/**`.

## Reasonable OfficeLayout API to target

Create a small, serializable layout model that can be adapted into existing render props.

File: `src/renderer/src/screens/Office/office3d/layoutModel.ts`

```ts
import type { FurniturePlacement, FurnitureType, Workstation } from "./layout";

export interface OfficeLayout {
  version: 1;
  furniture: FurniturePlacement[];
  desks: DeskPlacement[];
}

export interface DeskPlacement {
  id: string;
  agentId: string | null;
  deskX: number;
  deskY: number;
  deskFacingDeg: number;
  chairX: number;
  chairY: number;
  chairFacingDeg: number;
  seatX: number;
  seatY: number;
  seatFacing: number;
  isExecutive?: boolean;
}

export type OfficeLayoutItemId = `furniture:${string}` | `desk:${string}`;

export interface OfficeLayoutSelection {
  itemId: OfficeLayoutItemId | null;
}

export interface OfficeLayoutDraftState {
  saved: OfficeLayout;
  draft: OfficeLayout;
  selectedItemId: OfficeLayoutItemId | null;
  dirty: boolean;
}

export function buildDefaultOfficeLayout(agentIds: string[], ceoId?: string | null): OfficeLayout;
export function normalizeOfficeLayout(input: unknown, agentIds: string[], ceoId?: string | null): OfficeLayout;
export function layoutToWorkstations(layout: OfficeLayout, agentIds: string[], ceoId?: string | null): Workstation[];
export function moveLayoutItem(layout: OfficeLayout, itemId: OfficeLayoutItemId, dx: number, dy: number): OfficeLayout;
export function rotateLayoutItem(layout: OfficeLayout, itemId: OfficeLayoutItemId, deltaDeg: number): OfficeLayout;
export function assignDesk(layout: OfficeLayout, deskId: string, agentId: string | null): OfficeLayout;
```

Notes:
- Keep the persisted model versioned from day one.
- Persist user-editable rest/decor furniture in `furniture` and user-editable desks in `desks`.
- Convert current `Workstation` objects into `DeskPlacement`; render path converts back with `layoutToWorkstations` so existing `AgentsLayer` continues to receive `Workstation[]`.
- Use `agentId: null` for unassigned desks. `layoutToWorkstations` should only emit desks assigned to currently known agents; append generated default desks for newly discovered agents if needed so no agent disappears.
- Keep CEO treatment compatible: if `ceoId` exists, preserve/ensure one executive desk assigned to that agent.

## TDD implementation sequence

### 1) RED: pure layout model tests

Create: `src/renderer/src/screens/Office/office3d/layoutModel.test.ts`

Tests first:
- `buildDefaultOfficeLayout` includes:
  - all generated desks from `buildWorkstations(agentIds, ceoId)` converted into `desks`;
  - `REST_FURNITURE` always;
  - `EXECUTIVE_DECOR` only when `ceoId` is present;
  - stable IDs and `version: 1`.
- `moveLayoutItem`:
  - moves `furniture:<id>` by `dx/dy` without mutating input;
  - moves `desk:<id>` by translating desk/chair/seat coordinates together;
  - clamps final coordinates inside the 0..1800 canvas bounds (or explicitly documents no clamp; prefer clamp for UX).
- `rotateLayoutItem`:
  - rotates furniture `facingDeg` by normalized 15-degree increments (0..359);
  - rotates desks by updating both `deskFacingDeg` and `chairFacingDeg`; do not lose seat facing.
- `assignDesk`:
  - assigns an agent to exactly one desk by clearing previous desk assignment for that agent;
  - allows `null` to unassign;
  - is immutable.
- `normalizeOfficeLayout`:
  - accepts a valid v1 persisted layout;
  - falls back to default for malformed JSON/object;
  - drops unknown furniture types;
  - appends missing desks for currently known agents;
  - keeps persisted placements for known desk IDs.
- `layoutToWorkstations`:
  - emits assigned desks for current agents;
  - emits generated desks for new agents not present in persisted layout;
  - does not emit desks assigned to removed agents.

RED command:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
cd /srv/orion/worktrees/office-design-mode
npm test -- src/renderer/src/screens/Office/office3d/layoutModel.test.ts
```

Expected RED: test file fails because `layoutModel.ts` does not exist.

### 2) GREEN: implement pure model only

Create: `src/renderer/src/screens/Office/office3d/layoutModel.ts`

Keep this file dependency-light and free of React/Three. Import only data/types from `layout.ts`.

GREEN commands:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
cd /srv/orion/worktrees/office-design-mode
npm test -- src/renderer/src/screens/Office/office3d/layoutModel.test.ts
npm run typecheck:web
```

Refactor only after green:
- Add helper functions for item lookup/update.
- Keep constants for canvas bounds and rotation step exported only if tests need them.

### 3) RED: persistence hook tests

Create: `src/renderer/src/screens/Office/useOfficeLayoutDraft.test.tsx`
Create: `src/renderer/src/screens/Office/useOfficeLayoutDraft.ts`

API target:

```ts
export interface UseOfficeLayoutDraftResult {
  layout: OfficeLayout;
  savedLayout: OfficeLayout;
  selectedItemId: OfficeLayoutItemId | null;
  dirty: boolean;
  selectItem(id: OfficeLayoutItemId | null): void;
  moveSelected(dx: number, dy: number): void;
  rotateSelected(deltaDeg: number): void;
  assignDesk(deskId: string, agentId: string | null): void;
  save(): void;
  resetDraft(): void;
  resetToDefault(): void;
}

export function useOfficeLayoutDraft(args: {
  storageKey: string;
  agentIds: string[];
  ceoId: string | null;
}): UseOfficeLayoutDraftResult;
```

Tests:
- Initializes from `localStorage` when valid.
- Falls back to default when storage is absent or invalid.
- Marks dirty after move/rotate/assign and clears dirty on save.
- `resetDraft` restores last saved layout without changing storage.
- `resetToDefault` replaces draft and storage with default layout.
- Reconciles when agent list changes: preserves saved furniture, appends a new desk for a new agent, removes assignment to missing agent.

RED command:

```bash
npm test -- src/renderer/src/screens/Office/useOfficeLayoutDraft.test.tsx
```

Expected RED: hook missing.

### 4) GREEN: persistence hook

Implement `useOfficeLayoutDraft.ts` using the pure model. Suggested storage key:

```ts
export const OFFICE_LAYOUT_STORAGE_KEY = "hermes:office:layout:v1";
```

If layouts should be profile-scoped, derive key in `Office.tsx` as:

```ts
const layoutStorageKey = `${OFFICE_LAYOUT_STORAGE_KEY}:${profile ?? "default"}`;
```

Recommendation: profile-scope the key so each viewed ORION/Hermes profile set can have its own layout, but keep a single default key if product expects one global office.

GREEN commands:

```bash
npm test -- src/renderer/src/screens/Office/useOfficeLayoutDraft.test.tsx src/renderer/src/screens/Office/office3d/layoutModel.test.ts
npm run typecheck:web
```

### 5) RED: Office shell UI tests

Create: `src/renderer/src/screens/Office/Office.designMode.test.tsx`

Mock heavy 3D and IPC:
- Mock `./office3d/Office3D` with a lightweight component that exposes props and calls callbacks from test buttons.
- Mock `window.hermesAPI.getOfficeStatus` to return two profiles converted by current status helpers.
- Keep i18n assertions on accessible labels/text, not translated implementation details if existing test utilities support it.

Behavior tests:
- Renders a `Design mode` button/toggle in the Office header.
- Clicking it switches Office into design mode and passes `editMode={true}` plus `layout`/selection callbacks to `Office3D`.
- In design mode, selecting `desk:<id>` shows a design inspector instead of the agent action sidebar.
- Inspector exposes:
  - selected item id/type;
  - Move controls (up/down/left/right or nudge buttons);
  - Rotate left/right;
  - Desk assignment dropdown for desks;
  - Save layout;
  - Reset draft;
  - Reset to default.
- Save persists and disables/clears dirty indicator.
- Reset draft reverts unsaved movement.
- Agent action sidebar still works outside design mode.

RED command:

```bash
npm test -- src/renderer/src/screens/Office/Office.designMode.test.tsx
```

Expected RED: design controls/props do not exist.

### 6) GREEN: Office.tsx integration

Modify: `src/renderer/src/screens/Office/Office.tsx`

Implementation guidance:
- Add local `designMode` state.
- Use `useOfficeLayoutDraft({ storageKey, agentIds: positionedAgents.map(a => a.id), ceoId })`.
- Pass layout/edit props into `Office3D`:

```tsx
<Office3D
  agents={positionedAgents}
  selectedId={selectedId}
  onSelectAgent={setSelectedId}
  layout={layoutDraft.layout}
  editMode={designMode}
  selectedLayoutItemId={layoutDraft.selectedItemId}
  onSelectLayoutItem={layoutDraft.selectItem}
/>
```

- When entering design mode, clear selected agent to avoid two sidebars competing.
- When leaving design mode, clear selected layout item.
- Add `OfficeDesignInspector.tsx` if the sidebar gets large.
- Do not wire drag in this step; button-based nudge/rotate first gives testable behavior and usable MVP.

GREEN commands:

```bash
npm test -- src/renderer/src/screens/Office/Office.designMode.test.tsx src/renderer/src/screens/Office/useOfficeLayoutDraft.test.tsx src/renderer/src/screens/Office/office3d/layoutModel.test.ts
npm run typecheck:web
```

### 7) RED: Office3D render-state tests where feasible

Prefer pure renderer-adapter tests over WebGL-heavy Canvas tests.

Create: `src/renderer/src/screens/Office/office3d/office3dLayoutAdapter.test.ts`
Create/modify: `src/renderer/src/screens/Office/office3d/office3dLayoutAdapter.ts`

Tests:
- Given no custom layout, adapter returns `buildDefaultOfficeLayout` output matching current static rendering.
- Given custom layout, adapter returns custom `workstations`, `furniture`, and executive decor/furniture to render.
- Edit hit target metadata is generated for each furniture and desk item:
  - `itemId: furniture:<id>` for furniture;
  - `itemId: desk:<id>` for desk/workstation groups.
- Selected item metadata marks the selected item for highlight.

RED command:

```bash
npm test -- src/renderer/src/screens/Office/office3d/office3dLayoutAdapter.test.ts
```

Expected RED: adapter missing.

### 8) GREEN: Office3D edit rendering and selection

Modify:
- `src/renderer/src/screens/Office/office3d/Office3D.tsx`
- `src/renderer/src/screens/Office/office3d/objects/furniture.tsx`
- Add `src/renderer/src/screens/Office/office3d/office3dLayoutAdapter.ts`

Target `Office3D` props:

```ts
interface Office3DProps {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelectAgent: (id: string | null) => void;
  layout?: OfficeLayout;
  editMode?: boolean;
  selectedLayoutItemId?: OfficeLayoutItemId | null;
  onSelectLayoutItem?: (id: OfficeLayoutItemId | null) => void;
}
```

Implementation guidance:
- `workstations = layout ? layoutToWorkstations(layout, agentIds, ceoId) : buildWorkstations(...)`.
- `furniture = layout ? layout.furniture : [...REST_FURNITURE, ...(ceoId ? EXECUTIVE_DECOR : [])]`.
- In edit mode:
  - clicking furniture/desk selects layout item and calls `event.stopPropagation()` so `onPointerMissed` does not clear it;
  - agent clicks should either be disabled or still select agents only when not editing; prefer disabled to avoid confusion;
  - disable `OrbitControls` panning/rotation only during drag later, not during button-edit MVP;
  - render a simple highlight ring/box around selected furniture/desk using a transparent `meshBasicMaterial` or `<Box>` from drei if already available.
- In non-edit mode, preserve all existing behavior.
- Export no WebGL-heavy internals unless tests need pure metadata only.

GREEN commands:

```bash
npm test -- src/renderer/src/screens/Office/office3d/office3dLayoutAdapter.test.ts src/renderer/src/screens/Office/Office.designMode.test.tsx
npm run typecheck:web
```

### 9) RED/GREEN: pointer drag follow-up (optional in this phase if button nudge is accepted)

If native drag is required for acceptance, add it after the button-edit MVP is green.

Create: `src/renderer/src/screens/Office/office3d/editPointer.test.ts`
Create: `src/renderer/src/screens/Office/office3d/editPointer.ts`

Pure tests for math:
- Converts a Three floor intersection point to canvas x/y using existing inverse of `toWorld` (add `fromWorld` to `core/geometry.ts` with tests).
- Computes move delta from pointer-down item origin to pointer-move floor point.
- Snaps move to a 10-canvas-unit grid.
- Ignores drag when item not selected or edit mode false.

Commands:

```bash
npm test -- src/renderer/src/screens/Office/office3d/editPointer.test.ts src/renderer/src/screens/Office/office3d/core/geometry.test.ts
npm run typecheck:web
```

Then wire `onPointerDown/onPointerMove/onPointerUp` in `Office3D`/furniture wrappers. Use this only after model/hook/Office UI tests are green.

## Manual verification checklist

Run all commands from the remote host:

```bash
ssh -i /root/.ssh/orion_home -o BatchMode=yes orion@172.30.104.213
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
cd /srv/orion/worktrees/office-design-mode
npm test
npm run typecheck:web
npm run lint
```

Manual app checks (after implementation):
- Open Office tab; existing non-edit behavior still works: agents load, select sidebar opens, CEO assignment works, chat button works.
- Toggle Design mode; camera remains usable and agent action sidebar is hidden.
- Select a couch/beanbag/desk; selected item visibly highlights and inspector shows controls.
- Nudge selected furniture and rotate it; layout changes immediately in scene.
- Select a desk and assign a different agent; that agent walks/sits at that desk after status simulation settles.
- Save layout, reload app/tab; custom placements remain.
- Make an unsaved change, reset draft; last saved layout returns.
- Reset to default; current generated layout returns and persisted custom layout is cleared/replaced.
- Add/remove a profile; layout reconciles without crashing and new profiles receive a desk.

## Acceptance criteria

- User can toggle design/edit mode from the Office tab without leaving the app.
- In edit mode, furniture and desks are selectable independently from agents.
- Selected furniture can be moved and rotated with tested controls; optional pointer drag is covered by pure math tests if included.
- Selected desks can be assigned/unassigned to agents; one agent cannot be assigned to multiple desks.
- Save persists the custom layout in renderer storage; reload restores it.
- Reset draft and reset to default work and are visibly reflected in the scene.
- Existing Office status, agent selection, CEO assignment, and OneChat behavior are unchanged outside edit mode.
- New logic is covered by RED/GREEN Vitest tests before implementation.
- `npm test`, `npm run typecheck:web`, and `npm run lint` pass before the implementation PR is considered complete.

## Commit guidance

Recommended implementation commits after this planning commit:
1. `test(office): cover layout model editing operations` (RED tests)
2. `feat(office): add serializable office layout model` (GREEN)
3. `test(office): cover design mode persistence hook`
4. `feat(office): persist office layout drafts`
5. `test(office): cover design mode shell controls`
6. `feat(office): add office design mode inspector`
7. `test(office): cover 3d layout adapter selection metadata`
8. `feat(office): render selectable editable office layout`
9. Optional: `feat(office): drag furniture in design mode`

For this delegated planning task, commit only this document:

```bash
git add docs/plans/2026-06-09-office-design-mode.md
git commit -m "docs(office): plan design mode phase 2"
```
