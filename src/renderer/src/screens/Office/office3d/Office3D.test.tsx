/* eslint-disable @typescript-eslint/no-explicit-any */
import React from "react";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Office3D from "./Office3D";

const received: any[] = [];
const collectKanbanElements = (
  children: React.ReactNode,
): React.ReactNode[] => {
  const found: React.ReactNode[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    if (
      typeof child.type === "function" &&
      child.type.name === "KanbanBoard3D"
    ) {
      found.push(child);
      return;
    }
    found.push(...collectKanbanElements((child.props as any)?.children));
  });
  return found;
};

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: any) =>
    React.createElement(
      "div",
      { "data-testid": "r3f-canvas" },
      collectKanbanElements(children),
    ),
  useFrame: () => {},
}));
vi.mock("@react-three/drei", () => ({
  OrbitControls: () => null,
  Environment: ({ children }: any) =>
    React.createElement(React.Fragment, null, children),
  Lightformer: () => null,
  Text: ({ children }: any) => React.createElement("span", null, children),
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
  KanbanBoard3D: function KanbanBoard3D(props: any) {
    received.push(props);
    return React.createElement("div", { "data-testid": "kanban-board-3d" });
  },
}));

const reactUnknownWarning =
  /(?:is using incorrect casing|is unrecognized in this browser|React does not recognize the `[^`]+` prop)/;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleError = vi
    .spyOn(console, "error")
    .mockImplementation((...args: unknown[]) => {
      const message = args.map(String).join(" ");
      if (reactUnknownWarning.test(message)) {
        throw new Error(
          `Unexpected React unknown tag/prop warning: ${message}`,
        );
      }
    });
});

afterEach(() => {
  consoleError.mockRestore();
});

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
