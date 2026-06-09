import { describe, expect, it } from "vitest";
import {
  buildOfficeAgentActions,
  buildOfficeAgentStatusRows,
  type OfficeActionAvailability,
} from "../src/renderer/src/screens/Office/officeActions";

const availability: OfficeActionAvailability = {
  chat: true,
  restartGateway: true,
  gateway: true,
  providers: true,
  kanban: true,
  sessions: true,
};

describe("Office agent operator actions", () => {
  it("builds selected-agent side-panel action descriptors in operator order", () => {
    const actions = buildOfficeAgentActions({ id: "default", name: "Default" }, availability);

    expect(actions.map((a) => [a.id, a.label, a.kind, a.target])).toEqual([
      ["chat", "Chat", "chat", "default"],
      ["restartGateway", "Restart remote gateway", "restartGateway", "default"],
      ["gateway", "Open Gateway", "navigate", "gateway"],
      ["providers", "Open Providers", "navigate", "providers"],
      ["kanban", "Open Kanban", "navigate", "kanban"],
      ["sessions", "Open Sessions/logs", "navigate", "sessions"],
    ]);
  });

  it("marks unavailable callbacks disabled without inventing broken routing", () => {
    const actions = buildOfficeAgentActions(
      { id: "default", name: "Default" },
      { ...availability, providers: false, sessions: false },
    );

    expect(actions.find((a) => a.id === "providers")).toMatchObject({ disabled: true });
    expect(actions.find((a) => a.id === "sessions")).toMatchObject({ disabled: true });
  });
});

describe("Office agent status detail rows", () => {
  it("surfaces state reason, last interaction, activity counts, kanban, and platform errors", () => {
    const rows = buildOfficeAgentStatusRows(
      {
        id: "default",
        name: "Default",
        status: "error",
        color: "#fff",
        item: "desk",
        stateReason: "Slack auth failed",
        lastInteractionAt: Date.UTC(2026, 5, 9, 12, 0, 0),
        recentSessionCount: 2,
        recentMessageCount: 17,
        kanban: { running: 1, blocked: 3 },
        platforms: { error: 2 },
      },
      Date.UTC(2026, 5, 9, 12, 30, 0),
    );

    expect(rows).toEqual([
      { label: "State reason", value: "Slack auth failed", severity: "error" },
      { label: "Last interaction", value: "30m ago" },
      { label: "Recent sessions", value: "2" },
      { label: "Recent messages", value: "17" },
      { label: "Running tasks", value: "1", severity: "active" },
      { label: "Blocked tasks", value: "3", severity: "warning" },
      { label: "Platform errors", value: "2", severity: "error" },
    ]);
  });

  it("omits absent OfficeStatus extension fields for current listProfiles agents", () => {
    expect(
      buildOfficeAgentStatusRows({ id: "default", name: "Default", status: "idle", color: "#fff", item: "desk" }),
    ).toEqual([]);
  });
});
