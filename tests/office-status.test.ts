import { describe, expect, it } from "vitest";
import {
  getOfficeStatus,
  reduceOfficeAgentState,
  resolveOfficeProfileMetadata,
  type OfficeStatusDependencies,
} from "../src/main/office-status";

const now = 1_700_000_000_000;

describe("reduceOfficeAgentState", () => {
  it("maps gateway running with no activity to available", () => {
    expect(reduceOfficeAgentState({ gatewayRunning: true, now, lastInteractionAt: null })).toEqual({ state: "available", stateReason: "Gateway online and ready" });
  });
  it("maps a recent message within threshold to active", () => {
    expect(reduceOfficeAgentState({ gatewayRunning: true, now, lastInteractionAt: now - 60_000 }).state).toBe("active");
  });
  it("maps a running Kanban task to active", () => {
    expect(reduceOfficeAgentState({ gatewayRunning: false, now, lastInteractionAt: null, kanban: { todo: 0, ready: 0, running: 1, blocked: 0, doneRecent: 0 } }).state).toBe("active");
  });
  it("maps platform errors to error", () => {
    expect(reduceOfficeAgentState({ gatewayRunning: true, now, lastInteractionAt: null, platformErrors: 1 }).state).toBe("error");
  });
  it("keeps the agent available when connected platforms exist despite optional platform errors", () => {
    expect(
      reduceOfficeAgentState({
        gatewayRunning: true,
        now,
        lastInteractionAt: null,
        platformErrors: 2,
        connectedPlatforms: 2,
      }),
    ).toEqual({ state: "available", stateReason: "Gateway online with 2 connected platforms" });
  });
  it("maps blocked tasks to waiting", () => {
    expect(reduceOfficeAgentState({ gatewayRunning: true, now, lastInteractionAt: null, kanban: { todo: 0, ready: 0, running: 0, blocked: 2, doneRecent: 0 } }).state).toBe("waiting");
  });
  it("maps no gateway and no errors to idle", () => {
    expect(reduceOfficeAgentState({ gatewayRunning: false, now, lastInteractionAt: null })).toEqual({ state: "idle", stateReason: "Gateway is not running" });
  });
});

describe("resolveOfficeProfileMetadata", () => {
  it("uses display_name before display.name", () => {
    expect(resolveOfficeProfileMetadata("quantum_research", { display_name: "Quantum Lab", display: { name: "Other" } }).displayName).toBe("Quantum Lab");
  });
  it("prettifies internal keys without changing ids", () => {
    expect(resolveOfficeProfileMetadata("quantum_research", {}).displayName).toBe("Quantum Research");
  });
  it("resolves description and personality from display metadata", () => {
    expect(resolveOfficeProfileMetadata("ops", { display: { description: "Runs ops", personality: "Calm" } })).toMatchObject({ description: "Runs ops", personality: "Calm" });
  });
});

describe("getOfficeStatus", () => {
  it("aggregates SSH-aware source state without exposing secrets", async () => {
    const deps: OfficeStatusDependencies = {
      now: () => now,
      getConnectionConfig: () => ({ mode: "ssh", ssh: { host: "vps", username: "orion", privateKeyPath: "/secret/key" } }),
      getBuildStatus: () => ({ isOrionPatchedBuild: true, manualUpdates: true, label: "ORION build", detail: "manual", upstreamVersion: null }),
      listProfiles: async () => [{ name: "default", isActive: true, model: "gpt-5", provider: "openai", gatewayRunning: true, display_name: "ORION" }],
      gatewayStatus: async () => true,
      readPlatformStates: async () => ({ telegram: { configured: true, connected: true } }),
      getProviderCredentialStatus: async (provider) => ({ provider, configured: provider === "openai-codex", source: provider === "openai-codex" ? "env" : "missing", locationLabel: "masked" }),
      listSessions: async () => [{ id: "s1", updatedAt: now - 30_000, messageCount: 2 }],
      listKanbanTasks: async () => [{ status: "running" }, { status: "blocked" }],
    };
    const status = await getOfficeStatus(undefined, deps);
    expect(status.source).toBe("ssh");
    expect(JSON.stringify(status)).not.toContain("/secret/key");
    expect(status.activeProfile).toBe("default");
    expect(status.gateway).toMatchObject({ running: true, connectedPlatforms: 1, configuredPlatforms: 1 });
    expect(status.providers).toMatchObject({ codexConfigured: true, honchoConfigured: false });
    expect(status.profiles[0]).toMatchObject({ id: "default", displayName: "ORION", state: "active", activeSessionId: "s1", recentSessionCount: 1, recentMessageCount: 2, kanban: { running: 1, blocked: 1 } });
  });
});
