import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const office3dFiles = [
  "src/renderer/src/screens/Office/office3d/kanbanBoard.ts",
  "src/renderer/src/screens/Office/office3d/kanbanBoardLayout.ts",
  "src/renderer/src/screens/Office/office3d/objects/KanbanBoard3D.tsx",
];

describe("Office 3D Kanban read-only guard", () => {
  it("does not import or reference mutation APIs", () => {
    const forbidden =
      /screens\/Kanban\/Kanban|moveTask|handleMove|handleDrop|\barchive\b|\bassign\b|\bunblock\b|\bspecify\b|\bcomment\b|window\.hermesAPI\.[A-Za-z]*Kanban/i;
    for (const file of office3dFiles) {
      const source = readFileSync(resolve(file), "utf8");
      expect(source, file).not.toMatch(forbidden);
    }
  });
});
