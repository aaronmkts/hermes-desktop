import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const channels = [
  ["kanban-create-task", "kanbanCreateTask"],
  ["kanban-assign-task", "kanbanAssignTask"],
  ["kanban-complete-task", "kanbanCompleteTask"],
  ["kanban-block-task", "kanbanBlockTask"],
  ["kanban-unblock-task", "kanbanUnblockTask"],
  ["kanban-archive-task", "kanbanArchiveTask"],
  ["kanban-specify-task", "kanbanSpecifyTask"],
  ["kanban-reclaim-task", "kanbanReclaimTask"],
  ["kanban-comment-task", "kanbanCommentTask"],
] as const;

describe("Kanban mutation IPC/preload surface", () => {
  const main = readFileSync("src/main/index.ts", "utf8");
  const preload = readFileSync("src/preload/index.ts", "utf8");
  const dts = readFileSync("src/preload/index.d.ts", "utf8");

  it("registers every explicit mutation IPC handler", () => {
    for (const [channel] of channels) {
      expect(main).toContain(channel);
      expect(main).toContain("ipcMain.handle");
    }
  });
  it("exposes every mutation channel through preload", () => {
    for (const [channel, method] of channels) {
      expect(preload).toContain(`${method}:`);
      expect(preload).toContain(`ipcRenderer.invoke("${channel}"`);
    }
  });
  it("declares every mutation preload method", () => {
    for (const [, method] of channels) expect(dts).toContain(`${method}:`);
  });
});
