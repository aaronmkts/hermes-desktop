import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
const calls = vi.hoisted(
  () => [] as Array<{ command: string; args: string[]; stdin: string }>,
);

vi.mock("child_process", () => ({
  default: { spawn: spawnMock, execFileSync: vi.fn() },
  spawn: spawnMock,
  execFileSync: vi.fn(),
}));

function makeStream(): EventEmitter & { setEncoding: (encoding: string) => void } {
  const stream = new EventEmitter() as EventEmitter & {
    setEncoding: (encoding: string) => void;
  };
  stream.setEncoding = vi.fn();
  return stream;
}

function installSpawnMock(stdoutForCommand: (command: string) => string = () => "") {
  spawnMock.mockImplementation((command: string, args: string[]) => {
    const stdout = makeStream();
    const stderr = makeStream();
    const call = { command, args, stdin: "" };
    calls.push(call);
    const child = new EventEmitter() as EventEmitter & {
      stdout: ReturnType<typeof makeStream>;
      stderr: ReturnType<typeof makeStream>;
      stdin: { end: (chunk?: string) => void };
      kill: (signal: string) => void;
    };
    child.stdout = stdout;
    child.stderr = stderr;
    child.kill = vi.fn();
    child.stdin = {
      end: (chunk?: string) => {
        call.stdin = chunk ?? "";
        queueMicrotask(() => {
          const out = stdoutForCommand(args[args.length - 1]);
          if (out) stdout.emit("data", out);
          child.emit("close", 0);
        });
      },
    };
    return child;
  });
}

const config = {
  host: "vps.example",
  port: 2222,
  username: "orion",
  keyPath: "/tmp/key",
  remotePort: 8642,
  localPort: 28642,
};

describe("SSH profile operations", () => {
  beforeEach(() => {
    calls.length = 0;
    spawnMock.mockReset();
    installSpawnMock((command) =>
      command === "python3 -"
        ? JSON.stringify([
            {
              name: "default",
              path: "/home/orion/.hermes",
              isDefault: true,
              isActive: false,
              model: "gpt-4o",
              provider: "openai",
              hasEnv: true,
              hasSoul: true,
              skillCount: 1,
              gatewayRunning: false,
            },
            {
              name: "work",
              path: "/home/orion/.hermes/profiles/work",
              isDefault: false,
              isActive: true,
              model: "claude",
              provider: "anthropic",
              hasEnv: false,
              hasSoul: false,
              skillCount: 0,
              gatewayRunning: true,
            },
          ])
        : "",
    );
  });

  it("lists profiles by inspecting the remote $HOME/.hermes source of truth", async () => {
    const { sshListProfiles } = await import("../src/main/ssh-remote");

    const profiles = await sshListProfiles(config);

    expect(profiles.map((p) => p.path)).toEqual([
      "/home/orion/.hermes",
      "/home/orion/.hermes/profiles/work",
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].args.at(-1)).toBe("python3 -");
    expect(calls[0].stdin).toContain('os.path.expanduser("~/.hermes")');
    expect(calls[0].stdin).toContain('os.path.join(hermes_home, "profiles")');
    expect(calls[0].stdin).toContain('active_profile');
  });

  it("creates and clones named profiles under remote $HOME/.hermes/profiles", async () => {
    const { sshCreateProfile } = await import("../src/main/ssh-remote");

    await expect(sshCreateProfile(config, "fresh", false)).resolves.toEqual({
      success: true,
    });
    await expect(sshCreateProfile(config, "clone-me", true)).resolves.toEqual({
      success: true,
    });

    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.args.at(-1)).toContain("python3 -c");
      expect(call.stdin).toContain('"name"');
      expect(call.stdin).not.toContain("../");
    }
    expect(JSON.parse(calls[0].stdin)).toEqual({ name: "fresh", clone: false });
    expect(JSON.parse(calls[1].stdin)).toEqual({ name: "clone-me", clone: true });
    expect(calls[1].args.at(-1)).toContain('os.path.expanduser("~/.hermes")');
    expect(calls[1].args.at(-1)).toContain('os.path.join(profiles_dir, name)');
    expect(calls[1].args.at(-1)).toContain("shutil.copytree");
  });

  it("deletes profiles and switches active profile on the remote profile home", async () => {
    const { sshDeleteProfile, sshSetActiveProfile } = await import(
      "../src/main/ssh-remote"
    );

    await expect(sshDeleteProfile(config, "old")).resolves.toEqual({
      success: true,
    });
    await expect(sshSetActiveProfile(config, "work")).resolves.toEqual({
      success: true,
    });

    expect(JSON.parse(calls[0].stdin)).toEqual({ name: "old" });
    expect(calls[0].args.at(-1)).toContain('os.path.expanduser("~/.hermes")');
    expect(calls[0].args.at(-1)).toContain('"profiles", name');
    expect(calls[0].args.at(-1)).toContain("shutil.rmtree");
    expect(JSON.parse(calls[1].stdin)).toEqual({ name: "work" });
    expect(calls[1].args.at(-1)).toContain('"active_profile"');
    expect(calls[1].args.at(-1)).toContain('"profiles", name');
  });

  it("rejects invalid SSH profile names before running remote commands", async () => {
    const { sshCreateProfile, sshDeleteProfile, sshSetActiveProfile } =
      await import("../src/main/ssh-remote");

    expect((await sshCreateProfile(config, "../outside", false)).success).toBe(
      false,
    );
    expect((await sshDeleteProfile(config, "default")).success).toBe(false);
    expect((await sshSetActiveProfile(config, "UpperCase")).success).toBe(
      false,
    );
    expect(calls).toHaveLength(0);
  });
});
