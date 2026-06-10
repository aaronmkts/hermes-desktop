/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  buildOfficeKanbanBoard,
  normalizeOfficeKanbanStatus,
} from "./kanbanBoard";
import type { OfficeAgent } from "./core/types";

const agent = (id: string, cards: any[]): OfficeAgent => ({
  id,
  name: id === "a" ? "Alice" : "Bob",
  status: "active",
  color: "#fff",
  item: "desk",
  kanbanCards: cards,
});

describe("office 3d kanban board model", () => {
  it("normalizes statuses into visible Office board columns", () => {
    expect(
      [
        "todo",
        "ready",
        "specified",
        "queued",
        "backlog",
        "running",
        "in_progress",
        "active",
        "blocked",
        "waiting",
        "needs_input",
        "done",
        "completed",
        "closed",
        "weird",
      ].map(normalizeOfficeKanbanStatus),
    ).toEqual([
      "todo",
      "ready",
      "ready",
      "ready",
      "ready",
      "running",
      "running",
      "running",
      "blocked",
      "blocked",
      "blocked",
      "done",
      "done",
      "done",
      "todo",
    ]);
  });
  it("groups cards into fixed columns in deterministic order", () => {
    const board = buildOfficeKanbanBoard([
      agent("a", [
        { id: "r", title: "Run", status: "running", priority: 1 },
        { id: "b", title: "Block", status: "blocked", priority: 4 },
      ]),
      agent("b", [
        { id: "t", title: "Todo", status: "todo", priority: 2 },
        { id: "d", title: "Done", status: "done" },
      ]),
    ]);
    expect(board.columns.map((c) => c.id)).toEqual([
      "todo",
      "ready",
      "running",
      "blocked",
      "done",
    ]);
    expect(
      board.columns.flatMap((c) =>
        c.cards.map((card) => ({
          id: card.id,
          agentName: card.agentName,
          accent: card.accent,
        })),
      ),
    ).toEqual([
      { id: "t", agentName: "Bob", accent: "normal" },
      { id: "r", agentName: "Alice", accent: "running" },
      { id: "b", agentName: "Alice", accent: "blocked" },
      { id: "d", agentName: "Bob", accent: "done" },
    ]);
  });
  it("blocked and running receive visual accents", () => {
    const cards = buildOfficeKanbanBoard([
      agent("a", [
        { id: "b", title: "B", status: "blocked" },
        { id: "r", title: "R", status: "running" },
        { id: "d", title: "D", status: "completed" },
      ]),
    ]).columns.flatMap((c) => c.cards);
    expect(
      Object.fromEntries(cards.map((c) => [c.id, c.accent])),
    ).toMatchObject({ b: "blocked", r: "running", d: "done" });
  });
  it("caps cards per column without mutating input agents", () => {
    const cards = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      title: `Task ${i}`,
      status: "todo",
    }));
    const agents = [agent("a", cards)];
    const board = buildOfficeKanbanBoard(agents, { maxCardsPerColumn: 3 });
    expect(board.columns[0].cards).toHaveLength(3);
    expect(agents[0].kanbanCards).toHaveLength(5);
  });
});
