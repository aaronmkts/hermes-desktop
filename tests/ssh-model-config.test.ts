import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawned = vi.hoisted(() => [] as any[]);
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("child_process", () => ({
  spawn: spawnMock,
  default: { spawn: spawnMock },
}));

vi.mock("../src/main/installer", () => ({
  HERMES_HOME: "/tmp/hermes-test",
  expectedEnvKeyForModel: (provider: string, baseUrl?: string) => {
    if (provider === "custom" && baseUrl?.includes("deepseek"))
      return "DEEPSEEK_API_KEY";
    if (provider === "openrouter") return "OPENROUTER_API_KEY";
    return null;
  },
}));

const ssh = {
  host: "orion.example",
  port: 22,
  username: "orion",
  keyPath: "/tmp/key",
  remotePort: 8642,
  localPort: 28642,
};

function queueSshStdout(stdout: string): any {
  const proc = Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stdin: { end: vi.fn() },
    kill: vi.fn(),
  });
  spawned.push(proc);
  spawnMock.mockImplementationOnce(() => {
    setImmediate(() => {
      proc.stdout.emit("data", stdout);
      proc.emit("close", 0);
    });
    return proc;
  });
  return proc;
}

beforeEach(() => {
  spawned.length = 0;
  spawnMock.mockReset();
});

describe("SSH model config", () => {
  it("reads model config from the remote profile config.yaml over sshExec", async () => {
    queueSshStdout(
      [
        "personalities:",
        "  default: keep-me",
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );
    queueSshStdout(
      [
        "personalities:",
        "  default: keep-me",
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );
    queueSshStdout(
      [
        "personalities:",
        "  default: keep-me",
        "model:",
        "  provider: openrouter",
        "  default: openai/gpt-4o",
        "  base_url: https://openrouter.ai/api/v1",
        "",
      ].join("\n"),
    );

    const { sshGetModelConfig } = await import("../src/main/ssh-remote");
    await expect(sshGetModelConfig(ssh, "work")).resolves.toEqual({
      provider: "openrouter",
      model: "openai/gpt-4o",
      baseUrl: "https://openrouter.ai/api/v1",
    });

    expect(spawnMock).toHaveBeenCalledTimes(3);
    const command = String(spawnMock.mock.calls[0][1].at(-1));
    expect(command).toContain("$HOME/.hermes/profiles/work/config.yaml");
  });

  it("writes model config back to the remote config preserving non-model sections", async () => {
    queueSshStdout(
      [
        "personalities:",
        "  default: keep-me",
        "model:",
        "  provider: openrouter",
        "  default: old-model",
        "  base_url: https://openrouter.ai/api/v1",
        "streaming: false",
        "smart_model_routing:",
        "  enabled: true",
        "",
      ].join("\n"),
    );
    queueSshStdout("");

    const { sshSetModelConfig } = await import("../src/main/ssh-remote");
    await sshSetModelConfig(ssh, "deepseek", "deepseek-chat", "", "work");

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const writeProc = spawned[1];
    const payload = String(writeProc.stdin.end.mock.calls[0][0]);
    expect(payload).toContain("personalities:\n  default: keep-me");
    expect(payload).toContain('provider: "deepseek"');
    expect(payload).toContain('default: "deepseek-chat"');
    expect(payload).toContain('base_url: "https://api.deepseek.com/v1"');
    expect(payload).toContain("streaming: true");
    expect(payload).toContain("smart_model_routing:\n  enabled: false");
    expect(String(spawnMock.mock.calls[1][1].at(-1))).toContain(
      "$HOME/.hermes/profiles/work/config.yaml",
    );
  });
});
