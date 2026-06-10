/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Office3D from "./Office3D";

const received: any[] = [];
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: any) => React.createElement("Canvas", null, children),
  useFrame: () => {},
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null,
  Environment: ({ children }: any) =>
    React.createElement("Environment", null, children),
  Lightformer: () => null,
  Text: ({ children }: any) => React.createElement("Text", null, children),
  useGLTF: Object.assign(() => ({ scene: {} }), { preload: () => {} }),
}));
vi.mock("troika-three-text", () => ({ configureTextBuilder: () => {} }));
vi.mock("./objects/agents", () => ({ AgentModel: () => null }));
vi.mock("./objects/furniture", () => ({
  Workstations: () => null,
  FurniturePieces: () => null,
}));
vi.mock("../../../components/ThemeProvider", () => ({
  useTheme: () => ({ resolved: "dark" }),
}));
vi.mock("./objects/KanbanBoard3D", () => ({
  KanbanBoard3D: (props: any) => {
    received.push(props);
    return React.createElement("KanbanBoard3D");
  },
}));

describe("Office3D Kanban integration", () => {
  it("builds a Kanban board from agents and renders KanbanBoard3D", () => {
    received.length = 0;
    render(
      <Office3D
        selectedId={null}
        onSelectAgent={() => {}}
        agents={[
          {
            id: "a",
            name: "Alice",
            status: "active",
            color: "#fff",
            item: "desk",
            kanbanCards: [{ id: "t1", title: "Run", status: "running" }],
          } as any,
        ]}
      />,
    );
    expect(
      received[0].board.columns.flatMap((c: any) =>
        c.cards.map((card: any) => card.id),
      ),
    ).toContain("t1");
  });
  it("renders an empty board when agents have no cards", () => {
    received.length = 0;
    render(<Office3D selectedId={null} onSelectAgent={() => {}} agents={[]} />);
    expect(received[0].board.total).toBe(0);
  });
  it("does not pass mutation callbacks to KanbanBoard3D", () => {
    received.length = 0;
    render(<Office3D selectedId={null} onSelectAgent={() => {}} agents={[]} />);
    expect(Object.keys(received[0])).toEqual(["board"]);
  });
});
