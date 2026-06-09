import type { ConnectionConfig } from "./config";
import type { ConfigHealthReport, IssueCode } from "./config-health";

export const SSH_CONFIG_HEALTH_UNSUPPORTED_MESSAGE =
  "Config health and auto-fix are disabled in SSH Tunnel mode because the local desktop config may not match the VPS. Use VPS/remote configuration diagnostics instead; Hermes Desktop will not read or mutate local ~/.hermes config for this action.";

export function isSshTunnelMode(conn: ConnectionConfig): boolean {
  return conn.mode === "ssh";
}

export function sshConfigHealthUnsupportedReport(
  profile?: string,
): ConfigHealthReport {
  return {
    ranAt: Date.now(),
    profile: profile || "default",
    issues: [
      {
        code: "REMOTE_CONFIG_HEALTH_UNSUPPORTED",
        severity: "info",
        message: "Config health is remote-only in SSH Tunnel mode.",
        detail: SSH_CONFIG_HEALTH_UNSUPPORTED_MESSAGE,
        locations: ["VPS / remote Hermes configuration"],
        autoFixable: false,
        fixDescription:
          "Run diagnostics on the VPS/remote Hermes configuration instead of local desktop files.",
        fixLocation: "setup",
      },
    ],
    summary: { errors: 0, warnings: 0, infos: 1 },
  };
}

export function getConfigHealthForConnection(
  conn: ConnectionConfig,
  profile: string | undefined,
  runLocal: (profile?: string) => ConfigHealthReport,
): ConfigHealthReport {
  if (isSshTunnelMode(conn)) return sshConfigHealthUnsupportedReport(profile);
  return runLocal(profile);
}

export function autofixConfigIssueForConnection(
  conn: ConnectionConfig,
  code: IssueCode,
  profile: string | undefined,
  context: Record<string, string> | undefined,
  fixLocal: (
    code: IssueCode,
    profile?: string,
    context?: Record<string, string>,
  ) => { ok: boolean; message?: string },
): { ok: boolean; message?: string } {
  if (isSshTunnelMode(conn)) {
    return { ok: false, message: SSH_CONFIG_HEALTH_UNSUPPORTED_MESSAGE };
  }
  return fixLocal(code, profile, context);
}

export function getConfigFixLogForConnection(
  conn: ConnectionConfig,
  maxEntries: number | undefined,
  readLocal: (maxEntries?: number) => unknown[],
): unknown[] {
  if (isSshTunnelMode(conn)) return [];
  return readLocal(maxEntries);
}
