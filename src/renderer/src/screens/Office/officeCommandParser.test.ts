import { describe, expect, it } from "vitest";
import { parseOfficeCommand } from "./officeCommandParser";

describe("parseOfficeCommand", () => {
  it("parses create task commands", () => {
    expect(parseOfficeCommand("create task Fix login bug")).toEqual({ kind: "createTask", title: "Fix login bug" });
    expect(parseOfficeCommand("create task Fix login bug assigned to alice")).toEqual({ kind: "createTask", title: "Fix login bug", assignee: "alice" });
    expect(parseOfficeCommand("create task Fix login bug on board desktop")).toEqual({ kind: "createTask", title: "Fix login bug", board: "desktop" });
  });
  it("parses move commands", () => {
    expect(parseOfficeCommand("move TASK-123 to ready")).toEqual({ kind: "moveTask", taskRef: "TASK-123", targetStatus: "ready" });
    expect(parseOfficeCommand("move TASK-123 to blocked because waiting on api")).toEqual({ kind: "moveTask", taskRef: "TASK-123", targetStatus: "blocked", reason: "waiting on api" });
    expect(parseOfficeCommand("mark TASK-123 done")).toEqual({ kind: "moveTask", taskRef: "TASK-123", targetStatus: "done" });
    expect(parseOfficeCommand("complete TASK-123 with result shipped")).toEqual({ kind: "moveTask", taskRef: "TASK-123", targetStatus: "done", reason: "shipped" });
    expect(parseOfficeCommand("unblock TASK-123")).toEqual({ kind: "moveTask", taskRef: "TASK-123", targetStatus: "ready" });
  });
  it("parses assignment, blocked-list, redesign, and unknown chat", () => {
    expect(parseOfficeCommand("assign TASK-123 to alice")).toEqual({ kind: "assignTask", taskRef: "TASK-123", assignee: "alice" });
    expect(parseOfficeCommand("unassign TASK-123")).toEqual({ kind: "assignTask", taskRef: "TASK-123", assignee: null });
    expect(parseOfficeCommand("show blocked tasks")).toEqual({ kind: "showBlockedTasks" });
    expect(parseOfficeCommand("show alice blocked tasks")).toEqual({ kind: "showBlockedTasks", assignee: "alice" });
    expect(parseOfficeCommand("redesign office with more desks")).toEqual({ kind: "redesignOffice", description: "with more desks" });
    expect(parseOfficeCommand("how are you?")).toEqual({ kind: "unknown", text: "how are you?" });
  });
});
