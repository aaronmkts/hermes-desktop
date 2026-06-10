# Phase 1 plan: native ORION Office persistent layout model (TDD)

## Goal

Replace the current hard-coded native Office layout with a versioned, validated, persistent layout model that can be loaded, saved, reset, and safely consumed by the native Electron/React Office experience. This phase is **model + persistence + IPC only**. It does not build an editor UI, drag handles, or Claw3D integration.

## Current findings

Inspected files:

- `src/renderer/src/screens/Office/office3d/layout.ts`
  - Defines static canvas-space constants (`DIVIDER_X`, `DOOR_Y_*`, walls, workstation grid, CEO desk, rest seats, rest furniture).
  - Exports `FurnitureType`, `FurniturePlacement`, `WallSegment`, `Seat`, `Workstation` and `buildWorkstations(agentIds, ceoId)`.
  - No persisted layout schema; renderer relies on module constants/functions.
- `src/main/config.ts`
  - Persists desktop settings in `${HERMES_HOME}/desktop.json` through `readDesktopConfig()` / `writeDesktopConfig()`.
  - This is the safest first persistence location for an Office layout preference because it is already desktop-specific and available in main-process tests.
- `src/main/index.ts`
  - Registers `office-status` near gateway IPC handlers.
  - New Office layout IPC should live adjacent to `office-status` for discoverability.
- `src/preload/index.ts` and `src/preload/index.d.ts`
  - Expose `getOfficeStatus(profile?)` through `window.hermes`.
  - Existing tests enforce preload/API parity and main/preload IPC parity.
- Existing relevant tests:
  - `tests/office-renderer.test.ts`, `tests/office-status.test.ts`, `tests/office-advanced.test.ts` for Office expectations.
  - `tests/ipc-handlers.test.ts` and `tests/preload-api-surface.test.ts` for IPC/preload parity.
  - `tests/connection-config-security.test.ts`, `tests/locale-persistence.test.ts`, `tests/safe-write-file.test.ts` show config/persistence testing style.

## Non-goals for Phase 1

- No Claw3D/hermes-office dependency or migration requirement.
- No visual layout editor.
- No per-agent manual assignment UI.
- No renderer mutation of the layout except through explicit `save/reset` IPC calls.
- No breaking change to `buildWorkstations(agentIds, ceoId)` callers; maintain a compatibility adapter while new code lands.

## Proposed data model

Create shared, renderer-safe types in `src/shared/office-layout.ts`.

```ts
export const OFFICE_LAYOUT_SCHEMA_VERSION = 1;
export const OFFICE_CANVAS_SIZE = { width: 1800, height: 1800 } as const;

export type OfficeFurnitureType =
  | "desk"
  | "executiveDesk"
  | "chair"
  | "couch"
  | "beanbag"
  | "plant"
  | "whitePot"
  | "computer"
  | "pantry";

export interface OfficePoint { x: number; y: number }
export interface OfficeSeat extends OfficePoint { facing: number }
export interface OfficeFurniturePlacement extends OfficePoint {
  id: string;
  type: OfficeFurnitureType;
  facingDeg: number;
  tint?: string | null;
}
export interface OfficeWallSegment extends OfficePoint {
  id: string;
  w: number;
  h: number;
}
export interface OfficeWorkstation {
  id: string;
  agentId?: string | null;
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
export interface OfficeLayout {
  schemaVersion: 1;
  canvas: { width: 1800; height: 1800 };
  divider: { x: number; doorYMin: number; doorYMax: number };
  walls: OfficeWallSegment[];
  workstations: OfficeWorkstation[];
  restSeats: OfficeSeat[];
  restFurniture: OfficeFurniturePlacement[];
  executiveDecor: OfficeFurniturePlacement[];
  updatedAt?: string;
}
```

Important modeling choice: `agentId` should be optional/null in the persisted layout. The layout stores physical stations, not a live roster. A renderer adapter can assign current `agentIds`/`ceoId` to physical stations deterministically, preserving today’s behavior.

## Files to add/change

### Add

- `src/shared/office-layout.ts`
  - Types, constants, allowed furniture types, validator/normalizer helpers.
  - `createDefaultOfficeLayout(): OfficeLayout` returns safe defaults matching the existing hard-coded layout.
  - `normalizeOfficeLayout(input: unknown): OfficeLayout` validates untrusted persisted data and falls back/repairs safely.
  - `assignOfficeLayoutWorkstations(layout, agentIds, ceoId)` returns `OfficeWorkstation[]` with current roster assignments.
