import { createAgentAvatarProfileFromSeed } from "./office3d/avatars/profile";
import type { OfficeAgent, OfficeAgentStatus } from "./office3d/core/types";
import type {
  OfficeStatus,
  OfficeProfileStatus,
} from "../../../../main/office-status";

const EMPTY_KANBAN = {
  todo: 0,
  ready: 0,
  running: 0,
  blocked: 0,
  doneRecent: 0,
};
const EMPTY_PLATFORMS = { connected: 0, error: 0, configured: 0 };
const AGENT_COLORS = [
  "#22c55e",
  "#38bdf8",
  "#f59e0b",
  "#64748b",
  "#ef4444",
  "#a855f7",
  "#0891b2",
  "#db2777",
];
const STATE_COLORS: Record<OfficeAgentStatus, string> = {
  active: "#22c55e",
  available: "#38bdf8",
  idle: "#f59e0b",
  offline: "#64748b",
  error: "#ef4444",
  waiting: "#a855f7",
};

export interface OperatorCardSummary {
  label: string;
  value: string;
}

function hashName(name: string): number {
  let hash = 2166136261;
  for (let i = 0; i < name.length; i += 1) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fallbackColor(seed: string): string {
  return AGENT_COLORS[hashName(seed) % AGENT_COLORS.length];
}

function normalizeState(state: unknown): OfficeAgentStatus {
  return [
    "active",
    "available",
    "idle",
    "offline",
    "error",
    "waiting",
  ].includes(String(state))
    ? (state as OfficeAgentStatus)
    : "idle";
}

export function officeStatusToAgents(
  status: OfficeStatus | null | undefined,
): OfficeAgent[] {
  return (status?.profiles ?? []).map(
    (profile: Partial<OfficeProfileStatus>) => {
      const id = String(profile.id || profile.displayName || "agent");
      const state = normalizeState(profile.state);
      const kanban = { ...EMPTY_KANBAN, ...(profile.kanban ?? {}) };
      const platforms = { ...EMPTY_PLATFORMS, ...(profile.platforms ?? {}) };
      const subtitle =
        profile.model || profile.provider || profile.description || null;
      return {
        id,
        name: profile.displayName || id,
        subtitle,
        status: state,
        color: STATE_COLORS[state] || fallbackColor(id),
        item: "desk",
        avatarProfile: createAgentAvatarProfileFromSeed(id),
        model: profile.model ?? undefined,
        provider: profile.provider ?? undefined,
        gatewayRunning: Boolean(profile.gatewayRunning),
        position: "employee",
        stateReason: profile.stateReason || "Status unavailable",
        activeSessionId: profile.activeSessionId ?? null,
        recentSessionCount: Number(profile.recentSessionCount ?? 0),
        recentMessageCount: Number(profile.recentMessageCount ?? 0),
        lastInteractionAt: profile.lastInteractionAt ?? null,
        kanban,
        kanbanCards: profile.kanbanCards ?? [],
        platforms,
        description: profile.description ?? null,
        personality: profile.personality ?? null,
      };
    },
  );
}

function formatConfigured(value: string | null | undefined): string {
  return value && value !== "missing" ? value : "unknown";
}

function platformHealthSummary(status: OfficeStatus): string {
  const connected = status.gateway.connectedPlatforms;
  const errors = status.gateway.errorPlatforms;
  const configured = status.gateway.configuredPlatforms;
  if (connected > 0) {
    return errors > 0
      ? `Operational · ${connected} connected · optional platforms need attention`
      : `Operational · ${connected} connected`;
  }
  if (configured > 0 && errors > 0)
    return `${errors} platform${errors === 1 ? "" : "s"} need attention · 0 connected`;
  return `${connected} connected · ${configured} configured`;
}

export function buildOperatorCards(
  status: OfficeStatus | null | undefined,
): OperatorCardSummary[] {
  if (!status) {
    return [
      "ORION build",
      "Remote gateway",
      "Active work",
      "Provider auth",
      "Honcho memory",
      "Platform health",
      "Kanban tasks",
    ].map((label) => ({ label, value: "Loading…" }));
  }
  const counts = status.profiles.reduce(
    (acc, p) => {
      if (p.state === "active") acc.active += 1;
      if (p.state === "waiting") acc.waiting += 1;
      acc.running += p.kanban?.running ?? 0;
      acc.blocked += p.kanban?.blocked ?? 0;
      acc.doneRecent += p.kanban?.doneRecent ?? 0;
      return acc;
    },
    { active: 0, waiting: 0, running: 0, blocked: 0, doneRecent: 0 },
  );
  return [
    {
      label: "ORION build",
      value: status.build.manualUpdates
        ? status.build.upstreamVersion
          ? `Manual update · upstream ${status.build.upstreamVersion}`
          : "Manual fork updates"
        : "Upstream updater enabled",
    },
    {
      label: "Remote gateway",
      value: status.gateway.running
        ? `Running · ${status.gateway.connectedPlatforms}/${status.gateway.configuredPlatforms} connected`
        : "Stopped or unknown",
    },
    {
      label: "Active work",
      value: `${counts.active} active · ${counts.waiting} waiting`,
    },
    {
      label: "Provider auth",
      value: status.providers.codexConfigured
        ? `Codex signed in via ${formatConfigured(status.providers.codexSource)}`
        : "Codex not detected",
    },
    {
      label: "Honcho memory",
      value: status.providers.honchoConfigured
        ? `Configured via ${formatConfigured(status.providers.honchoSource)}`
        : "Not detected",
    },
    { label: "Platform health", value: platformHealthSummary(status) },
    {
      label: "Kanban tasks",
      value: `${counts.running} running · ${counts.blocked} blocked · ${counts.doneRecent} done today`,
    },
  ];
}
