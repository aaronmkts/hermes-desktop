import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import officeCopy from "../../../../shared/i18n/locales/en/office";
import { getOfficeExperienceCopy, OFFICE_EXPERIENCE_BOUNDARY } from "../../../../shared/office-boundary";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (key === "office.agentCount") return `${vars?.count ?? 0} agents`;
      const office = {
        title: "ORION Office",
        subtitle: "Claw3D Studio workspace for Hermes agents",
        refresh: "Refresh",
        setupTitle: "Install Claw3D Studio",
        setupDesc1: "Clone and install Claw3D Studio for the Office workspace.",
        setupDesc2: "Hermes connects to the VPS backend through the existing SSH gateway token flow.",
        installClaw3d: "Install Claw3D",
        starting: "Starting...",
        clickToStart: "Click Start to open Claw3D Studio",
        loadingClaw3d: "Loading Claw3D Studio...",
        openInBrowser: "Open in Browser",
        startFailed: "Failed to start Claw3D Studio",
        setupFailed: "Claw3D setup failed",
      };
      const name = key.replace("office.", "") as keyof typeof office;
      return office[name] ?? key;
    },
  }),
}));

vi.mock("./office3d/Office3D", () => ({ default: () => <div data-testid="office-3d" /> }));
vi.mock("./OneChatModal", () => ({ default: () => null }));

import Office from "./Office";

type ClawStatus = Awaited<ReturnType<typeof window.hermesAPI.claw3dStatus>>;

const status = (overrides: Partial<ClawStatus> = {}): ClawStatus => ({
  cloned: false,
  installed: false,
  devServerRunning: false,
  adapterRunning: false,
  port: 5173,
  portInUse: false,
  wsUrl: "ws://127.0.0.1:8765",
  running: false,
  error: "",
  remoteUrl: null,
  remoteSource: null,
  ...overrides,
});

function renderOffice(clawStatus: ClawStatus) {
  (window as any).hermesAPI = {
    claw3dStatus: vi.fn().mockResolvedValue(clawStatus),
    claw3dSetup: vi.fn().mockResolvedValue({ success: true }),
    claw3dStartAll: vi.fn().mockResolvedValue({ success: true }),
    claw3dStopAll: vi.fn().mockResolvedValue(true),
    claw3dGetLogs: vi.fn().mockResolvedValue(""),
    getOfficeStatus: vi.fn(),
  };
  return render(<Office visible profile="default" />);
}

describe("Office Claw3D launcher", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("renders an install/setup Claw3D call-to-action when Claw3D is missing", async () => {
    renderOffice(status({ cloned: false, installed: false }));

    expect(await screen.findByRole("heading", { name: /install claw3d studio/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /install claw3d/i })).toBeInTheDocument();
    expect(screen.queryByTestId("office-3d")).not.toBeInTheDocument();
  });

  it("clicking install calls claw3dSetup", async () => {
    renderOffice(status({ cloned: false, installed: false }));

    fireEvent.click(await screen.findByRole("button", { name: /install claw3d/i }));

    await waitFor(() => expect(window.hermesAPI.claw3dSetup).toHaveBeenCalledTimes(1));
  });

  it("shows Start when installed but not running and starts Claw3D with the selected profile", async () => {
    renderOffice(status({ cloned: true, installed: true, running: false }));

    const start = await screen.findByRole("button", { name: /^start$/i });
    await waitFor(() => expect(window.hermesAPI.claw3dStatus).toHaveBeenCalledWith("default"));
    expect(screen.getByText(/click start to open claw3d studio/i)).toBeInTheDocument();
    fireEvent.click(start);

    await waitFor(() => expect(window.hermesAPI.claw3dStartAll).toHaveBeenCalledWith("default"));
  });

  it("embeds the Claw3D Studio runtime using remoteUrl when running", async () => {
    renderOffice(status({ cloned: true, installed: true, running: true, port: 5178, remoteUrl: "https://office.example.invalid/session" }));

    const frame = await screen.findByTitle(/claw3d studio runtime/i);
    expect(frame).toHaveAttribute("src", "https://office.example.invalid/session");
    expect(screen.getByRole("link", { name: /open in browser/i })).toHaveAttribute("href", "https://office.example.invalid/session");
  });

  it("falls back to localhost port for the embedded runtime URL", async () => {
    renderOffice(status({ cloned: true, installed: true, running: true, port: 5199, remoteUrl: null }));

    expect(await screen.findByTitle(/claw3d studio runtime/i)).toHaveAttribute("src", "http://127.0.0.1:5199");
  });
});

describe("Office Claw3D copy", () => {
  it("does not describe external Claw3D as optional legacy or unsupported by Office", () => {
    const combined = [
      officeCopy.subtitle,
      officeCopy.setupTitle,
      officeCopy.setupDesc1,
      officeCopy.setupDesc2,
      OFFICE_EXPERIENCE_BOUNDARY.main.kind,
      OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.kind,
      OFFICE_EXPERIENCE_BOUNDARY.externalClaw3d.status,
      ...Object.values(getOfficeExperienceCopy()),
    ].join("\n");

    expect(combined).not.toMatch(/optional advanced legacy|advanced, legacy|does not install|without installing external claw3d|not implemented/i);
    expect(combined).toMatch(/install|clone|start/i);
  });
});
