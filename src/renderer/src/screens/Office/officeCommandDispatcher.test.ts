import { describe, expect, it, vi } from "vitest";
import { createOfficeCommandDispatcher } from "./officeCommandDispatcher";

const agents = [
  { id: "alice", name: "Alice", status: "idle" as const, color: "#fff", item: "desk" },
  { id: "bob", name: "Bob", status: "idle" as const, color: "#fff", item: "desk" },
  { id: "ally", name: "Ally", status: "idle" as const, color: "#fff", item: "desk" },
];
const tasks = [
  { id: "TASK-123", title: "Fix login bug", body: null, assignee: null, status: "todo", priority: 0, tenant: null, workspace_kind: "repo", workspace_path: null, created_by: null, created_at: null, started_at: null, completed_at: null, result: null, skills: [], max_retries: null },
  { id: "TASK-456", title: "Fix login docs", body: null, assignee: null, status: "blocked", priority: 0, tenant: null, workspace_kind: "repo", workspace_path: null, created_by: null, created_at: null, started_at: null, completed_at: null, result: null, skills: [], max_retries: null },
];
function api(overrides = {}) {
  return {
    kanbanListTasks: vi.fn(async () => ({ success: true, data: tasks })),
    kanbanCreateTask: vi.fn(async () => ({ success: true, data: { id: "TASK-999" } })),
    kanbanAssignTask: vi.fn(async () => ({ success: true })),
    kanbanCompleteTask: vi.fn(async () => ({ success: true })),
    kanbanBlockTask: vi.fn(async () => ({ success: true })),
    kanbanUnblockTask: vi.fn(async () => ({ success: true })),
    ...overrides,
  };
}

describe("office command dispatcher", () => {
  it("creates tasks only with a safe assignee resolution", async () => {
    const a = api();
    const d = createOfficeCommandDispatcher({ api: a, agents, profile: "default" });
    await expect(d.dispatchOfficeCommand("create task Fix login bug assigned to Alice")).resolves.toMatchObject({ type: "handled", refreshKanban: true });
    expect(a.kanbanCreateTask).toHaveBeenCalledWith({ title: "Fix login bug", assignee: "alice" }, "default");
    await expect(d.dispatchOfficeCommand("create task Bad assigned to Al")).resolves.toMatchObject({ type: "needsClarification" });
    expect(a.kanbanCreateTask).toHaveBeenCalledTimes(1);
  });
  it("resolves task ids before substrings and clarifies ambiguous refs", async () => {
    const a = api();
    const d = createOfficeCommandDispatcher({ api: a, agents });
    await d.dispatchOfficeCommand("assign TASK-123 to bob");
    expect(a.kanbanAssignTask).toHaveBeenCalledWith("TASK-123", "bob", undefined);
    await expect(d.dispatchOfficeCommand("assign Fix login to bob")).resolves.toMatchObject({ type: "needsClarification" });
    expect(a.kanbanAssignTask).toHaveBeenCalledTimes(1);
  });
  it("blocks with reason, completes only after single-use confirmation, and cancel is safe", async () => {
    const a = api();
    const d = createOfficeCommandDispatcher({ api: a, agents });
    await expect(d.dispatchOfficeCommand("move TASK-123 to blocked")).resolves.toMatchObject({ type: "needsClarification" });
    await expect(d.dispatchOfficeCommand("move TASK-123 to blocked because waiting")).resolves.toMatchObject({ type: "handled" });
    expect(a.kanbanBlockTask).toHaveBeenCalledWith("TASK-123", "waiting", undefined);
    const pending = await d.dispatchOfficeCommand("mark TASK-123 done");
    expect(pending.type).toBe("needsConfirmation");
    expect(a.kanbanCompleteTask).not.toHaveBeenCalled();
    if (pending.type !== "needsConfirmation") throw new Error("missing confirmation");
    await expect(d.cancelOfficeCommand(pending.confirmation.id)).resolves.toMatchObject({ type: "handled" });
    expect(a.kanbanCompleteTask).not.toHaveBeenCalled();
    const pending2 = await d.dispatchOfficeCommand("complete TASK-123 with result shipped");
    if (pending2.type !== "needsConfirmation") throw new Error("missing confirmation");
    await expect(d.confirmOfficeCommand(pending2.confirmation.id)).resolves.toMatchObject({ type: "handled", refreshKanban: true });
    expect(a.kanbanCompleteTask).toHaveBeenCalledWith("TASK-123", "shipped", undefined);
    await expect(d.confirmOfficeCommand(pending2.confirmation.id)).resolves.toMatchObject({ type: "error" });
  });
  it("shows blocked tasks with navigation and handles redesign safely", async () => {
    const a = api({ kanbanListTasks: vi.fn(async (filters) => ({ success: true, data: tasks.filter((t) => !filters?.status || t.status === filters.status) })) });
    const d = createOfficeCommandDispatcher({ api: a, agents });
    await expect(d.dispatchOfficeCommand("show blocked tasks")).resolves.toMatchObject({ type: "handled", navigate: "kanban" });
    expect(a.kanbanListTasks).toHaveBeenCalledWith({ status: "blocked", profile: undefined });
    await expect(d.dispatchOfficeCommand("make the office better")).resolves.toMatchObject({ type: "needsClarification" });
    const reset = await d.dispatchOfficeCommand("reset office");
    expect(reset).toMatchObject({ type: "needsConfirmation", confirmation: { danger: true } });
  });
  it("falls back for ordinary chat", async () => {
    const d = createOfficeCommandDispatcher({ api: api(), agents });
    await expect(d.dispatchOfficeCommand("how are you?")).resolves.toEqual({ type: "fallbackToChat", text: "how are you?" });
  });
});
