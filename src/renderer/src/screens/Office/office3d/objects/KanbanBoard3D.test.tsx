/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KanbanBoard3D } from "./KanbanBoard3D";
import type { OfficeBoardViewModel } from "../kanbanBoard";

vi.mock("@react-three/drei", () => ({
  Text: ({ children, ...props }: any) =>
    React.createElement("Text", props, children),
}));

const board: OfficeBoardViewModel = {
  total: 1,
  columns: [
    {
      id: "todo",
      label: "Todo",
      cards: [
        {
          id: "t1",
          title: "Task One",
          agentId: "a",
          agentName: "Alice",
          status: "todo",
          column: "todo",
          priority: 2,
          accent: "normal",
          subtitle: "Alice · p2",
        },
      ],
    },
    { id: "ready", label: "Ready", cards: [] },
    { id: "running", label: "Running", cards: [] },
    { id: "blocked", label: "Blocked", cards: [] },
    { id: "done", label: "Done", cards: [] },
  ],
};
describe("KanbanBoard3D", () => {
  it("renders all column labels", () => {
    render(<KanbanBoard3D board={board} />);
    for (const label of ["Todo", "Ready", "Running", "Blocked", "Done"])
      expect(screen.getByText(label)).toBeTruthy();
  });
  it("renders task card titles and agent subtitles", () => {
    render(<KanbanBoard3D board={board} />);
    expect(screen.getByText("Task One")).toBeTruthy();
    expect(screen.getByText("Alice · p2")).toBeTruthy();
  });
  it("renders empty-state text when total is zero", () => {
    const empty = {
      ...board,
      total: 0,
      columns: board.columns.map((c) => ({ ...c, cards: [] })),
    };
    render(<KanbanBoard3D board={empty} />);
    expect(screen.getByText("No active Kanban tasks")).toBeTruthy();
  });
  it("does not expose mutation callbacks or drag handlers", () => {
    const { container } = render(<KanbanBoard3D board={board} />);
    expect(container.innerHTML).not.toContain("onpointerdown");
    expect(container.innerHTML).not.toContain("draggable");
  });
});
