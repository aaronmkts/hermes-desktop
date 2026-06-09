import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawn: spawnMock,
  execFileSync: vi.fn(),
  default: { spawn: spawnMock, execFileSync: vi.fn() },
}));

vi.mock("../src/main/installer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/main/installer")>();
  return { ...actual, HERMES_HOME: "/tmp/hermes-test" };
});

const sshConfig = {
  host: "example.test",
  port: 22,
  username: "root",
  keyPath: "/tmp/test-key",
  remotePort: 8642,
  localPort: 18642,
};

function queueSshStdout(stdout = ""): void {
  spawnMock.mockImplementationOnce(() => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
      stdin: { end: vi.fn() },
      kill: vi.fn(),
    });
    setImmediate(() => {
      if (stdout) proc.stdout.emit("data", stdout);
      proc.emit("close", 0);
    });
    return proc;
  });
}

const invalidProfiles = ["../../../etc", "/etc", "work;touch /tmp/pwn", "bad name"];

describe("SSH profile validation", () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it("normalizes default profile aliases and accepts safe named profiles", async () => {
    const { normalizeSshProfileName, sshGetHermesHome } = await import(
      "../src/main/ssh-remote"
    );

    expect(normalizeSshProfileName()).toBeUndefined();
    expect(normalizeSshProfileName("")).toBeUndefined();
    expect(normalizeSshProfileName("default")).toBeUndefined();
    expect(normalizeSshProfileName("work_profile-1")).toBe("work_profile-1");
    expect(sshGetHermesHome(sshConfig, "work_profile-1")).toBe(
      "~/.hermes/profiles/work_profile-1",
    );
  });

  it.each(invalidProfiles)(
    "rejects invalid profiles before SSH env/config/SOUL/model/MCP/cron/skill/profile/session operations: %s",
    async (profile) => {
      const remote = await import("../src/main/ssh-remote");

      await expect(remote.sshReadEnv(sshConfig, profile)).rejects.toThrow(
        /Profile names may contain/,
      );
      await expect(
        remote.sshSetConfigValue(sshConfig, "model.provider", "openai", profile),
      ).rejects.toThrow(/Profile names may contain/);
      await expect(remote.sshWriteSoul(sshConfig, "soul", profile)).rejects.toThrow(
        /Profile names may contain/,
      );
      await expect(
        remote.sshSetModelConfig(sshConfig, "openai", "gpt-4o", "", profile),
      ).rejects.toThrow(/Profile names may contain/);
      await expect(
        remote.sshRunCron(sshConfig, ["list"], { profile }),
      ).rejects.toThrow(/Profile names may contain/);
      await expect(remote.sshInstallSkill(sshConfig, "foo", profile)).rejects.toThrow(
        /Profile names may contain/,
      );
      expect(() => remote.sshGetHermesHome(sshConfig, profile)).toThrow(
        /Profile names may contain/,
      );
      await expect(remote.sshListSessions(sshConfig, 10, 0, profile)).rejects.toThrow(
        /Profile names may contain/,
      );
      await expect(remote.sshDeleteSession(sshConfig, "session-1", profile)).rejects.toThrow(
        /Profile names may contain/,
      );

      expect(spawnMock).not.toHaveBeenCalled();
    },
  );

  it("routes SSH session deletion to the remote state database", async () => {
    const { sshDeleteSessions } = await import("../src/main/ssh-remote");
    queueSshStdout('{"requested":2,"deleted":1}');

    await expect(
      sshDeleteSessions(sshConfig, [" a ", "a", "b"], "work"),
    ).resolves.toEqual({ requested: 2, deleted: 1 });

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const args = spawnMock.mock.calls[0][1] as string[];
    expect(args.at(-1)).toContain("python3 -c");
  });
});
