import { describe, expect, it } from "vitest";
import {
  BOARD_COLUMN_ORDER,
  BOARD_BOUNDS,
  getBoardCardTransform,
  getBoardColumnAnchor,
} from "./kanbanBoardLayout";

describe("office kanban board layout", () => {
  it("returns one anchor per fixed column with increasing x positions", () => {
    const anchors = BOARD_COLUMN_ORDER.map((_, i) => getBoardColumnAnchor(i));
    expect(anchors).toHaveLength(5);
    expect(anchors.map((a) => a.x)).toEqual(
      [...anchors.map((a) => a.x)].sort((a, b) => a - b),
    );
  });
  it("card transforms stack downward within a column without overlap", () => {
    const first = getBoardCardTransform(1, 0);
    const second = getBoardCardTransform(1, 1);
    expect(second.y).toBeLessThan(first.y);
    expect(Math.abs(first.y - second.y)).toBeGreaterThanOrEqual(0.48);
  });
  it("layout is deterministic for repeated calls", () =>
    expect(getBoardCardTransform(2, 3)).toEqual(getBoardCardTransform(2, 3)));
  it("board bounds stay within the intended office wall area", () => {
    expect(BOARD_BOUNDS.minX).toBeGreaterThanOrEqual(-16);
    expect(BOARD_BOUNDS.maxX).toBeLessThanOrEqual(16);
    expect(BOARD_BOUNDS.maxZ).toBeLessThanOrEqual(-7);
  });
});
