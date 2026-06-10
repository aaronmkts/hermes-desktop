import type { OfficeAgent } from "./office3d/core/types";

export type OfficeNavigationTarget = "gateway" | "providers" | "kanban" | "sessions";
export type OfficeActionKind = "chat" | "restartGateway" | "navigate";

export interface OfficeActionAvailability {
  chat?: boolean;
  restartGateway?: boolean;
  gateway?: boolean;
  providers?: boolean;
  kanban?: boolean;
  sessions?: boolean;
}

export interface OfficeAgentActionDescriptor {
  id: "chat" | "restartGateway" | OfficeNavigationTarget;
  label: string;
  kind: OfficeActionKind;
  target: string | OfficeNavigationTarget;
  disabled?: boolean;
}

export type OfficeAgentStatusExtension = {
  state?: "active" | "available" | "idle" | "offline" | "error" | "waiting" | string;
  stateReason?: string | null;
  lastInteractionAt?: number | string | Date | null;
  recentSessionCount?: number | null;
  recentMessageCount?: number | null;
  activeSessionId?: string | null;
  description?: string | null;
  personality?: string | null;
  kanban?: Partial<Record<"todo" | "ready" | "running" | "blocked" | "doneRecent", number>> | null;
  platforms?: Partial<Record<"connected" | "error" | "configured", number>> | null;
};

export interface OfficeAgentStatusRow {
  label: string;
  value: string;
  severity?: "active" | "warning" | "error";
}

type AgentLike = Pick<OfficeAgent, "id" | "name" | "status"> & OfficeAgentStatusExtension;

const ACTIONS: OfficeAgentActionDescriptor[] = [
  { id: "chat", label: "Chat", kind: "chat", target: "" },
  { id: "restartGateway", label: "Restart remote gateway", kind: "restartGateway", target: "" },
  { id: "gateway", label: "Open Gateway", kind: "navigate", target: "gateway" },
  { id: "providers", label: "Open Providers", kind: "navigate", target: "providers" },
  { id: "kanban", label: "Open Kanban", kind: "navigate", target: "kanban" },
  { id: "sessions", label: "Open Sessions/logs", kind: "navigate", target: "sessions" },
];

export function buildOfficeAgentActions(
  agent: Pick<OfficeAgent, "id" | "name">,
  available: OfficeActionAvailability = {},
): OfficeAgentActionDescriptor[] {
  return ACTIONS.map((action) => {
    const availabilityKey = action.id;
    return {
      ...action,
      target:
        action.kind === "chat" || action.kind === "restartGateway"
          ? agent.id
          : action.target,
      disabled: available[availabilityKey] === false || undefined,
    };
  });
}

function formatLastInteraction(value: NonNullable<OfficeAgentStatusExtension["lastInteractionAt"]>, now = Date.now()): string | null {
  const time = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : value;
  if (!Number.isFinite(time)) return null;
  const diffMs = Math.max(0, now - time);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function severityFor(agent: AgentLike, fallback?: OfficeAgentStatusRow["severity"]): OfficeAgentStatusRow["severity"] {
  if (agent.status === "error" || agent.state === "error") return "error";
  if (agent.state === "waiting") return "warning";
  return fallback;
}

function kanbanCount(agent: AgentLike, key: "todo" | "ready" | "running" | "blocked" | "doneRecent"): number {
  const value = agent.kanban?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function buildOfficeAgentDetailRows(agent: AgentLike, now = Date.now()): OfficeAgentStatusRow[] {
  const todo = kanbanCount(agent, "todo");
  const ready = kanbanCount(agent, "ready");
  const running = kanbanCount(agent, "running");
  const blocked = kanbanCount(agent, "blocked");
  const doneRecent = kanbanCount(agent, "doneRecent");
  const rows: OfficeAgentStatusRow[] = [
    {
      label: "Workload",
      value: `${todo} todo · ${ready} ready · ${running} running · ${blocked} blocked · ${doneRecent} done today`,
    },
    {
      label: "Assignment context",
      value: `Profile-scoped assigned work for ${agent.name} (${agent.id})`,
    },
  ];

  if (blocked > 0) {
    rows.splice(1, 0, {
      label: "Blocked work",
      value: `${blocked} blocked ${blocked === 1 ? "task needs" : "tasks need"} operator attention`,
      severity: "warning",
    });
  }

  if (agent.activeSessionId) {
    rows.push({ label: "Active session", value: agent.activeSessionId });
  }
  if (agent.lastInteractionAt) {
    const formatted = formatLastInteraction(agent.lastInteractionAt, now);
    if (formatted) rows.push({ label: "Last interaction", value: formatted });
  }
  if (agent.description) {
    rows.push({ label: "Description", value: agent.description });
  }
  if (agent.personality) {
    rows.push({ label: "Personality", value: agent.personality });
  }

  return rows;
}

export function buildOfficeAgentStatusRows(agent: AgentLike, now = Date.now()): OfficeAgentStatusRow[] {
  const rows: OfficeAgentStatusRow[] = [];
  if (agent.stateReason) {
    rows.push({ label: "State reason", value: agent.stateReason, severity: severityFor(agent) });
  }
  if (agent.lastInteractionAt) {
    const formatted = formatLastInteraction(agent.lastInteractionAt, now);
    if (formatted) rows.push({ label: "Last interaction", value: formatted });
  }
  if (typeof agent.recentSessionCount === "number") {
    rows.push({ label: "Recent sessions", value: String(agent.recentSessionCount) });
  }
  if (typeof agent.recentMessageCount === "number") {
    rows.push({ label: "Recent messages", value: String(agent.recentMessageCount) });
  }
  if (agent.kanban?.running) {
    rows.push({ label: "Running tasks", value: String(agent.kanban.running), severity: "active" });
  }
  if (agent.kanban?.blocked) {
    rows.push({ label: "Blocked tasks", value: String(agent.kanban.blocked), severity: "warning" });
  }
  if (agent.platforms?.error) {
    rows.push({ label: "Platform errors", value: String(agent.platforms.error), severity: "error" });
  }
  return rows;
}
