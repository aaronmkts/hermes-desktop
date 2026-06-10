import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: { count?: number }) => {
      if (key === "office.agentCount") return String(vars?.count ?? 0) + " agents";
      if (key === "office.title") return "Office";
      if (key === "office.subtitle") return "Subtitle";
      if (key === "office.refresh") return "Refresh";
      if (key === "office.close") return "Close";
      return key;
    },
  }),
}));

import Office from "./Office";
import type { OfficeLayoutItemId } from "./office3d/layoutModel";

let latestOffice3DProps: any;
vi.mock("./office3d/Office3D", () => ({
  default: (props: any) => {
    latestOffice3DProps = props;
    return (
      <div data-testid="office-3d">
        <button onClick={() => props.onSelectAgent("alpha")}>select-agent</button>
        <button onClick={() => props.onSelectLayoutItem?.("desk:desk-0" satisfies OfficeLayoutItemId)}>select-desk</button>
      </div>
    );
  },
}));
vi.mock("./OneChatModal", () => ({ default: () => null }));

const status = {
  source: "local",
  generatedAt: Date.now(),
  build: { manualUpdates: false },
  gateway: { running: true, connectedPlatforms: 1, configuredPlatforms: 1, errorPlatforms: 0 },
  providers: { codexConfigured: true, codexSource: "env", honchoConfigured: true, honchoSource: "env" },
  system: { warningCount: 0, warnings: [] },
  profiles: [
    { id: "alpha", displayName: "Alpha", gatewayRunning: true, state: "active", stateReason: "Working", recentSessionCount: 0, recentMessageCount: 0, kanban: { todo: 0, ready: 0, running: 0, blocked: 0, doneRecent: 0 }, platforms: { connected: 1, error: 0, configured: 1 } },
    { id: "bravo", displayName: "Bravo", gatewayRunning: false, state: "idle", stateReason: "Idle", recentSessionCount: 0, recentMessageCount: 0, kanban: { todo: 0, ready: 0, running: 0, blocked: 0, doneRecent: 0 }, platforms: { connected: 0, error: 0, configured: 1 } },
  ],
};

function setup() {
  (window as any).hermesAPI = { getOfficeStatus: vi.fn().mockResolvedValue(status), restartGateway: vi.fn().mockResolvedValue(undefined) };
  return render(<Office visible profile="test" />);
}

describe("Office design mode shell", () => {
  beforeEach(() => { localStorage.clear(); latestOffice3DProps = undefined; vi.useRealTimers(); });

  it("toggles design mode, passes edit props, and swaps agent panel for inspector", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("2 agents")).toBeInTheDocument());
    fireEvent.click(screen.getByText("select-agent"));
    expect(await screen.findByText("Alpha")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /design mode/i }));
    expect(latestOffice3DProps.editMode).toBe(true);
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Office design inspector")).toBeInTheDocument();
    fireEvent.click(screen.getByText("select-desk"));
    expect(latestOffice3DProps.selectedLayoutItemId).toBe("desk:desk-0");
    expect(screen.getByText("Selected: desk:desk-0")).toBeInTheDocument();
    expect(screen.getByLabelText("Desk assignment")).toBeInTheDocument();
  });

  it("nudges, rotates, assigns, saves, and resets the design draft", async () => {
    setup();
    await waitFor(() => expect(screen.getByText("2 agents")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /design mode/i }));
    fireEvent.click(screen.getByText("select-desk"));
    const before = latestOffice3DProps.layout.workstations[0];
    fireEvent.click(screen.getByRole("button", { name: "Move right" }));
    expect(latestOffice3DProps.layout.workstations[0].deskX).toBe(before.deskX + 10);
    fireEvent.click(screen.getByRole("button", { name: "Rotate right" }));
    expect(latestOffice3DProps.layout.workstations[0].deskFacingDeg).toBe(15);
    fireEvent.change(screen.getByLabelText("Desk assignment"), { target: { value: "bravo" } });
    expect(latestOffice3DProps.layout.workstations[0].agentId).toBe("bravo");
    fireEvent.click(screen.getByRole("button", { name: /save layout/i }));
    expect(JSON.parse(localStorage.getItem("hermes:office:layout:v1:test") ?? "{}").schemaVersion).toBe(1);
    expect(screen.getByRole("button", { name: /design mode/i })).toHaveTextContent("Design mode");
    fireEvent.click(screen.getByRole("button", { name: "Move left" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset draft" }));
    expect(latestOffice3DProps.layout.workstations[0].agentId).toBe("bravo");
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    expect(latestOffice3DProps.layout.workstations[0].agentId).toBe("alpha");
  });
});
