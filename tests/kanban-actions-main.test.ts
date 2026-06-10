import { beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "child_process";

vi.mock("../src/main/hermes", () => ({ isRemoteOnlyMode: () => false }));
vi.mock("../src/main/config", () => ({
  getConnectionConfig: () => ({ mode: "local" }),
}));
vi.mock("../src/main/ssh-remote", () => ({
  sshRunKanban: vi.fn(),
  sshListClaw3dHqTasks: vi.fn(),
}));
vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-home",
  HERMES_PYTHON: "/tmp/python",
  hermesCliArgs: () => ["-m", "hermes"],
  getEnhancedPath: () => "/tmp/bin",
}));
vi.mock("child_process", () => {
  const execFile = vi.fn();
  return { default: { execFile }, execFile };
});

import {
  archiveTask,
  assignTask,
  blockTask,
  commentTask,
  completeTask,
  createTask,
  reclaimTask,
  specifyTask,
  unblockTask,
} from "../src/main/kanban";

const execFileMock = vi.mocked(execFile);
const lastArgs = (): string[] =>
  execFileMock.mock.calls.at(-1)?.[1] as string[];

beforeEach(() => {
  execFileMock.mockReset();
  execFileMock.mockImplementation(((_file, args, _opts, cb) => {
    const stdout =
      Array.isArray(args) && args.includes("--json")
        ? JSON.stringify({ id: "created-1" })
        : "";
    cb?.(null, stdout, "");
    return {} as never;
  }) as never);
});

describe("Kanban backend mutation actions", () => {
  it("assigns a task to a profile-scoped assignee", async () => {
    await expect(
      assignTask("task-1", "default", "profile-a"),
    ).resolves.toMatchObject({ success: true });
    expect(lastArgs()).toEqual([
      "-m",
      "hermes",
      "-p",
      "profile-a",
      "kanban",
      "assign",
      "task-1",
      "default",
    ]);
  });
  it("maps null assignee to none", async () => {
    await assignTask("task-1", null);
    expect(lastArgs()).toEqual([
      "-m",
      "hermes",
      "kanban",
      "assign",
      "task-1",
      "none",
    ]);
  });
  it("completes a task with a result", async () => {
    await completeTask("task-1", "shipped");
    expect(lastArgs()).toEqual([
      "-m",
      "hermes",
      "kanban",
      "complete",
      "task-1",
      "--result",
      "shipped",
    ]);
  });
  it("blocks and unblocks tasks", async () => {
    await blockTask("task-1", "waiting on user");
    expect(lastArgs()).toEqual([
      "-m",
      "hermes",
      "kanban",
      "block",
      "task-1",
      "waiting on user",
    ]);
    await unblockTask("task-1");
    expect(lastArgs()).toEqual(["-m", "hermes", "kanban", "unblock", "task-1"]);
  });
  it("creates a task with expected flags and parses JSON", async () => {
    await expect(
      createTask({
        title: "Ship it",
        assignee: "default",
        priority: 2,
        workspace: "scratch",
        triage: true,
      }),
    ).resolves.toEqual({ success: true, data: { id: "created-1" } });
    expect(lastArgs()).toEqual([
      "-m",
      "hermes",
      "kanban",
      "create",
      "Ship it",
      "--assignee",
      "default",
      "--priority",
      "2",
      "--workspace",
      "scratch",
      "--triage",
      "--json",
    ]);
  });
  it.each([
    ["assign", () => assignTask("   ", "default")],
    ["complete", () => completeTask("   ")],
    ["block", () => blockTask("   ")],
    ["unblock", () => unblockTask("   ")],
    ["archive", () => archiveTask("   ")],
    ["specify", () => specifyTask("   ")],
    ["reclaim", () => reclaimTask("   ")],
    ["comment", () => commentTask("   ", "hello")],
  ])(
    "rejects blank taskId for %s without invoking the CLI",
    async (_name, action) => {
      await expect(action()).resolves.toMatchObject({ success: false });
      expect(execFileMock).not.toHaveBeenCalled();
    },
  );
  it("rejects empty comments without invoking the CLI", async () => {
    await expect(commentTask("task-1", "   ")).resolves.toMatchObject({
      success: false,
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
