/* eslint-disable @typescript-eslint/no-explicit-any */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Kanban from "./Kanban";

vi.mock("../../components/useI18n", () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.title ? `${key}:${String(options.title)}` : key,
  }),
}));

function task(status: string, id = status): any {
  return {
    id,
    title: `${status} task`,
    body: null,
    assignee: null,
    status,
    priority: 0,
    tenant: null,
    workspace_kind: "scratch",
    workspace_path: null,
    created_by: null,
    created_at: null,
    started_at: null,
    completed_at: null,
    result: null,
    skills: [],
    max_retries: null,
  };
}

function installApi(tasks: any[]): any {
  const api = {
    kanbanListBoards: vi.fn().mockResolvedValue({
      success: true,
      data: [
        {
          slug: "default",
          name: "Default",
          is_current: true,
          total: tasks.length,
          counts: {},
        },
      ],
    }),
    kanbanListTasks: vi.fn().mockResolvedValue({ success: true, data: tasks }),
    kanbanListClaw3dHqTasks: vi
      .fn()
      .mockResolvedValue({ success: false, data: [] }),
    kanbanCompleteTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanBlockTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanUnblockTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanArchiveTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanReclaimTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanSpecifyTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanAssignTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanGetTask: vi.fn().mockResolvedValue({ success: false }),
    kanbanDispatchOnce: vi.fn().mockResolvedValue({ success: true }),
    kanbanCreateTask: vi.fn().mockResolvedValue({ success: true }),
    kanbanSwitchBoard: vi.fn().mockResolvedValue({ success: true }),
    kanbanCreateBoard: vi.fn().mockResolvedValue({ success: true }),
    listProfiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
    selectFolder: vi.fn(),
  };
  Object.defineProperty(window, "hermesAPI", {
    configurable: true,
    value: api,
  });
  return api;
}

async function renderKanban(tasks: any[]): Promise<any> {
  window.localStorage.setItem("hermes:kanban:active-board", "default");
  const api = installApi(tasks);
  render(<Kanban visible />);
  await screen.findByText(tasks[0].title);
  return api;
}

describe("Kanban card action controls", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("requires confirmation before completing a task from a card and cancellation prevents completion", async () => {
    const api = await renderKanban([task("ready")]);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    fireEvent.click(screen.getByTitle("kanban.cardMarkDone"));

    expect(window.confirm).toHaveBeenCalledWith(
      "kanban.confirmMarkDone:ready task",
    );
    await waitFor(() => expect(api.kanbanCompleteTask).not.toHaveBeenCalled());
  });

  it("renders card actions according to the shared transition policy", async () => {
    const api = await renderKanban([
      task("running", "running-1"),
      task("blocked", "blocked-1"),
    ]);
    vi.spyOn(window, "prompt").mockReturnValue("waiting");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const runningCard = screen
      .getByText("running task")
      .closest(".kanban-card")!;
    const blockedCard = screen
      .getByText("blocked task")
      .closest(".kanban-card")!;

    expect(
      runningCard.querySelector('[title="kanban.cardBlock"]'),
    ).toBeTruthy();
    expect(
      runningCard.querySelector('[title="kanban.cardMarkDone"]'),
    ).toBeTruthy();
    expect(
      blockedCard.querySelector('[title="kanban.cardMarkDone"]'),
    ).toBeTruthy();
    expect(
      blockedCard.querySelector('[title="kanban.cardUnblock"]'),
    ).toBeTruthy();

    fireEvent.click(
      blockedCard.querySelector('[title="kanban.cardMarkDone"]')!,
    );
    await waitFor(() =>
      expect(api.kanbanCompleteTask).toHaveBeenCalledWith(
        "blocked-1",
        undefined,
        undefined,
      ),
    );
  });

  it("allows blocking a running task from the card action provided by the shared policy", async () => {
    const api = await renderKanban([task("running", "running-1")]);
    vi.spyOn(window, "prompt").mockReturnValue("waiting");

    const runningCard = screen
      .getByText("running task")
      .closest(".kanban-card")!;
    fireEvent.click(runningCard.querySelector('[title="kanban.cardBlock"]')!);

    await waitFor(() =>
      expect(api.kanbanBlockTask).toHaveBeenCalledWith(
        "running-1",
        "waiting",
        undefined,
      ),
    );
  });
});
