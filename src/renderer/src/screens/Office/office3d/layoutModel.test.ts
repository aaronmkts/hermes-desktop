import { describe, expect, it } from "vitest";
import { EXECUTIVE_DECOR, REST_FURNITURE } from "./layout";
import {
  assignDesk,
  buildDefaultOfficeLayout,
  layoutToWorkstations,
  moveLayoutItem,
  normalizeOfficeLayout,
  rotateLayoutItem,
} from "./layoutModel";

describe("office layout model", () => {
  it("builds a versioned default layout from generated desks and furniture", () => {
    const layout = buildDefaultOfficeLayout(["a", "boss"], "boss");
    expect(layout.schemaVersion).toBe(1);
    expect(layout.workstations.map((d) => d.agentId)).toEqual(["a", "boss"]);
    expect([...layout.restFurniture, ...layout.executiveDecor].map((p) => p.id)).toEqual(
      [...REST_FURNITURE, ...EXECUTIVE_DECOR].map((p) => p.id),
    );
    expect(
      buildDefaultOfficeLayout(["a"], null).restFurniture.map((p) => p.id),
    ).toEqual(REST_FURNITURE.map((p) => p.id));
  });

  it("moves furniture and desks immutably while clamping to canvas bounds", () => {
    const layout = buildDefaultOfficeLayout(["a"], null);
    const movedFurniture = moveLayoutItem(
      layout,
      "furniture:beanbag-0",
      -9999,
      25,
    );
    expect(movedFurniture).not.toBe(layout);
    expect(layout.restFurniture[0].x).toBe(1300);
    expect(movedFurniture.restFurniture[0]).toMatchObject({ x: 0, y: 425 });
    const movedDesk = moveLayoutItem(layout, "desk:desk-0", 10, 20);
    expect(movedDesk.workstations[0].deskX).toBe(layout.workstations[0].deskX + 10);
    expect(movedDesk.workstations[0].chairY).toBe(layout.workstations[0].chairY + 20);
    expect(movedDesk.workstations[0].seatY).toBe(layout.workstations[0].seatY + 20);
  });

  it("rotates furniture in 15 degree increments and desks without losing seat facing", () => {
    const layout = buildDefaultOfficeLayout(["a"], null);
    expect(
      rotateLayoutItem(layout, "furniture:beanbag-0", 17).restFurniture[0]
        .facingDeg % 15,
    ).toBe(0);
    const rotated = rotateLayoutItem(layout, "desk:desk-0", -15);
    expect(rotated.workstations[0].deskFacingDeg).toBe(345);
    expect(rotated.workstations[0].chairFacingDeg).toBe(345);
    expect(rotated.workstations[0].seatFacing).toBe(layout.workstations[0].seatFacing);
  });

  it("assigns an agent to exactly one desk and supports unassignment immutably", () => {
    const layout = buildDefaultOfficeLayout(["a", "b"], null);
    const assigned = assignDesk(layout, "desk-1", "a");
    expect(assigned).not.toBe(layout);
    expect(assigned.workstations.map((d) => d.agentId)).toEqual([null, "a"]);
    expect(assignDesk(assigned, "desk-1", null).workstations[1].agentId).toBeNull();
  });

  it("normalizes persisted layouts, drops invalid furniture, and appends missing agent desks", () => {
    const base = buildDefaultOfficeLayout(["a"], null);
    const input = {
      ...base,
      restFurniture: [
        ...base.restFurniture,
        { id: "bad", type: "spaceship", x: 1, y: 2, facingDeg: 3 },
      ],
    };
    const normalized = normalizeOfficeLayout(input, ["a", "b"], null);
    expect(normalized.restFurniture.some((p) => p.id === "bad")).toBe(false);
    expect(normalized.workstations.some((d) => d.agentId === "b")).toBe(true);
    expect(normalizeOfficeLayout({ nope: true }, ["a"], null)).toEqual(
      buildDefaultOfficeLayout(["a"], null),
    );
  });

  it("converts layouts to workstations for current agents only and adds new agents", () => {
    const layout = buildDefaultOfficeLayout(["a", "removed"], null);
    const stations = layoutToWorkstations(layout, ["a", "new"], null);
    expect(stations.map((s) => s.agentId).sort()).toEqual(["a", "new"]);
    expect(stations.some((s) => s.agentId === "removed")).toBe(false);
  });
});
