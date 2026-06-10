export const OFFICE_LAYOUT_SCHEMA_VERSION = 1;
export const OFFICE_CANVAS_SIZE = { width: 1800, height: 1800 } as const;

export type OfficeFurnitureType =
  | "desk"
  | "executiveDesk"
  | "chair"
  | "couch"
  | "sofaChair"
  | "beanbag"
  | "plant"
  | "whitePot"
  | "computer"
  | "pantry";

export interface OfficePoint {
  x: number;
  y: number;
}
export interface OfficeSeat extends OfficePoint {
  facing: number;
}
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

const DIVIDER_X = 1180;
const DOOR_Y_MIN = 820;
const DOOR_Y_MAX = 1000;
const WALL_TOP = 120;
const WALL_BOTTOM = 1680;
const PARTITION_THICKNESS = 16;
const COLS = 5;
const ORIGIN_X = 145;
const ORIGIN_Y = 300;
const SPACING_X = 210;
const SPACING_Y = 240;
const DESK_W = 100;
const CHAIR_FOOTPRINT = 24;
const CEO_DESK_X = 470;
const CEO_DESK_Y = 1180;
const CEO_SEAT_BACK = 30;
const REST_CENTER_X = 1435;
const REST_CENTER_Y = 760;
const BEANBAG_CENTERS: Array<[number, number]> = [
  [1300, 400],
  [1560, 400],
  [1300, 820],
  [1560, 820],
  [1300, 1240],
  [1560, 1240],
];
const BEANBAG_TINTS = [
  "#5a4870",
  "#3d5575",
  "#6b4f3a",
  "#4a5568",
  "#7b341e",
  "#2d6048",
];
const ALLOWED_FURNITURE_TYPES = new Set<OfficeFurnitureType>([
  "desk",
  "executiveDesk",
  "chair",
  "couch",
  "sofaChair",
  "beanbag",
  "plant",
  "whitePot",
  "computer",
  "pantry",
]);
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function facingToCenter(x: number, y: number): number {
  return Math.atan2(REST_CENTER_X - x, REST_CENTER_Y - y);
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function clamp(
  value: unknown,
  min = 0,
  max = OFFICE_CANVAS_SIZE.width,
): number {
  return Math.min(max, Math.max(min, finite(value)));
}
function normalizeDeg(value: unknown): number {
  const n = finite(value);
  return n >= 0 && n < 360 ? n : ((n % 360) + 360) % 360;
}
function normalizeRad(value: unknown): number {
  const n = finite(value);
  if (n >= -Math.PI && n <= Math.PI) return n;
  const twoPi = Math.PI * 2;
  return ((((n + Math.PI) % twoPi) + twoPi) % twoPi) - Math.PI;
}
function idOf(item: Record<string, unknown>): string | null {
  return typeof item.id === "string" && item.id.trim() ? item.id : null;
}

function defaultEmployeeWorkstation(index: number): OfficeWorkstation {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  const deskX = ORIGIN_X + col * SPACING_X;
  const deskY = ORIGIN_Y + row * SPACING_Y;
  const seatX = deskX + DESK_W / 2 - 10;
  const seatY = deskY - 20 - 16;
  return {
    id: `desk-${index}`,
    deskX,
    deskY,
    deskFacingDeg: 0,
    chairX: seatX - CHAIR_FOOTPRINT / 2,
    chairY: seatY - CHAIR_FOOTPRINT / 2,
    chairFacingDeg: 0,
    seatX,
    seatY,
    seatFacing: 0,
  };
}

function defaultCeoWorkstation(): OfficeWorkstation {
  const seatX = CEO_DESK_X;
  const seatY = CEO_DESK_Y - CEO_SEAT_BACK;
  const seatFacing = Math.atan2(CEO_DESK_X - seatX, CEO_DESK_Y - seatY);
  return {
    id: "desk-ceo",
    deskX: CEO_DESK_X,
    deskY: CEO_DESK_Y,
    deskFacingDeg: 180,
    chairX: seatX - CHAIR_FOOTPRINT / 2,
    chairY: seatY - CHAIR_FOOTPRINT / 2,
    chairFacingDeg: (seatFacing * 180) / Math.PI,
    seatX,
    seatY,
    seatFacing,
    isExecutive: true,
  };
}

export function createDefaultOfficeLayout(): OfficeLayout {
  return {
    schemaVersion: OFFICE_LAYOUT_SCHEMA_VERSION,
    canvas: OFFICE_CANVAS_SIZE,
    divider: { x: DIVIDER_X, doorYMin: DOOR_Y_MIN, doorYMax: DOOR_Y_MAX },
    walls: [
      {
        id: "partition-top",
        x: DIVIDER_X - PARTITION_THICKNESS / 2,
        y: WALL_TOP,
        w: PARTITION_THICKNESS,
        h: DOOR_Y_MIN - WALL_TOP,
      },
      {
        id: "partition-bottom",
        x: DIVIDER_X - PARTITION_THICKNESS / 2,
        y: DOOR_Y_MAX,
        w: PARTITION_THICKNESS,
        h: WALL_BOTTOM - DOOR_Y_MAX,
      },
    ],
    workstations: Array.from({ length: 24 }, (_, i) =>
      defaultEmployeeWorkstation(i),
    ).concat(defaultCeoWorkstation()),
    restSeats: BEANBAG_CENTERS.map(([x, y]) => ({
      x,
      y,
      facing: facingToCenter(x, y),
    })),
    restFurniture: [
      ...BEANBAG_CENTERS.map(([x, y], i) => ({
        id: `beanbag-${i}`,
        type: "beanbag" as const,
        x,
        y,
        facingDeg: (facingToCenter(x, y) * 180) / Math.PI,
        tint: BEANBAG_TINTS[i % BEANBAG_TINTS.length],
      })),
      { id: "rest-couch", type: "couch", x: 1320, y: 1520, facingDeg: 0 },
      { id: "rest-pantry", type: "pantry", x: 1660, y: 1760, facingDeg: 30 },
      { id: "rest-plant-1", type: "whitePot", x: 1520, y: 180, facingDeg: 0 },
      { id: "rest-plant-2", type: "whitePot", x: 1230, y: 180, facingDeg: 0 },
    ],
    executiveDecor: [
      {
        id: "ceo-couch",
        type: "couch",
        x: CEO_DESK_X - 30,
        y: CEO_DESK_Y + 100,
        facingDeg: 180,
        tint: "#2f3a4a",
      },
      {
        id: "ceo-whitepot-left",
        type: "whitePot",
        x: CEO_DESK_X - 75,
        y: CEO_DESK_Y + 180,
        facingDeg: 0,
      },
      {
        id: "ceo-whitepot-right",
        type: "whitePot",
        x: CEO_DESK_X + 155,
        y: CEO_DESK_Y + 180,
        facingDeg: 0,
      },
    ],
  };
}

function normalizeWalls(
  value: unknown,
  defaults: OfficeWallSegment[],
): OfficeWallSegment[] {
  if (!Array.isArray(value)) return clone(defaults);
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = idOf(item);
    if (!id) return [];
    return [
      {
        id,
        x: clamp(item.x),
        y: clamp(item.y),
        w: clamp(item.w),
        h: clamp(item.h),
      },
    ];
  });
}
function normalizeSeats(value: unknown, defaults: OfficeSeat[]): OfficeSeat[] {
  if (!Array.isArray(value)) return clone(defaults);
  return value.flatMap((item) =>
    isRecord(item)
      ? [
          {
            x: clamp(item.x),
            y: clamp(item.y),
            facing: normalizeRad(item.facing),
          },
        ]
      : [],
  );
}
function normalizeFurniture(
  value: unknown,
  defaults: OfficeFurniturePlacement[],
): OfficeFurniturePlacement[] {
  if (!Array.isArray(value)) return clone(defaults);
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = idOf(item);
    if (!id) return [];
    const type = item.type as OfficeFurnitureType;
    if (!ALLOWED_FURNITURE_TYPES.has(type)) return [];
    const out: OfficeFurniturePlacement = {
      id,
      type,
      x: clamp(item.x),
      y: clamp(item.y),
      facingDeg: normalizeDeg(item.facingDeg),
    };
    if (item.tint === null) out.tint = null;
    else if (typeof item.tint === "string" && HEX_COLOR_RE.test(item.tint))
      out.tint = item.tint;
    return [out];
  });
}
function normalizeWorkstations(
  value: unknown,
  defaults: OfficeWorkstation[],
): OfficeWorkstation[] {
  if (!Array.isArray(value)) return clone(defaults);
  return value.flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = idOf(item);
    if (!id) return [];
    const out: OfficeWorkstation = {
      id,
      deskX: clamp(item.deskX),
      deskY: clamp(item.deskY),
      deskFacingDeg: normalizeDeg(item.deskFacingDeg),
      chairX: clamp(item.chairX),
      chairY: clamp(item.chairY),
      chairFacingDeg: normalizeDeg(item.chairFacingDeg),
      seatX: clamp(item.seatX),
      seatY: clamp(item.seatY),
      seatFacing: normalizeRad(item.seatFacing),
    };
    if (item.isExecutive === true) out.isExecutive = true;
    return [out];
  });
}

