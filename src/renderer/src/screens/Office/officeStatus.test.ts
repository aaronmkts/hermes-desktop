/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { officeStatusToAgents } from "./officeStatus";
import type { OfficeStatus } from "../../../../main/office-status";

const status = (profile: any): OfficeStatus => ({
  source: "local",
  generatedAt: 1,
  activeProfile: "a",
  build: {
    isOrionPatchedBuild: true,
    manualUpdates: false,
    label: "ORION build",
    detail: "ok",
  },
  gateway: {
    running: true,
    connectedPlatforms: 0,
    errorPlatforms: 0,
    configuredPlatforms: 0,
  },
  providers: { codexConfigured: false, honchoConfigured: false },
  profiles: [profile],
  system: { warningCount: 0, warnings: [] },
});

describe("officeStatusToAgents kanban cards", () => {
  it("carries kanbanCards through to OfficeAgent", () => {
    const cards = [{ id: "t1", title: "Task", status: "running" }];
    expect(
      officeStatusToAgents(
        status({
          id: "a",
          displayName: "Alice",
          state: "active",
          stateReason: "x",
          gatewayRunning: true,
          kanban: { running: 1 },
          platforms: {},
          kanbanCards: cards,
        }),
      )[0].kanbanCards,
    ).toEqual(cards);
  });
  it("defaults kanbanCards to [] for older payloads", () => {
    expect(
      officeStatusToAgents(
        status({
          id: "a",
          displayName: "Alice",
          state: "idle",
          stateReason: "x",
          gatewayRunning: true,
          kanban: {},
          platforms: {},
        }),
      )[0].kanbanCards,
    ).toEqual([]);
  });
});