- `src/main/office-layout-store.ts`
  - Persistence functions using `readDesktopConfig()`/`writeDesktopConfig()`:
    - `getOfficeLayout(): OfficeLayout`
    - `saveOfficeLayout(layout: unknown): OfficeLayout`
    - `resetOfficeLayout(): OfficeLayout`
  - Store under `desktop.json.officeLayout`.
  - Always return normalized data; never throw for malformed stored layout unless filesystem write fails.
- `tests/office-layout.test.ts`
  - Shared model/defaults/validator tests.
- `tests/office-layout-store.test.ts`
  - Main-process persistence tests.
- Optional if test coverage is clearer: `tests/office-layout-ipc.test.ts`
  - Static consistency or extracted registration tests if runtime IPC testing is not practical.

### Change

- `src/renderer/src/screens/Office/office3d/layout.ts`
  - Import shared types/constants/default layout.
  - Keep current exported names (`FurnitureType`, `FurniturePlacement`, `WallSegment`, `Seat`, `Workstation`, `DIVIDER_X`, `DOOR_Y_*`, `INTERIOR_WALLS`, `REST_SEATS`, `REST_FURNITURE`, `EXECUTIVE_DECOR`, `buildWorkstations`) as compatibility exports.
  - Implement compatibility exports from `createDefaultOfficeLayout()` and `assignOfficeLayoutWorkstations()`.
- `src/main/index.ts`
  - Register IPC handlers near `office-status`:
    - `office-layout-get`
    - `office-layout-save`
    - `office-layout-reset`
- `src/preload/index.ts`
  - Add methods:
    - `getOfficeLayout(): Promise<OfficeLayout>`
    - `saveOfficeLayout(layout: unknown): Promise<OfficeLayout>`
    - `resetOfficeLayout(): Promise<OfficeLayout>`
- `src/preload/index.d.ts`
  - Import `OfficeLayout` from shared file.
  - Add the three methods to `HermesAPI`.
- `tests/ipc-handlers.test.ts`
  - Add new channel expectations if not already covered by parity.
- `tests/preload-api-surface.test.ts`
  - Add new method expectations if not already covered by parity.

## Validator/normalizer requirements

`normalizeOfficeLayout(input)` must be defensive because it handles persisted user-editable JSON.

- Accept only `schemaVersion: 1`; otherwise return default layout.
- Clamp coordinates to `0..1800`.
- Clamp wall dimensions to non-negative and no larger than canvas bounds.
- Require stable string IDs; drop entries with missing/empty IDs.
- Drop furniture with unknown `type`.
- Normalize `facingDeg` to `0..360` and seat `facing` to radians within `-Math.PI..Math.PI`.
- Validate tint as `undefined`, `null`, or CSS hex `#RGB`/`#RRGGBB`; invalid tint becomes `undefined`.
- Ensure arrays exist; missing arrays default to safe defaults for that section.
- Ensure divider door bounds are sane (`doorYMin < doorYMax`, both in canvas); invalid divider defaults to the built-in divider.
- Preserve unknown future fields? Phase 1 should **not** preserve them; return canonical schema only.
- `saveOfficeLayout()` should stamp `updatedAt` with an ISO string after normalization.

## TDD sequence

