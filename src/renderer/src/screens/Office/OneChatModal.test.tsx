import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OneChatModal from "./OneChatModal";

const agents = [{ id: "alice", name: "Alice", status: "idle" as const, color: "#fff", item: "desk", gatewayRunning: true }];
const twoAgents = [
  ...agents,
  { id: "bob", name: "Bob", status: "idle" as const, color: "#0f0", item: "desk", gatewayRunning: true },
];

function installApi() {
  const api = {
    getSessionMessages: vi.fn(async () => []),
    sendMessage: vi.fn(async () => undefined),
    kanbanListTasks: vi.fn(async (filters?: { status?: string }) => ({ success: true, data: filters?.status === "blocked" ? [{ id: "TASK-1", title: "Blocked thing", assignee: null, status: "blocked" }] : [{ id: "TASK-1", title: "Blocked thing", assignee: null, status: "blocked" }] })),
    kanbanCreateTask: vi.fn(async () => ({ success: true, data: { id: "TASK-2" } })),
    kanbanAssignTask: vi.fn(async () => ({ success: true })),
    kanbanCompleteTask: vi.fn(async () => ({ success: true })),
    kanbanBlockTask: vi.fn(async () => ({ success: true })),
    kanbanUnblockTask: vi.fn(async () => ({ success: true })),
  };
  Object.defineProperty(window, "hermesAPI", { configurable: true, value: api });
  return api;
}
async function send(text: string) {
  const input = await screen.findByPlaceholderText(/Message Alice/i);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("OneChatModal office commands", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("intercepts blocked-list commands and navigates without sending chat", async () => {
    const api = installApi();
    const onNavigate = vi.fn();
    render(<OneChatModal open onClose={() => {}} agents={agents} onNavigate={onNavigate} />);
    await send("show blocked tasks");
    await screen.findByText(/Blocked thing/);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith("kanban");
  });
  it("falls back to normal chat for ordinary text", async () => {
    const api = installApi();
    api.getSessionMessages.mockResolvedValueOnce([] as never).mockResolvedValueOnce([{ kind: "assistant", id: 1, content: "hello" }] as never);
    render(<OneChatModal open onClose={() => {}} agents={agents} />);
    await send("how are you?");
    await waitFor(() => expect(api.sendMessage).toHaveBeenCalledWith("how are you?", "alice", "office-alice", []));
  });
  it("renders confirmation and confirms only once", async () => {
    const api = installApi();
    render(<OneChatModal open onClose={() => {}} agents={agents} />);
    await send("mark TASK-1 done");
    fireEvent.click(await screen.findByRole("button", { name: "Complete" }));
    await waitFor(() => expect(api.kanbanCompleteTask).toHaveBeenCalledTimes(1));
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
  it("cancels confirmation without mutation", async () => {
    const api = installApi();
    render(<OneChatModal open onClose={() => {}} agents={agents} />);
    await send("mark TASK-1 done");
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await screen.findByText("Cancelled.");
    expect(api.kanbanCompleteTask).not.toHaveBeenCalled();
  });
  it("expires pending confirmations when the modal closes", async () => {
    const api = installApi();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open chat</button>
          <OneChatModal open={open} onClose={() => setOpen(false)} agents={agents} />
        </>
      );
    }
    render(<Harness />);
    await send("mark TASK-1 done");
    expect(await screen.findByRole("button", { name: "Complete" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Open chat" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Complete" })).toBeNull());
    expect(api.kanbanCompleteTask).not.toHaveBeenCalled();
  });

  it("expires pending confirmations when the selected agent changes", async () => {
    const api = installApi();
    render(<OneChatModal open onClose={() => {}} agents={twoAgents} />);
    await send("mark TASK-1 done");
    expect(await screen.findByRole("button", { name: "Complete" })).toBeTruthy();

    fireEvent.click(screen.getByText("Bob"));
    fireEvent.click(screen.getByText("Alice"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Complete" })).toBeNull());
    expect(api.kanbanCompleteTask).not.toHaveBeenCalled();
  });
});
