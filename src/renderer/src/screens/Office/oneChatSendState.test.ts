import { describe, expect, it } from "vitest";
import { getOneChatSendState } from "./oneChatSendState";

const baseAgent = {
  id: "agent-1",
  name: "Agent One",
  status: "idle" as const,
  color: "#fff",
  item: "desk",
};

describe("getOneChatSendState", () => {
  it("allows sending when the selected gateway is reported offline so the backend can recover it", () => {
    const state = getOneChatSendState({
      input: "hello",
      selectedAgent: { ...baseAgent, gatewayRunning: false },
      isLoading: false,
    });

    expect(state.canEdit).toBe(true);
    expect(state.canSend).toBe(true);
    expect(state.warning).toContain("offline");
    expect(state.placeholder).toContain("will try to reconnect");
  });

  it("does not allow sending without a selected agent or non-empty input", () => {
    expect(
      getOneChatSendState({
        input: "hello",
        selectedAgent: null,
        isLoading: false,
      }).canSend,
    ).toBe(false);
    expect(
      getOneChatSendState({
        input: "   ",
        selectedAgent: { ...baseAgent, gatewayRunning: true },
        isLoading: false,
      }).canSend,
    ).toBe(false);
  });

  it("keeps input disabled while a message is in flight", () => {
    const state = getOneChatSendState({
      input: "hello",
      selectedAgent: { ...baseAgent, gatewayRunning: true },
      isLoading: true,
    });

    expect(state.canEdit).toBe(false);
    expect(state.canSend).toBe(false);
  });
});
