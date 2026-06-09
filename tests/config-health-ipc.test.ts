import { describe, expect, it, vi } from "vitest";
import type { ConnectionConfig } from "../src/main/config";
import type { ConfigHealthReport, IssueCode } from "../src/main/config-health";
import {
  autofixConfigIssueForConnection,
  getConfigFixLogForConnection,
  getConfigHealthForConnection,
  SSH_CONFIG_HEALTH_UNSUPPORTED_MESSAGE,
} from "../src/main/config-health-ipc";

function conn(mode: ConnectionConfig["mode"]): ConnectionConfig {
  return {
    mode,
    remoteUrl: "http://localhost:3000",
    apiKey: "",
    ssh: {
      host: "vps.example",
      port: 22,
      username: "orion",
      keyPath: "/tmp/key",
      remotePort: 3000,
      localPort: 13000,
    },
  };
}

const localReport: ConfigHealthReport = {
  ranAt: 1,
  profile: "default",
  issues: [],
  summary: { errors: 0, warnings: 0, infos: 0 },
};

describe("config-health IPC SSH Tunnel guard", () => {
  it("returns a clear unsupported report in SSH mode without running local health checks", () => {
    const runLocal = vi.fn(() => localReport);

    const report = getConfigHealthForConnection(conn("ssh"), "work", runLocal);

    expect(runLocal).not.toHaveBeenCalled();
    expect(report.profile).toBe("work");
    expect(report.summary).toEqual({ errors: 0, warnings: 0, infos: 1 });
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]).toMatchObject({
      code: "REMOTE_CONFIG_HEALTH_UNSUPPORTED",
      severity: "info",
      autoFixable: false,
      fixLocation: "setup",
    });
    expect(report.issues[0].detail).toContain("SSH Tunnel mode");
    expect(report.issues[0].detail).toContain("VPS/remote configuration");
    expect(report.issues[0].detail).toContain("will not read or mutate local ~/.hermes");
  });

  it("blocks auto-fix in SSH mode without calling local mutators", () => {
    const fixLocal = vi.fn(() => ({ ok: true, message: "fixed" }));

    const result = autofixConfigIssueForConnection(
      conn("ssh"),
      "API_SERVER_KEY_NON_CANONICAL",
      "default",
      { key: "value" },
      fixLocal,
    );

    expect(fixLocal).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.message).toBe(SSH_CONFIG_HEALTH_UNSUPPORTED_MESSAGE);
    expect(result.message).toContain("SSH Tunnel mode");
    expect(result.message).toContain("will not read or mutate local ~/.hermes");
  });

  it("returns an empty fix log in SSH mode without reading local logs", () => {
    const readLocal = vi.fn(() => [{ local: true }]);

    const entries = getConfigFixLogForConnection(conn("ssh"), 25, readLocal);

    expect(readLocal).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  it("delegates to local config-health handlers outside SSH mode", () => {
    const runLocal = vi.fn((profile?: string) => ({ ...localReport, profile: profile || "default" }));
    const fixLocal = vi.fn(
      (code: IssueCode, profile?: string, context?: Record<string, string>) => ({
        ok: true,
        message: `${code}:${profile}:${context?.key}`,
      }),
    );
    const readLocal = vi.fn((maxEntries?: number) => [{ maxEntries }]);

    expect(getConfigHealthForConnection(conn("local"), "work", runLocal).profile).toBe("work");
    expect(runLocal).toHaveBeenCalledWith("work");

    expect(
      autofixConfigIssueForConnection(
        conn("remote"),
        "UI_RUNTIME_ENVKEY_MISMATCH",
        "work",
        { key: "OPENAI_API_KEY" },
        fixLocal,
      ),
    ).toEqual({
      ok: true,
      message: "UI_RUNTIME_ENVKEY_MISMATCH:work:OPENAI_API_KEY",
    });
    expect(fixLocal).toHaveBeenCalledTimes(1);

    expect(getConfigFixLogForConnection(conn("local"), 5, readLocal)).toEqual([
      { maxEntries: 5 },
    ]);
    expect(readLocal).toHaveBeenCalledWith(5);
  });
});
