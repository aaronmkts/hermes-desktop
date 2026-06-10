import {
  buildWorkstations,
  EXECUTIVE_DECOR,
  REST_FURNITURE,
  type FurniturePlacement,
  type FurnitureType,
  type Workstation,
} from "./layout";

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
export interface OfficeLayout {
  version: 1;
  furniture: FurniturePlacement[];
  desks: DeskPlacement[];
}
export type OfficeLayoutItemId = `furniture:${string}` | `desk:${string}`;
export interface OfficeLayoutDraftState {
  saved: OfficeLayout;
  draft: OfficeLayout;
  selectedItemId: OfficeLayoutItemId | null;
  dirty: boolean;
}

const CANVAS_MIN = 0;
const CANVAS_MAX = 1800;
const VALID_TYPES = new Set<FurnitureType>([
  "desk",
  "executiveDesk",
  "chair",
  "couch",
  "beanbag",
  "plant",
  "whitePot",
  "computer",
  "pantry",
]);

const cloneFurniture = (p: FurniturePlacement): FurniturePlacement => ({
  ...p,
});
const cloneDesk = (d: DeskPlacement): DeskPlacement => ({ ...d });
const clamp = (n: number): number =>
  Math.min(CANVAS_MAX, Math.max(CANVAS_MIN, n));
const normalizeDeg = (n: number): number =>
  (((Math.round(n / 15) * 15) % 360) + 360) % 360;

function workstationToDesk(w: Workstation): DeskPlacement {
  return { ...w };
}
function deskToWorkstation(d: DeskPlacement): Workstation {
  return { ...d, agentId: d.agentId ?? "" };
}

export function buildDefaultOfficeLayout(
  agentIds: string[],
  ceoId?: string | null,
): OfficeLayout {
  return {
    version: 1,
    furniture: [...REST_FURNITURE, ...(ceoId ? EXECUTIVE_DECOR : [])].map(
      cloneFurniture,
    ),
    desks: buildWorkstations(agentIds, ceoId).map(workstationToDesk),
  };
}

export function moveLayoutItem(
  layout: OfficeLayout,
  itemId: OfficeLayoutItemId,
  dx: number,
  dy: number,
): OfficeLayout {
  if (itemId.startsWith("furniture:")) {
    const id = itemId.slice("furniture:".length);
    return {
      ...layout,
      furniture: layout.furniture.map((p) =>
        p.id === id
          ? { ...p, x: clamp(p.x + dx), y: clamp(p.y + dy) }
          : { ...p },
      ),
      desks: layout.desks.map(cloneDesk),
    };
  }
  const id = itemId.slice("desk:".length);
  return {
    ...layout,
    furniture: layout.furniture.map(cloneFurniture),
    desks: layout.desks.map((d) =>
      d.id === id
        ? {
            ...d,
            deskX: clamp(d.deskX + dx),
            deskY: clamp(d.deskY + dy),
            chairX: clamp(d.chairX + dx),
            chairY: clamp(d.chairY + dy),
            seatX: clamp(d.seatX + dx),
            seatY: clamp(d.seatY + dy),
          }
        : { ...d },
    ),
  };
}

export function rotateLayoutItem(
  layout: OfficeLayout,
  itemId: OfficeLayoutItemId,
  deltaDeg: number,
): OfficeLayout {
  if (itemId.startsWith("furniture:")) {
    const id = itemId.slice("furniture:".length);
    return {
      ...layout,
      furniture: layout.furniture.map((p) =>
        p.id === id
          ? { ...p, facingDeg: normalizeDeg(p.facingDeg + deltaDeg) }
          : { ...p },
      ),
      desks: layout.desks.map(cloneDesk),
    };
  }
  const id = itemId.slice("desk:".length);
  return {
    ...layout,
    furniture: layout.furniture.map(cloneFurniture),
    desks: layout.desks.map((d) =>
      d.id === id
        ? {
            ...d,
            deskFacingDeg: normalizeDeg(d.deskFacingDeg + deltaDeg),
            chairFacingDeg: normalizeDeg(d.chairFacingDeg + deltaDeg),
          }
        : { ...d },
    ),
  };
}

export function assignDesk(
  layout: OfficeLayout,
  deskId: string,
  agentId: string | null,
): OfficeLayout {
  return {
    ...layout,
    furniture: layout.furniture.map(cloneFurniture),
    desks: layout.desks.map((d) => ({
      ...d,
      agentId:
        d.id === deskId
          ? agentId
          : agentId && d.agentId === agentId
            ? null
            : d.agentId,
    })),
  };
}

function isNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}
function isFurniture(p: unknown): p is FurniturePlacement {
  const v = p as Partial<FurniturePlacement>;
  return (
    typeof v?.id === "string" &&
    typeof v.type === "string" &&
    VALID_TYPES.has(v.type as FurnitureType) &&
    isNumber(v.x) &&
    isNumber(v.y) &&
    isNumber(v.facingDeg)
  );
}
function isDesk(d: unknown): d is DeskPlacement {
  const v = d as Partial<DeskPlacement>;
  return (
    typeof v?.id === "string" &&
    (typeof v.agentId === "string" || v.agentId === null) &&
    isNumber(v.deskX) &&
    isNumber(v.deskY) &&
    isNumber(v.deskFacingDeg) &&
    isNumber(v.chairX) &&
    isNumber(v.chairY) &&
    isNumber(v.chairFacingDeg) &&
    isNumber(v.seatX) &&
    isNumber(v.seatY) &&
    isNumber(v.seatFacing)
  );
}

export function normalizeOfficeLayout(
  input: unknown,
  agentIds: string[],
  ceoId?: string | null,
): OfficeLayout {
  const fallback = buildDefaultOfficeLayout(agentIds, ceoId);
  const raw = input as Partial<OfficeLayout>;
  if (
    !raw ||
    raw.version !== 1 ||
    !Array.isArray(raw.furniture) ||
    !Array.isArray(raw.desks)
  )
    return fallback;
  const current = new Set(agentIds);
  const defaultByAgent = new Map(
    fallback.desks.filter((d) => d.agentId).map((d) => [d.agentId, d]),
  );
  const desks = raw.desks
    .filter(isDesk)
    .map(cloneDesk)
    .map((d) => (current.has(d.agentId ?? "") ? d : { ...d, agentId: null }));
  const assigned = new Set(
    desks.map((d) => d.agentId).filter((id): id is string => Boolean(id)),
  );
  for (const agentId of agentIds)
    if (!assigned.has(agentId)) {
      const d = defaultByAgent.get(agentId);
      if (d) desks.push(cloneDesk(d));
    }
  if (
    ceoId &&
    current.has(ceoId) &&
    !desks.some((d) => d.agentId === ceoId && d.isExecutive)
  ) {
    const ceo = defaultByAgent.get(ceoId);
    if (ceo) desks.push(cloneDesk(ceo));
  }
  return {
    version: 1,
    furniture: raw.furniture.filter(isFurniture).map(cloneFurniture),
    desks,
  };
}

export function layoutToWorkstations(
  layout: OfficeLayout,
  agentIds: string[],
  ceoId?: string | null,
): Workstation[] {
  const normalized = normalizeOfficeLayout(layout, agentIds, ceoId);
  const current = new Set(agentIds);
  return normalized.desks
    .filter((d) => d.agentId && current.has(d.agentId))
    .map((d) => deskToWorkstation(d));
}
