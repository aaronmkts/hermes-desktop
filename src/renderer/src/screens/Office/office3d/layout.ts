/**
 * Office layout in "canvas" space (0..1800 on both axes), matching the agent
 * simulation. Compatibility exports are backed by the shared persistent layout
 * model so existing renderer callers keep today's behaviour while main/preload
 * can load and save the same canonical schema.
 */
import {
  assignOfficeLayoutWorkstations,
  createDefaultOfficeLayout,
  type OfficeFurniturePlacement,
  type OfficeFurnitureType,
  type OfficeSeat,
  type OfficeWallSegment,
  type OfficeWorkstation,
} from "../../../../../shared/office-layout";

export type FurnitureType = OfficeFurnitureType;
export type FurniturePlacement = OfficeFurniturePlacement;
export type WallSegment = OfficeWallSegment;
export type Seat = OfficeSeat;
export type Workstation = OfficeWorkstation & { agentId: string };

const DEFAULT_LAYOUT = createDefaultOfficeLayout();

// ── Partition between work area (west) and rest room (east) ────────────────
export const DIVIDER_X = DEFAULT_LAYOUT.divider.x;
// Doorway gap in the partition (agents pass through here between rooms).
export const DOOR_Y_MIN = DEFAULT_LAYOUT.divider.doorYMin;
export const DOOR_Y_MAX = DEFAULT_LAYOUT.divider.doorYMax;
export const DOOR_Y = (DOOR_Y_MIN + DOOR_Y_MAX) / 2;

const PARTITION_THICKNESS = 16;

// Compatibility constants for upstream native Office city/building layers.
// ORION keeps the shared persistent layout model as the source of truth, but
// these exports let upstream decorative/agent layers compile against the same
// public layout module.
export const CEO_OFFICE = {
  minX: 40,
  maxX: 560,
  minY: 1150,
  maxY: 1790,
  doorYMin: 1440,
  doorYMax: 1620,
};
export const CEO_DOOR_Y = (CEO_OFFICE.doorYMin + CEO_OFFICE.doorYMax) / 2;

export const GLASS_WALLS: WallSegment[] = [
  {
    id: "ceo-glass-north",
    x: CEO_OFFICE.minX,
    y: CEO_OFFICE.minY - PARTITION_THICKNESS / 2,
    w: CEO_OFFICE.maxX - CEO_OFFICE.minX,
    h: PARTITION_THICKNESS,
  },
  {
    id: "ceo-glass-east-top",
    x: CEO_OFFICE.maxX - PARTITION_THICKNESS / 2,
    y: CEO_OFFICE.minY,
    w: PARTITION_THICKNESS,
    h: CEO_OFFICE.doorYMin - CEO_OFFICE.minY,
  },
  {
    id: "ceo-glass-east-bottom",
    x: CEO_OFFICE.maxX - PARTITION_THICKNESS / 2,
    y: CEO_OFFICE.doorYMax,
    w: PARTITION_THICKNESS,
    h: CEO_OFFICE.maxY - CEO_OFFICE.doorYMax,
  },
];

export const INTERIOR_WALLS: WallSegment[] = DEFAULT_LAYOUT.walls;

/**
 * One desk per agent. Employees fill a grid; the CEO (if any) gets a separate
 * executive desk and is removed from the grid so it doesn't leave a gap.
 */
export function buildWorkstations(agentIds: string[], ceoId?: string | null): Workstation[] {
  return assignOfficeLayoutWorkstations(DEFAULT_LAYOUT, agentIds, ceoId) as Workstation[];
}

/**
 * Decorative furniture framing the CEO's private office, rendered only when a
 * CEO exists. A visitor couch sits in front of (south of) the desk facing it,
 * flanked by plants — turning the front-centre zone into a small lounge.
 */
export const EXECUTIVE_DECOR: FurniturePlacement[] = DEFAULT_LAYOUT.executiveDecor;

/** Seats agents sit on while resting (one per beanbag). */
export const REST_SEATS: Seat[] = DEFAULT_LAYOUT.restSeats;

/** All rest-room furniture: a beanbag per seat plus decorative couch + plant. */
export const REST_FURNITURE: FurniturePlacement[] = DEFAULT_LAYOUT.restFurniture;
