/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  getOfficeStatus,
  type OfficeStatusDependencies,
} from "./office-status";

const baseDeps = (
  tasks: unknown[] | (() => never),
): OfficeStatusDependencies => ({
  now: () => 1_700_000_000_000,
  getConnectionConfig: () => ({ mode: "local" }),
  getBuildStatus: () => ({
    isOrionPatchedBuild: true,
    manualUpdates: false,
    label: "ORION build",
    detail: "ok",
  }),
  listProfiles: () => [
    { name: "alice", display_name: "Alice" },
    { name: "bob", display_name: "Bob" },
  ],
  gatewayStatus: () => true,
  readPlatformStates: () => ({}),
  getProviderCredentialStatus: () => ({ configured: false, source: "missing" }),
  listSessions: () => [],
  listKanbanTasks: (profile?: string) => {
    if (typeof tasks === "function") tasks();
    return profile === "alice" ? (tasks as any[]) : [];
  },
});

describe("getOfficeStatus kanbanCards", () => {
  it("includes read-only kanbanCards per profile while preserving counts", async () => {
    const status = await getOfficeStatus(
      undefined,
      baseDeps([
        {
          id: "t1",
          title: "Run job",
          status: "running",
          assignee: "Alice",
          priority: 3,
          started_at: 1_699_999_999_000,
          result: "ok",
          skills: ["shell"],
        },
        {
          id: "t2",
          title: "Blocked job",
          status: "blocked",
          priority: 1,
          completed_at: 1_699_999_000_000,
        },
        {
          id: "t3",
          title: "Done job",
          status: "done",
          completed_at: 1_699_999_990_000,
        },
      ]),
    );
    expect(status.profiles[0].kanban).toMatchObject({
      running: 1,
      blocked: 1,
      doneRecent: 1,
    });
    expect(status.profiles[0].kanbanCards).toEqual([
      {
        id: "t1",
        title: "Run job",
        status: "running",
        assignee: "Alice",
        priority: 3,
        startedAt: 1_699_999_999_000,
        completedAt: null,
        result: "ok",
        skills: ["shell"],
      },
      {
        id: "t2",
        title: "Blocked job",
        status: "blocked",
        assignee: null,
        priority: 1,
        startedAt: null,
        completedAt: 1_699_999_000_000,
        result: null,
        skills: [],
      },
      {
        id: "t3",
        title: "Done job",
        status: "done",
        assignee: null,
        priority: null,
        startedAt: null,
        completedAt: 1_699_999_990_000,
        result: null,
        skills: [],
      },
    ]);
    expect(status.profiles[1].kanbanCards).toEqual([]);
  });

  it("does not leak task body or workspace path into kanbanCards", async () => {
    const status = await getOfficeStatus(
      undefined,
      baseDeps([
        {
          id: "secret",
          title: "Safe",
          status: "todo",
          body: "secret",
          workspace_path: "/tmp/secret",
          workspace_kind: "git",
        },
      ]),
    );
    expect(status.profiles[0].kanbanCards[0]).not.toHaveProperty("body");
    expect(status.profiles[0].kanbanCards[0]).not.toHaveProperty(
      "workspace_path",
    );
    expect(status.profiles[0].kanbanCards[0]).not.toHaveProperty(
      "workspace_kind",
    );
  });

  it("falls back to empty kanbanCards when listKanbanTasks fails", async () => {
    const status = await getOfficeStatus(
      undefined,
      baseDeps(() => {
        throw new Error("boom");
      }),
    );
    expect(status.profiles[0].kanbanCards).toEqual([]);
    expect(status.profiles[0].kanban).toEqual({
      todo: 0,
      ready: 0,
      running: 0,
      blocked: 0,
      doneRecent: 0,
    });
  });

  it("keeps doneRecent 24h-bounded while done cards remain visible", async () => {
    const status = await getOfficeStatus(
      undefined,
      baseDeps([
        {
          id: "recent",
          title: "Recent",
          status: "completed",
          completed_at: 1_699_999_000_000,
        },
        {
          id: "old",
          title: "Old",
          status: "done",
          completed_at: 1_699_000_000_000,
        },
      ]),
    );
    expect(status.profiles[0].kanban.doneRecent).toBe(1);
    expect(status.profiles[0].kanbanCards.map((c) => c.id)).toEqual([
      "recent",
      "old",
    ]);
  });
});