export function normalizeOfficeLayout(input: unknown): OfficeLayout {
  const defaults = createDefaultOfficeLayout();
  if (!isRecord(input) || input.schemaVersion !== OFFICE_LAYOUT_SCHEMA_VERSION)
    return defaults;
  let divider = clone(defaults.divider);
  if (isRecord(input.divider)) {
    const x = clamp(input.divider.x);
    const doorYMin = clamp(input.divider.doorYMin);
    const doorYMax = clamp(input.divider.doorYMax);
    if (doorYMin < doorYMax) divider = { x, doorYMin, doorYMax };
  }
  const layout: OfficeLayout = {
    schemaVersion: OFFICE_LAYOUT_SCHEMA_VERSION,
    canvas: OFFICE_CANVAS_SIZE,
    divider,
    walls: normalizeWalls(input.walls, defaults.walls),
    workstations: normalizeWorkstations(
      input.workstations,
      defaults.workstations,
    ),
    restSeats: normalizeSeats(input.restSeats, defaults.restSeats),
    restFurniture: normalizeFurniture(
      input.restFurniture,
      defaults.restFurniture,
    ),
    executiveDecor: normalizeFurniture(
      input.executiveDecor,
      defaults.executiveDecor,
    ),
  };
  if (typeof input.updatedAt === "string") layout.updatedAt = input.updatedAt;
  return layout;
}

export function assignOfficeLayoutWorkstations(
  layout: OfficeLayout,
  agentIds: string[],
  ceoId?: string | null,
): OfficeWorkstation[] {
  const normalized = normalizeOfficeLayout(layout);
  const hasCeo = ceoId != null && agentIds.includes(ceoId);
  const employees = hasCeo ? agentIds.filter((id) => id !== ceoId) : agentIds;
  const employeeStations = normalized.workstations.filter(
    (station) => !station.isExecutive,
  );
  const stations = employees.map((agentId, index) => {
    const physical =
      employeeStations[index] ?? defaultEmployeeWorkstation(index);
    return { ...physical, agentId };
  });
  if (hasCeo) {
    const ceoStation =
      normalized.workstations.find((station) => station.isExecutive) ??
      defaultCeoWorkstation();
    stations.push({ ...ceoStation, agentId: ceoId, isExecutive: true });
  }
  return stations;
}
