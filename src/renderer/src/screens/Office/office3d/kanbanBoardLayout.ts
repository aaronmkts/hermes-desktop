import type { OfficeBoardColumnId } from "./kanbanBoard";

export const BOARD_COLUMN_ORDER: OfficeBoardColumnId[] = [
  "todo",
  "ready",
  "running",
  "blocked",
  "done",
];
export const BOARD_WIDTH = 12;
export const BOARD_HEIGHT = 4.4;
export const BOARD_Y = 2.7;
export const BOARD_Z = -8.6;
export const CARD_WIDTH = 2.05;
export const CARD_HEIGHT = 0.38;
export const CARD_GAP_Y = 0.12;
export const COLUMN_GAP = 0.25;
const COLUMN_WIDTH = BOARD_WIDTH / BOARD_COLUMN_ORDER.length;
const LEFT = -BOARD_WIDTH / 2;
export const BOARD_BOUNDS = {
  minX: LEFT,
  maxX: -LEFT,
  minY: BOARD_Y - BOARD_HEIGHT / 2,
  maxY: BOARD_Y + BOARD_HEIGHT / 2,
  minZ: BOARD_Z - 0.08,
  maxZ: BOARD_Z,
};
export interface BoardTransform {
  x: number;
  y: number;
  z: number;
}
export function getBoardColumnAnchor(columnIndex: number): BoardTransform {
  return {
    x: LEFT + COLUMN_WIDTH * columnIndex + COLUMN_WIDTH / 2,
    y: BOARD_Y + BOARD_HEIGHT / 2 - 0.45,
    z: BOARD_Z - 0.06,
  };
}
export function getBoardCardTransform(
  columnIndex: number,
  cardIndex: number,
): BoardTransform {
  const a = getBoardColumnAnchor(columnIndex);
  return {
    x: a.x,
    y: a.y - 0.55 - cardIndex * (CARD_HEIGHT + CARD_GAP_Y),
    z: BOARD_Z - 0.11,
  };
}
export function getBoardColumnWidth(): number {
  return COLUMN_WIDTH - COLUMN_GAP;
}
