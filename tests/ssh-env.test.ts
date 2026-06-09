import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnSpy, calls, responses } = vi.hoisted(() => {
  const calls: Array<{ command: string; args: string[]; stdin: string }> = [];
  const responses: string[] = [];
  const spawnSpy = vi.fn((command: string, args: string[]) => {
    const stdout = new EventEmitter() as EventEmitter & {
      setEncoding: (encoding: string) => void;
    };
    const stderr = new EventEmitter() as EventEmitter & {
      setEncoding: (encoding: string) => void;
    };
    stdout.setEncoding = vi.fn();
    stderr.setEncoding = vi.fn();

    const proc = new EventEmitter() as EventEmitter & {
      stdout: typeof stdout;
      stderr: typeof stderr;
      stdin: { end: (input?: string) => void };
      kill: (signal?: string) => void;
    };
    const call = { command, args, stdin: "" };
    calls.push(call);
    proc.stdout = stdout;
    proc.stderr = stderr;
    proc.kill = vi.fn();
    proc.stdin = {
      end: (input?: string) => {
        call.stdin = input ?? "";
        const output = responses.shift() ?? "";
        process.nextTick(() => {
          if (output) stdout.emit("data", output);
          proc.emit("close", 0);
        });
      },
    };
    return proc;
  });
  return { spawnSpy, calls, responses };
});

vi.mock("child_process", () => ({
  spawn: spawnSpy,
  execFileSync: vi.fn(),
  default: { spawn: spawnSpy, execFileSync: vi.fn() },
}));

const sshConfig = {
  host: "example.test",
  port: 2222,
  username: "orion",
  keyPath: "/tmp/test-key",
  remotePort: 8642,
  localPort: 18642,
};

describe("SSH env/SOUL remote operations", () => {
  beforeEach(() => {
    calls.length = 0;
    responses.length = 0;
    spawnSpy.mockClear();
  });

  it("masks remote .env values for renderer reads", async () => {
    const { SSH_ENV_MASK, sshReadEnvForRenderer } =
      await import("../src/main/ssh-remote");
    responses.push(
      "OPENAI_API_KEY=value123\nAPI_SERVER_KEY=value456\n# ignored\nEMPTY=\n",
    );

    const env = await sshReadEnvForRenderer(sshConfig, "work");

    expect(env).toEqual({
      OPENAI_API_KEY: SSH_ENV_MASK,
      API_SERVER_KEY: SSH_ENV_MASK,
    });
    expect(JSON.stringify(env)).not.toContain("value123");
    expect(JSON.stringify(env)).not.toContain("value456");
    expect(calls[0].args.join(" ")).toContain(
      "$HOME/.hermes/profiles/work/.env",
    );
  });

  it("writes remote .env payload via stdin, not on the ssh command line", async () => {
    const { sshSetEnvValue } = await import("../src/main/ssh-remote");
    responses.push("", "");

    await sshSetEnvValue(sshConfig, "OPENAI_API_KEY", "newvalue123", "work");

    expect(spawnSpy).toHaveBeenCalledTimes(2);
    const allArgs = calls.map((c) => c.args.join(" ")).join("\n");
    expect(allArgs).toContain("$HOME/.hermes/profiles/work/.env");
    expect(allArgs).not.toContain("newvalue123");
    expect(calls[1].stdin).toBe("OPENAI_API_KEY=newvalue123\n");
  });

  it("does not overwrite a remote secret when renderer sends the unchanged mask", async () => {
    const { SSH_ENV_MASK, sshSetEnvValue } =
      await import("../src/main/ssh-remote");

    await sshSetEnvValue(sshConfig, "OPENAI_API_KEY", SSH_ENV_MASK, "work");

    expect(spawnSpy).not.toHaveBeenCalled();
  });

  it("uses remote profile SOUL.md paths and stdin for identity writes", async () => {
    const { sshWriteSoul } = await import("../src/main/ssh-remote");
    responses.push("");

    await expect(sshWriteSoul(sshConfig, "remote soul", "work")).resolves.toBe(
      true,
    );

    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(calls[0].args.join(" ")).toContain(
      "$HOME/.hermes/profiles/work/SOUL.md",
    );
    expect(calls[0].args.join(" ")).not.toContain("remote soul");
    expect(calls[0].stdin).toBe("remote soul");
  });
});
