import { describe, expect, it } from "vitest";
import { buildDefaultOfficeLayout, moveLayoutItem } from "./layoutModel";
import { getOffice3DLayoutRenderState } from "./office3dLayoutAdapter";

describe("office3d layout adapter", () => {
  it("uses default layout when no custom layout is provided", () => {
    const state = getOffice3DLayoutRenderState({
      agentIds: ["a"],
      ceoId: null,
    });
    expect(state.workstations.map((w) => w.agentId)).toEqual(["a"]);
    expect(state.furniture.some((p) => p.id === "beanbag-0")).toBe(true);
  });
  it("uses custom layout and edit metadata", () => {
    const layout = moveLayoutItem(
      buildDefaultOfficeLayout(["a"], null),
      "furniture:beanbag-0",
      10,
      0,
    );
    const state = getOffice3DLayoutRenderState({
      agentIds: ["a"],
      ceoId: null,
      layout,
      editMode: true,
      selectedLayoutItemId: "desk:desk-0",
    });
    expect(state.furniture[0].x).toBe(1310);
    expect(state.furnitureEditItems[0]).toMatchObject({
      itemId: "furniture:beanbag-0",
      selected: false,
    });
    expect(state.deskEditItems[0]).toMatchObject({
      itemId: "desk:desk-0",
      selected: true,
    });
  });
});
