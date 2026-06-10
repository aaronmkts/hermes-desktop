import { describe, expect, it } from "vitest";
import {
  buildKanbanTaskActions,
  isValidKanbanTransition,
  requiresKanbanConfirmation,
  type KanbanTaskActionTask,
} from "../src/renderer/src/screens/Kanban/kanbanActions";

const task = (
  status: string,
  assignee: string | null = null,
): KanbanTaskActionTask => ({
  id: "task-1",
  status,
  assignee,
});

describe("Kanban renderer action model", () => {
  it("allows only explicit safe status transitions", () => {
    expect(isValidKanbanTransition("todo", "blocked")).toBe(true);
    expect(isValidKanbanTransition("ready", "blocked")).toBe(true);
    expect(isValidKanbanTransition("running", "blocked")).toBe(true);
    expect(isValidKanbanTransition("blocked", "ready")).toBe(true);
    expect(isValidKanbanTransition("todo", "done")).toBe(true);
    expect(isValidKanbanTransition("todo", "running")).toBe(false);
    expect(isValidKanbanTransition("done", "ready")).toBe(false);
    expect(isValidKanbanTransition("blocked", "running")).toBe(false);
    expect(isValidKanbanTransition("ready", "ready")).toBe(false);
  });

  it("marks complete and archive as confirmation-required mutations", () => {
    expect(requiresKanbanConfirmation("complete")).toBe(true);
    expect(requiresKanbanConfirmation("archive")).toBe(true);
    expect(requiresKanbanConfirmation("assign")).toBe(false);
    expect(requiresKanbanConfirmation("block")).toBe(false);
    expect(requiresKanbanConfirmation("unblock")).toBe(false);
    expect(requiresKanbanConfirmation("create")).toBe(false);
  });

  it("disables all mutations on the HQ virtual board", () => {
    const actions = buildKanbanTaskActions(task("ready"), { isHqActive: true });
    expect(actions.length).toBeGreaterThan(0);
    expect(
      actions
        .filter((action) => action.kind === "mutation")
        .every((action) => action.disabled),
    ).toBe(true);
  });

  it("offers unblock and complete for blocked tasks but excludes block", () => {
    const actions = buildKanbanTaskActions(task("blocked"), {
      isHqActive: false,
    });
    expect(actions.map((action) => action.id)).toEqual(
      expect.arrayContaining(["unblock", "complete"]),
    );
    expect(actions.map((action) => action.id)).not.toContain("block");
  });

  it("offers assign to selected agent when the assignee differs", () => {
    const actions = buildKanbanTaskActions(task("ready", "other"), {
      isHqActive: false,
      selectedAgentId: "default",
    });
    expect(actions).toContainEqual(
      expect.objectContaining({
        id: "assign-selected-agent",
        mutation: "assign",
        assignee: "default",
      }),
    );
  });
});
