import { describe, expect, it } from "vitest";
import {
  officeStatusToAgents,
  buildOperatorCards,
} from "../src/renderer/src/screens/Office/officeStatus";
import type { OfficeStatus } from "../src/main/office-status";

const baseStatus: OfficeStatus = {
  source: "ssh",
  generatedAt: 1_700_000_000_000,
  activeProfile: "default",
  build: { isOrionPatchedBuild: true, manualUpdates: true, label: "ORION build", detail: "Manual fork updates", upstreamVersion: "1.2.3" },
  gateway: { running: true, connectedPlatforms: 2, errorPlatforms: 1, configuredPlatforms: 4 },
  providers: { codexConfigured: true, codexSource: "env", honchoConfigured: false, honchoSource: "missing" },
  profiles: [
    { id: "default", displayName: "ORION Prime", description: "Primary operator", personality: "Direct", model: "gpt-5.5", provider: "openai", gatewayRunning: true, state: "active", stateReason: "Recent session activity", activeSessionId: "s1", recentSessionCount: 1, recentMessageCount: 4, lastInteractionAt: 1_699_999_990_000, kanban: { todo: 2, ready: 1, running: 1, blocked: 0, doneRecent: 3 }, platforms: { connected: 2, error: 0, configured: 3 } },
    { id: "ops_bot", displayName: "Ops Bot", gatewayRunning: false, state: "waiting", stateReason: "Blocked task needs attention", recentSessionCount: 0, recentMessageCount: 0, lastInteractionAt: null, kanban: { todo: 0, ready: 0, running: 0, blocked: 2, doneRecent: 0 }, platforms: { connected: 0, error: 0, configured: 0 } },
  ],
  system: { warningCount: 1, warnings: ["Kanban unavailable"] },
};

describe("officeStatusToAgents", () => {
  it("maps OfficeStatus profile states into OfficeAgent activity states without losing metadata", () => {
    const agents = officeStatusToAgents(baseStatus);
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatchObject({ id: "default", name: "ORION Prime", subtitle: "gpt-5.5", status: "active", stateReason: "Recent session activity", gatewayRunning: true, recentSessionCount: 1, recentMessageCount: 4, kanban: { running: 1, doneRecent: 3 }, platforms: { connected: 2, configured: 3 } });
    expect(agents[1]).toMatchObject({ id: "ops_bot", name: "Ops Bot", status: "waiting", stateReason: "Blocked task needs attention", gatewayRunning: false });
  });

  it("tolerates partial status payloads and defaults missing profile fields", () => {
    const agents = officeStatusToAgents({ ...baseStatus, profiles: [{ id: "partial" } as never] });
    expect(agents[0]).toMatchObject({ id: "partial", name: "partial", status: "idle", gatewayRunning: false, recentSessionCount: 0, recentMessageCount: 0, kanban: { todo: 0, ready: 0, running: 0, blocked: 0, doneRecent: 0 }, platforms: { connected: 0, error: 0, configured: 0 } });
  });
});

describe("buildOperatorCards", () => {
  it("summarizes build, gateway, providers, memory, platforms, active work, and kanban from OfficeStatus", () => {
    const labels = buildOperatorCards(baseStatus).map((card) => card.label);
    expect(labels).toEqual(["ORION build", "Remote gateway", "Active work", "Provider auth", "Honcho memory", "Platform health", "Kanban tasks"]);
    const values = Object.fromEntries(buildOperatorCards(baseStatus).map((card) => [card.label, card.value]));
    expect(values["Remote gateway"]).toBe("Running · 2/4 connected · 1 needs attention");
    expect(values["Active work"]).toBe("1 active · 1 waiting");
    expect(values["Provider auth"]).toBe("Codex signed in via env");
    expect(values["Honcho memory"]).toBe("Not detected");
    expect(values["Platform health"]).toBe("2 connected · 1 needs attention · 4 configured");
    expect(values["Kanban tasks"]).toBe("1 running · 2 blocked · 3 done today");
  });

  it("returns safe placeholder cards before OfficeStatus loads", () => {
    expect(buildOperatorCards(null).map((card) => card.value)).toEqual(["Loading…", "Loading…", "Loading…", "Loading…", "Loading…", "Loading…", "Loading…"]);
  });
});