All commands below must run on the remote host from `/srv/orion/worktrees/office-layout-model` with:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
```

### 0. Baseline verification

GREEN baseline before changes:

```bash
npm test -- tests/office-renderer.test.ts tests/office-status.test.ts tests/office-advanced.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run typecheck
```

If baseline fails, record the failure before implementing and limit Phase 1 changes to the planned surface.

### 1. Shared layout model tests (RED)

Create `tests/office-layout.test.ts` first. Expected failing command:

```bash
npm test -- tests/office-layout.test.ts
```

Test cases:

- `createDefaultOfficeLayout()` returns schema version 1, 1800x1800 canvas, current divider (`x=1180`, `doorYMin=820`, `doorYMax=1000`), two partition wall segments, six rest seats, rest furniture including `rest-couch`, `rest-pantry`, and executive decor including `ceo-couch`.
- Default workstation assignment adapter preserves current behavior:
  - employees fill the 5-column grid from `(145,300)` with `210x240` spacing;
  - CEO is removed from the employee grid and assigned `desk-ceo` at `(470,1180)` with `isExecutive: true`.
- `normalizeOfficeLayout(undefined)` returns defaults.
- Malformed schema version returns defaults.
- Bad coordinates/facing values are clamped/normalized.
- Unknown furniture types and missing IDs are dropped.
- Invalid tint is removed; `null` tint is preserved.
- Missing arrays are filled from defaults.

Then implement `src/shared/office-layout.ts` until GREEN:

```bash
npm test -- tests/office-layout.test.ts
```

### 2. Renderer compatibility tests (RED/GREEN)

Extend `tests/office-renderer.test.ts` or add focused assertions in `tests/office-layout.test.ts` to ensure existing exports from `src/renderer/src/screens/Office/office3d/layout.ts` still behave the same.

RED command before refactor:

```bash
npm test -- tests/office-layout.test.ts tests/office-renderer.test.ts
```

Refactor `layout.ts` to delegate to shared model while preserving its public API. GREEN:

```bash
npm test -- tests/office-layout.test.ts tests/office-renderer.test.ts
```

### 3. Main persistence store tests (RED)

Create `tests/office-layout-store.test.ts` first. Mock or isolate `HERMES_HOME` using the existing project test style for config tests.

Expected failing command:

```bash
npm test -- tests/office-layout-store.test.ts
```

Test cases:

- `getOfficeLayout()` returns defaults when `desktop.json` is absent.
- `saveOfficeLayout(layout)` writes normalized layout to `desktop.json.officeLayout` and returns the normalized layout with `updatedAt`.
- `getOfficeLayout()` reads the saved layout back.
- Malformed `desktop.json.officeLayout` is ignored/repaired to defaults.
- `resetOfficeLayout()` removes/replaces stored custom layout with default layout and persists it.
- Existing unrelated desktop config keys (connection mode, remote URL, etc.) are preserved on save/reset.

Implement `src/main/office-layout-store.ts`. GREEN:

```bash
npm test -- tests/office-layout-store.test.ts tests/office-layout.test.ts
```

### 4. IPC/preload tests (RED)

Update parity tests and/or add focused tests before implementation.

RED command:

```bash
npm test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
```

Expected assertions:

- Main registers `office-layout-get`, `office-layout-save`, `office-layout-reset`.
- Preload invokes the same channels.
- `window.hermes` types expose `getOfficeLayout`, `saveOfficeLayout`, `resetOfficeLayout`.

Implement handlers in `src/main/index.ts`, preload methods in `src/preload/index.ts`, and declarations in `src/preload/index.d.ts`. GREEN:

```bash
npm test -- tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
```

### 5. Full focused verification

Run all Office/config/API surface tests touched by this phase:

```bash
npm test -- tests/office-layout.test.ts tests/office-layout-store.test.ts tests/office-renderer.test.ts tests/office-status.test.ts tests/office-advanced.test.ts tests/ipc-handlers.test.ts tests/preload-api-surface.test.ts
npm run typecheck
```

Optional final full suite if time allows:

```bash
npm test
```

## Acceptance criteria

- A shared `OfficeLayout` schema exists and is versioned.
- Default layout exactly preserves current native Office visual semantics from `office3d/layout.ts`.
- Persisted layout data is normalized before use and cannot crash renderer/main due to malformed JSON shape.
- Main process can load, save, and reset layout in `${HERMES_HOME}/desktop.json.officeLayout` without losing unrelated desktop config keys.
- Preload exposes typed `getOfficeLayout`, `saveOfficeLayout`, and `resetOfficeLayout` APIs.
- IPC channels are covered by existing parity tests.
- Existing Office renderer/status/advanced tests still pass.
- `npm run typecheck` passes.

## Dependencies on other phases

- Phase 2 renderer integration/editor should consume `window.hermes.getOfficeLayout()` and pass the loaded layout into Office rendering instead of relying solely on module constants.
- Phase 2 may add UI affordances to save/reset; Phase 1 only provides safe APIs.
- Phase 3 migration/import, if desired, can map Claw3D/hermes-office layouts into this schema, but Phase 1 must not depend on Claw3D.
- Any future schema version must add a migration function rather than silently treating v2 as v1.

## Commit guidance

Implementation should be committed in small TDD commits, for example:

1. `test(office): define layout model expectations`
2. `feat(office): add versioned layout model and defaults`
3. `test(office): cover layout persistence store`
4. `feat(office): persist layout in desktop config`
5. `feat(office): expose layout IPC through preload`
6. `test(office): preserve renderer layout compatibility`

For this planning task, commit **only this plan document** with a docs commit:

```bash
git add docs/plans/2026-06-09-office-layout-model.md
git commit -m "docs(office): plan persistent layout model phase"
```
