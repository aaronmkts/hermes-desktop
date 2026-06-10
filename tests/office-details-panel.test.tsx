import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import OfficeDetailsPanel from "../src/renderer/src/screens/Office/OfficeDetailsPanel";
import type { OfficeAgent } from "../src/renderer/src/screens/Office/office3d/core/types";
import type { OfficeAgentActionDescriptor, OfficeAgentStatusRow } from "../src/renderer/src/screens/Office/officeActions";

const t = (key: string) =>
  ({
    "office.close": "Close",
    "office.ceo": "CEO",
    "office.employee": "Employee",
    "office.statusLabel": "Status",
    "office.status_waiting": "Waiting",
    "office.modelLabel": "Model",
    "office.providerLabel": "Provider",
    "office.gatewayLabel": "Gateway",
    "office.gatewayRunning": "Running",
    "office.gatewayStopped": "Stopped",
    "office.makeCeo": "Make CEO",
    "office.removeCeo": "Remove CEO",
  })[key] ?? key;

const agent: OfficeAgent = {
  id: "default",
  name: "Default",
  status: "waiting",
  color: "#38bdf8",
  item: "desk",
  model: "gpt-5.5",
  provider: "openai",
  gatewayRunning: true,
  stateReason: "Blocked by approval",
  recentSessionCount: 2,
  recentMessageCount: 9,
  activeSessionId: "session-abc",
  lastInteractionAt: Date.UTC(2026, 5, 9, 12, 0, 0),
  platforms: { connected: 1, error: 2, configured: 3 },
  kanban: { todo: 2, ready: 1, running: 1, blocked: 3, doneRecent: 4 },
  description: "Coordinates support work.",
  personality: "Calm and direct.",
};

const statusRows: OfficeAgentStatusRow[] = [
  { label: "Workload", value: "2 todo · 1 ready · 1 running · 3 blocked · 4 done today" },
  { label: "Blocked work", value: "3 blocked tasks need operator attention", severity: "warning" },
  { label: "Assignment context", value: "Profile-scoped assigned work for Default (default)" },
  { label: "Description", value: "Coordinates support work." },
  { label: "Personality", value: "Calm and direct." },
];

const actions: OfficeAgentActionDescriptor[] = [
  { id: "chat", label: "Chat", kind: "chat", target: "default" },
  { id: "providers", label: "Open Providers", kind: "navigate", target: "providers", disabled: true },
];

function renderPanel(overrides = {}) {
  return render(
    <OfficeDetailsPanel
      agent={agent}
      isCeo={true}
      statusColor="#a855f7"
      statusRows={statusRows}
      actions={actions}
      actionBusy={null}
      onClose={vi.fn()}
      onAction={vi.fn()}
      onToggleCeo={vi.fn()}
      t={t}
      {...overrides}
    />,
  );
}

describe("OfficeDetailsPanel", () => {
  it("renders agent identity, runtime, workload, blocked, platforms, and profile context", () => {
    renderPanel();

    expect(screen.getByLabelText("Office details panel")).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();
    expect(screen.getByText("CEO")).toBeTruthy();
    expect(screen.getByText("Waiting")).toBeTruthy();
    expect(screen.getByText("gpt-5.5")).toBeTruthy();
    expect(screen.getByText("openai")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Workload")).toBeTruthy();
    expect(screen.getByText("2 todo · 1 ready · 1 running · 3 blocked · 4 done today")).toBeTruthy();
    expect(screen.getByText("Blocked work")).toBeTruthy();
    expect(screen.getByText("3 blocked tasks need operator attention")).toBeTruthy();
    expect(screen.getByText("1 connected · 2 errors · 3 configured")).toBeTruthy();
    expect(screen.getByText("Coordinates support work.")).toBeTruthy();
    expect(screen.getByText("Calm and direct.")).toBeTruthy();
  });

  it("invokes onClose from the close button", () => {
    const onClose = vi.fn();
    renderPanel({ onClose });

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("invokes enabled actions and does not invoke disabled actions", () => {
    const onAction = vi.fn();
    renderPanel({ onAction });

    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Providers" }));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith(actions[0]);
    expect(screen.getByRole("button", { name: "Open Providers" }).hasAttribute("disabled")).toBe(true);
  });
});
