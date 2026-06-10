import { describe, expect, it } from "vitest";
import {
  assignOfficeLayoutWorkstations,
  createDefaultOfficeLayout,
  normalizeOfficeLayout,
  OFFICE_CANVAS_SIZE,
  OFFICE_LAYOUT_SCHEMA_VERSION,
} from "../src/shared/office-layout";
import {
  DIVIDER_X,
  DOOR_Y_MAX,
  DOOR_Y_MIN,
  EXECUTIVE_DECOR,
  INTERIOR_WALLS,
  REST_FURNITURE,
  REST_SEATS,
  buildWorkstations,
} from "../src/renderer/src/screens/Office/office3d/layout";

describe("office layout model", () => {
  it("creates defaults matching the native office layout", () => {
    const layout = createDefaultOfficeLayout();
    expect(layout.schemaVersion).toBe(OFFICE_LAYOUT_SCHEMA_VERSION);
    expect(layout.canvas).toEqual(OFFICE_CANVAS_SIZE);
    expect(layout.divider).toEqual({ x: 1180, doorYMin: 820, doorYMax: 1000 });
    expect(layout.walls).toHaveLength(2);
    expect(layout.walls.map((wall) => wall.id)).toEqual(["partition-top", "partition-bottom"]);
    expect(layout.restSeats).toHaveLength(6);
    expect(layout.restFurniture.map((item) => item.id)).toEqual(expect.arrayContaining(["rest-couch", "rest-pantry"]));
    expect(layout.executiveDecor.map((item) => item.id)).toContain("ceo-couch");
  });

  it("assigns employees to the grid and the CEO to the executive desk", () => {
    const assigned = assignOfficeLayoutWorkstations(createDefaultOfficeLayout(), ["ceo", "ada", "grace", "linus"], "ceo");
    expect(assigned).toMatchObject([
      { id: "desk-0", agentId: "ada", deskX: 145, deskY: 300 },
      { id: "desk-1", agentId: "grace", deskX: 355, deskY: 300 },
      { id: "desk-2", agentId: "linus", deskX: 565, deskY: 300 },
      { id: "desk-ceo", agentId: "ceo", deskX: 470, deskY: 1180, isExecutive: true },
    ]);
  });

  it("normalizes missing or malformed layout to defaults", () => {
    expect(normalizeOfficeLayout(undefined)).toEqual(createDefaultOfficeLayout());
    expect(normalizeOfficeLayout({ schemaVersion: 2 })).toEqual(createDefaultOfficeLayout());
  });

  it("clamps coordinates, dimensions and facing values", () => {
    const layout = normalizeOfficeLayout({
      ...createDefaultOfficeLayout(),
      divider: { x: -20, doorYMin: 200, doorYMax: 190 },
      walls: [{ id: "wall", x: -1, y: 1900, w: 9999, h: -4 }],
      restSeats: [{ x: 9999, y: -20, facing: 99 }],
      workstations: [{ id: "station", deskX: -10, deskY: 2000, deskFacingDeg: 725, chairX: -2, chairY: 1901, chairFacingDeg: -90, seatX: 1902, seatY: -3, seatFacing: 99 }],
    });
    expect(layout.divider).toEqual(createDefaultOfficeLayout().divider);
    expect(layout.walls[0]).toMatchObject({ x: 0, y: 1800, w: 1800, h: 0 });
    expect(layout.restSeats[0].x).toBe(1800);
    expect(layout.restSeats[0].y).toBe(0);
    expect(layout.restSeats[0].facing).toBeGreaterThanOrEqual(-Math.PI);
    expect(layout.restSeats[0].facing).toBeLessThanOrEqual(Math.PI);
    expect(layout.workstations[0]).toMatchObject({ deskX: 0, deskY: 1800, deskFacingDeg: 5, chairX: 0, chairY: 1800, chairFacingDeg: 270, seatX: 1800, seatY: 0 });
  });

  it("drops unknown furniture types, missing IDs and invalid tints", () => {
    const layout = normalizeOfficeLayout({
      ...createDefaultOfficeLayout(),
      restFurniture: [
        { id: "", type: "couch", x: 1, y: 2, facingDeg: 3 },
        { id: "alien", type: "spaceship", x: 1, y: 2, facingDeg: 3 },
        { id: "bad-tint", type: "couch", x: 1, y: 2, facingDeg: 3, tint: "red" },
        { id: "null-tint", type: "plant", x: 1, y: 2, facingDeg: 3, tint: null },
      ],
    });
    expect(layout.restFurniture.map((item) => item.id)).toEqual(["bad-tint", "null-tint"]);
    expect(layout.restFurniture[0]).not.toHaveProperty("tint");
    expect(layout.restFurniture[1].tint).toBeNull();
  });

  it("fills missing arrays from defaults", () => {
    const { walls, restSeats, restFurniture, executiveDecor, workstations, ...partial } = createDefaultOfficeLayout();
    const layout = normalizeOfficeLayout(partial);
    expect(layout.walls).toEqual(walls);
    expect(layout.restSeats).toEqual(restSeats);
    expect(layout.restFurniture).toEqual(restFurniture);
    expect(layout.executiveDecor).toEqual(executiveDecor);
    expect(layout.workstations).toEqual(workstations);
  });
});

describe("renderer layout compatibility", () => {
  it("exports legacy constants from the shared default layout", () => {
    const layout = createDefaultOfficeLayout();
    expect(DIVIDER_X).toBe(layout.divider.x);
    expect(DOOR_Y_MIN).toBe(layout.divider.doorYMin);
    expect(DOOR_Y_MAX).toBe(layout.divider.doorYMax);
    expect(INTERIOR_WALLS).toEqual(layout.walls);
    expect(REST_SEATS).toEqual(layout.restSeats);
    expect(REST_FURNITURE).toEqual(layout.restFurniture);
    expect(EXECUTIVE_DECOR).toEqual(layout.executiveDecor);
  });
  it("keeps buildWorkstations behavior stable", () => {
    expect(buildWorkstations(["ceo", "ada"], "ceo")).toEqual(assignOfficeLayoutWorkstations(createDefaultOfficeLayout(), ["ceo", "ada"], "ceo"));
  });
});
