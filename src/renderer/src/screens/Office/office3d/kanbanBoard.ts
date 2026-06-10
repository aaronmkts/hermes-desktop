import type { OfficeAgent } from "./core/types";
import type { OfficeKanbanCard } from "../../../../../main/office-status";

export type OfficeBoardColumnId =
  | "todo"
  | "ready"
  | "running"
  | "blocked"
  | "done";
export type OfficeBoardAccent = "normal" | "running" | "blocked" | "done";

export interface OfficeBoardCardView {
  id: string;
  title: string;
  agentId: string;
  agentName: string;
  status: string;
  column: OfficeBoardColumnId;
  priority: number;
  accent: OfficeBoardAccent;
  subtitle: string | null;
}
export interface OfficeBoardColumnView {
  id: OfficeBoardColumnId;
  label: string;
  cards: OfficeBoardCardView[];
}
export interface OfficeBoardViewModel {
  columns: OfficeBoardColumnView[];
  total: number;
}

const COLUMN_LABELS: Record<OfficeBoardColumnId, string> = {
  todo: "Todo",
  ready: "Ready",
  running: "Running",
  blocked: "Blocked",
  done: "Done",
};
const COLUMN_ORDER: OfficeBoardColumnId[] = [
  "todo",
  "ready",
  "running",
  "blocked",
  "done",
];
const SEVERITY: Record<OfficeBoardAccent, number> = {
  blocked: 0,
  running: 1,
  normal: 2,
  done: 3,
};

export function normalizeOfficeKanbanStatus(
  status: unknown,
): OfficeBoardColumnId {
  const value = String(status ?? "")
    .trim()
    .toLowerCase();
  if (value === "todo") return "todo";
  if (["ready", "specified", "queued", "backlog"].includes(value))
    return "ready";
  if (["running", "in_progress", "active"].includes(value)) return "running";
  if (["blocked", "waiting", "needs_input"].includes(value)) return "blocked";
  if (["done", "completed", "closed"].includes(value)) return "done";
  return "todo";
}

function accentFor(column: OfficeBoardColumnId): OfficeBoardAccent {
  if (column === "running" || column === "blocked" || column === "done")
    return column;
  return "normal";
}
function subtitle(
  agentName: string,
  card: OfficeKanbanCard,
  priority: number,
): string {
  const parts = [agentName];
  if (priority > 0) parts.push(`p${priority}`);
  if (card.assignee && card.assignee !== agentName) parts.push(card.assignee);
  return parts.join(" · ");
}

export function buildOfficeKanbanBoard(
  agents: OfficeAgent[],
  options: { maxCardsPerColumn?: number } = {},
): OfficeBoardViewModel {
  const max = options.maxCardsPerColumn ?? Number.POSITIVE_INFINITY;
  const grouped = new Map<OfficeBoardColumnId, OfficeBoardCardView[]>(
    COLUMN_ORDER.map((id) => [id, []]),
  );
  for (const agent of agents) {
    for (const card of agent.kanbanCards ?? []) {
      const column = normalizeOfficeKanbanStatus(card.status);
      const priority =
        typeof card.priority === "number" && Number.isFinite(card.priority)
          ? card.priority
          : 0;
      grouped.get(column)!.push({
        id: card.id,
        title: card.title || card.id,
        agentId: agent.id,
        agentName: agent.name,
        status: card.status,
        column,
        priority,
        accent: accentFor(column),
        subtitle: subtitle(agent.name, card, priority),
      });
    }
  }
  const columns = COLUMN_ORDER.map((id) => {
    const cards = [...(grouped.get(id) ?? [])]
      .sort(
        (a, b) =>
          SEVERITY[a.accent] - SEVERITY[b.accent] ||
          b.priority - a.priority ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      )
      .slice(0, max);
    return { id, label: COLUMN_LABELS[id], cards };
  });
  return {
    columns,
    total: columns.reduce((sum, column) => sum + column.cards.length, 0),
  };
}
