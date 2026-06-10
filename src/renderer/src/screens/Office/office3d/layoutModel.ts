import {
  assignOfficeLayoutWorkstations,
  createDefaultOfficeLayout,
  normalizeOfficeLayout as normalizeSharedOfficeLayout,
  type OfficeFurniturePlacement,
  type OfficeLayout as SharedOfficeLayout,
  type OfficeWorkstation,
} from "../../../../../shared/office-layout";
import type { FurniturePlacement, Workstation } from "./layout";

export type DeskPlacement = OfficeWorkstation;
export type OfficeLayout = SharedOfficeLayout;
export type OfficeLayoutItemId = `furniture:${string}` | `desk:${string}`;
export interface OfficeLayoutDraftState {
  saved: OfficeLayout;
  draft: OfficeLayout;
  selectedItemId: OfficeLayoutItemId | null;
  dirty: boolean;
}

const CANVAS_MIN = 0;
const CANVAS_MAX = 1800;
const cloneFurniture = (p: OfficeFurniturePlacement): OfficeFurniturePlacement => ({ ...p });
const cloneDesk = (d: OfficeWorkstation): OfficeWorkstation => ({ ...d });
const clamp = (n: number): number => Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, n));
const normalizeDeg = (n: number): number => (((Math.round(n / 15) * 15) % 360) + 360) % 360;
const now = () => new Date().toISOString();

export function getLayoutFurniture(layout: OfficeLayout): FurniturePlacement[] {
  return [...layout.restFurniture, ...layout.executiveDecor].map((p) => ({ ...p }));
}

export function buildDefaultOfficeLayout(agentIds: string[], ceoId?: string | null): OfficeLayout {
  const layout = createDefaultOfficeLayout();
  return {
    ...layout,
    workstations: assignOfficeLayoutWorkstations(layout, agentIds, ceoId),
  };
}

export function moveLayoutItem(layout: OfficeLayout, itemId: OfficeLayoutItemId, dx: number, dy: number): OfficeLayout {
  if (itemId.startsWith("furniture:")) {
    const id = itemId.slice("furniture:".length);
    const move = (p: OfficeFurniturePlacement) => p.id === id ? { ...p, x: clamp(p.x + dx), y: clamp(p.y + dy) } : { ...p };
    return { ...layout, updatedAt: now(), restFurniture: layout.restFurniture.map(move), executiveDecor: layout.executiveDecor.map(move), workstations: layout.workstations.map(cloneDesk), walls: layout.walls.map((w) => ({ ...w })), restSeats: layout.restSeats.map((s) => ({ ...s })) };
  }
  const id = itemId.slice("desk:".length);
  return {
    ...layout,
    updatedAt: now(),
    restFurniture: layout.restFurniture.map(cloneFurniture),
    executiveDecor: layout.executiveDecor.map(cloneFurniture),
    workstations: layout.workstations.map((d) =>
      d.id === id
        ? { ...d, deskX: clamp(d.deskX + dx), deskY: clamp(d.deskY + dy), chairX: clamp(d.chairX + dx), chairY: clamp(d.chairY + dy), seatX: clamp(d.seatX + dx), seatY: clamp(d.seatY + dy) }
        : { ...d },
    ),
  };
}

export function rotateLayoutItem(layout: OfficeLayout, itemId: OfficeLayoutItemId, deltaDeg: number): OfficeLayout {
  if (itemId.startsWith("furniture:")) {
    const id = itemId.slice("furniture:".length);
    const rotate = (p: OfficeFurniturePlacement) => p.id === id ? { ...p, facingDeg: normalizeDeg(p.facingDeg + deltaDeg) } : { ...p };
    return { ...layout, updatedAt: now(), restFurniture: layout.restFurniture.map(rotate), executiveDecor: layout.executiveDecor.map(rotate), workstations: layout.workstations.map(cloneDesk) };
  }
  const id = itemId.slice("desk:".length);
  return {
    ...layout,
    updatedAt: now(),
    restFurniture: layout.restFurniture.map(cloneFurniture),
    executiveDecor: layout.executiveDecor.map(cloneFurniture),
    workstations: layout.workstations.map((d) =>
      d.id === id ? { ...d, deskFacingDeg: normalizeDeg(d.deskFacingDeg + deltaDeg), chairFacingDeg: normalizeDeg(d.chairFacingDeg + deltaDeg) } : { ...d },
    ),
  };
}

export function assignDesk(layout: OfficeLayout, deskId: string, agentId: string | null): OfficeLayout {
  return {
    ...layout,
    updatedAt: now(),
    restFurniture: layout.restFurniture.map(cloneFurniture),
    executiveDecor: layout.executiveDecor.map(cloneFurniture),
    workstations: layout.workstations.map((d) => ({ ...d, agentId: d.id === deskId ? agentId : agentId && d.agentId === agentId ? null : d.agentId })),
  };
}

export function normalizeOfficeLayout(input: unknown, agentIds: string[], ceoId?: string | null): OfficeLayout {
  const raw = normalizeSharedOfficeLayout(input);
  const canonical = input && typeof input === "object" && (input as { schemaVersion?: unknown }).schemaVersion === 1 ? raw : buildDefaultOfficeLayout(agentIds, ceoId);
  return { ...canonical, workstations: assignOfficeLayoutWorkstations(canonical, agentIds, ceoId) };
}

export function layoutToWorkstations(layout: OfficeLayout, agentIds: string[], ceoId?: string | null): Workstation[] {
  const normalized = normalizeOfficeLayout(layout, agentIds, ceoId);
  const current = new Set(agentIds);
  return normalized.workstations
    .filter((d) => d.agentId && current.has(d.agentId))
    .map((d) => ({ ...d, agentId: d.agentId ?? "" }));
}
