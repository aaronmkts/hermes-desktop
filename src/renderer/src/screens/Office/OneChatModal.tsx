import { useState, useRef, useEffect, useMemo } from "react";
import { X, Send, Bot } from "lucide-react";
import type { OfficeAgent } from "./office3d/core/types";
import { getOneChatSendState } from "./oneChatSendState";
import { createOfficeCommandDispatcher, type ConfirmationRequirement, type OfficeCommandResult } from "./officeCommandDispatcher";
import type { OfficeNavigationTarget } from "./officeActions";

interface OneChatModalProps {
  open: boolean;
  onClose: () => void;
  agents: OfficeAgent[];
  profile?: string;
  onNavigate?: (target: OfficeNavigationTarget) => void;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
  confirmation?: ConfirmationRequirement;
}

export default function OneChatModal({
  open,
  onClose,
  agents,
  profile,
  onNavigate,
}: OneChatModalProps): React.JSX.Element | null {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Record<string, ChatMessage[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState(open);
  const scrollRef = useRef<HTMLDivElement>(null);
  const previousSelectedAgentId = useRef<string | null>(null);
  const commandDispatcher = useMemo(() => createOfficeCommandDispatcher({ api: window.hermesAPI, agents, profile }), [agents, profile]);

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) ?? null;


  const clearPendingConfirmationCards = (): void => {
    setMessages((prev) => {
      const next: Record<string, ChatMessage[]> = {};
      for (const [agentId, list] of Object.entries(prev)) {
        next[agentId] = list.map((m) => (m.confirmation ? { ...m, confirmation: undefined } : m));
      }
      return next;
    });
  };

  useEffect(() => {
    if (!open) {
      commandDispatcher.expireConfirmations();
      clearPendingConfirmationCards();
    }
  }, [open, commandDispatcher]);

  useEffect(() => {
    const previous = previousSelectedAgentId.current;
    if (previous && selectedAgentId && previous !== selectedAgentId) {
      commandDispatcher.expireConfirmations();
      clearPendingConfirmationCards();
    }
    previousSelectedAgentId.current = selectedAgentId;
  }, [selectedAgentId, commandDispatcher]);

  // Manage visible state for enter/exit transitions
  useEffect(() => {
    if (open) {
      setVisible(true);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(false), 250);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Auto-select first agent when modal opens and load session messages
  useEffect(() => {
    if (open && agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [open, agents, selectedAgentId]);

  // Load messages from office-{agentId} session when modal opens or agent changes
  useEffect(() => {
    if (!open || !selectedAgentId) return;
    const sessionId = `office-${selectedAgentId}`;
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const items = (await window.hermesAPI.getSessionMessages(
          sessionId,
        )) as Array<{
          kind: "user" | "assistant";
          id: number;
          content?: string;
        }>;
        if (cancelled) return;
        const loaded: ChatMessage[] = items
          .filter((it) => it.kind === "user" || it.kind === "assistant")
          .map((it) => ({
            id: `db-${it.id}`,
            role: it.kind === "user" ? "user" : "agent",
            text: it.content || "",
            timestamp: Date.now(),
          }));
        setMessages((prev) => ({ ...prev, [selectedAgentId]: loaded }));
      } catch {
        // Session may not exist yet — that's fine
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selectedAgentId]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedAgentId]);

  if (!visible) return null;

  const agentMessages = selectedAgentId
    ? (messages[selectedAgentId] ?? [])
    : [];

  const sendState = getOneChatSendState({
    input,
    selectedAgent,
    isLoading: selectedAgentId ? (loadingMap[selectedAgentId] ?? false) : false,
  });


  const appendAgentMessage = (agentId: string, text: string, confirmation?: ConfirmationRequirement): void => {
    setMessages((prev) => {
      const list = prev[agentId] ?? [];
      return {
        ...prev,
        [agentId]: [
          ...list,
          { id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`, role: "agent", text, timestamp: Date.now(), ...(confirmation ? { confirmation } : {}) },
        ],
      };
    });
  };

  const appendCommandResult = (agentId: string, result: OfficeCommandResult): void => {
    if (result.type === "handled") {
      appendAgentMessage(agentId, result.message);
      if (result.navigate) onNavigate?.(result.navigate);
      return;
    }
    if (result.type === "needsClarification" || result.type === "error") {
      appendAgentMessage(agentId, result.message);
      return;
    }
    if (result.type === "needsConfirmation") {
      appendAgentMessage(agentId, `${result.confirmation.title} ${result.confirmation.message}`, result.confirmation);
    }
  };

  const handleConfirmCommand = async (confirmationId: string): Promise<void> => {
    if (!selectedAgentId) return;
    const result = await commandDispatcher.confirmOfficeCommand(confirmationId);
    setMessages((prev) => ({
      ...prev,
      [selectedAgentId]: (prev[selectedAgentId] ?? []).map((m) =>
        m.confirmation?.id === confirmationId ? { ...m, confirmation: undefined } : m,
      ),
    }));
    appendCommandResult(selectedAgentId, result);
  };

  const handleCancelCommand = async (confirmationId: string): Promise<void> => {
    if (!selectedAgentId) return;
    const result = await commandDispatcher.cancelOfficeCommand(confirmationId);
    setMessages((prev) => ({
      ...prev,
      [selectedAgentId]: (prev[selectedAgentId] ?? []).map((m) =>
        m.confirmation?.id === confirmationId ? { ...m, confirmation: undefined } : m,
      ),
    }));
    appendCommandResult(selectedAgentId, result);
  };

  const handleSend = async (): Promise<void> => {
    if (!sendState.canSend || !selectedAgentId) return;
    const text = input.trim();
    setInput("");

    // Optimistically append user message
    setMessages((prev) => {
      const list = prev[selectedAgentId] ?? [];
      return {
        ...prev,
        [selectedAgentId]: [
          ...list,
          {
            id: `pending-${Date.now()}`,
            role: "user",
            text,
            timestamp: Date.now(),
          },
        ],
      };
    });

    setLoadingMap((prev) => ({ ...prev, [selectedAgentId]: true }));
    try {
      const commandResult = await commandDispatcher.dispatchOfficeCommand(text);
      if (commandResult.type !== "fallbackToChat") {
        appendCommandResult(selectedAgentId, commandResult);
        return;
      }
      const sessionId = `office-${selectedAgentId}`;
      const history = (messages[selectedAgentId] ?? [])
        .filter((m) => m.role === "user" || m.role === "agent")
        .map((m) => ({ role: m.role, content: m.text }));
      await window.hermesAPI.sendMessage(
        text,
        selectedAgentId,
        sessionId,
        history,
      );
      // Reload persisted messages from the session
      const items = (await window.hermesAPI.getSessionMessages(
        sessionId,
      )) as Array<{
        kind: "user" | "assistant";
        id: number;
        content?: string;
      }>;
      const loaded: ChatMessage[] = items
        .filter((it) => it.kind === "user" || it.kind === "assistant")
        .map((it) => ({
          id: `db-${it.id}`,
          role: it.kind === "user" ? "user" : "agent",
          text: it.content || "",
          timestamp: Date.now(),
        }));
      setMessages((prev) => ({ ...prev, [selectedAgentId]: loaded }));
    } catch (err) {
      // The response may have been persisted even though the promise rejected.
      // Try to reload from the database before showing a raw error.
      try {
        const reloadSessionId = `office-${selectedAgentId}`;
        const items = (await window.hermesAPI.getSessionMessages(
          reloadSessionId,
        )) as Array<{
          kind: "user" | "assistant";
          id: number;
          content?: string;
        }>;
        const loaded: ChatMessage[] = items
          .filter((it) => it.kind === "user" || it.kind === "assistant")
          .map((it) => ({
            id: `db-${it.id}`,
            role: it.kind === "user" ? "user" : "agent",
            text: it.content || "",
            timestamp: Date.now(),
          }));
        if (loaded.length > 0) {
          setMessages((prev) => ({
            ...prev,
            [selectedAgentId]: loaded,
          }));
          return;
        }
      } catch {
        // Ignore reload failure
      }
      // Fallback: show raw error
      setMessages((prev) => {
        const list = prev[selectedAgentId] ?? [];
        return {
          ...prev,
          [selectedAgentId]: [
            ...list,
            {
              id: `err-${Date.now()}`,
              role: "agent",
              text: `Error: ${(err as Error).message}`,
              timestamp: Date.now(),
            },
          ],
        };
      });
    } finally {
      setLoadingMap((prev) => ({ ...prev, [selectedAgentId]: false }));
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.45)",
        opacity: open ? 1 : 0,
        transition: "opacity 250ms ease-out",
        pointerEvents: open ? "auto" : "none",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex rounded-xl overflow-hidden shadow-2xl"
        style={{
          width: 900,
          height: 600,
          background: "rgba(20,24,33,0.92)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)",
          opacity: open ? 1 : 0,
          transform: open
            ? "scale(1) translateY(0)"
            : "scale(0.96) translateY(12px)",
          transition: "opacity 250ms ease-out, transform 250ms ease-out",
        }}
      >
        {/* ── Left: Agent List ── */}
        <div
          className="flex flex-col"
          style={{
            width: 260,
            borderRight: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <div
            className="flex items-center justify-between px-4"
            style={{
              height: 56,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <span className="text-sm font-semibold text-white">Agents</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex items-center justify-center rounded-md hover:bg-white/10 transition-colors"
              style={{ width: 28, height: 28 }}
            >
              <X size={16} className="text-white/70" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {agents.map((agent) => {
              const isActive = agent.id === selectedAgentId;
              const msgCount = messages[agent.id]?.length ?? 0;
              return (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedAgentId(agent.id)}
                  className="flex items-center gap-3 w-full text-left transition-colors hover:bg-white/5"
                  style={{
                    padding: "10px 16px",
                    opacity: agent.gatewayRunning ? 1 : 0.45,
                    background: isActive ? "rgba(255,255,255,0.06)" : undefined,
                    borderLeft: isActive
                      ? "3px solid #2563eb"
                      : "3px solid transparent",
                  }}
                >
                  <span
                    className="rounded-full shrink-0"
                    style={{
                      width: 10,
                      height: 10,
                      background: agent.color,
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-white truncate">
                      {agent.name}
                    </div>
                    <div className="text-xs text-white/40 truncate">
                      {agent.status}
                    </div>
                  </div>
                  {msgCount > 0 && (
                    <span
                      className="text-xs font-semibold rounded-full flex items-center justify-center"
                      style={{
                        width: 20,
                        height: 20,
                        background: "#2563eb",
                        color: "#fff",
                      }}
                    >
                      {msgCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Right: Chat Panel ── */}
        <div className="flex flex-col flex-1">
          {/* Header */}
          <div
            className="flex items-center gap-3 px-4"
            style={{
              height: 56,
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            {selectedAgent ? (
              <>
                <span
                  className="rounded-full"
                  style={{
                    width: 10,
                    height: 10,
                    background: selectedAgent.color,
                  }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">
                    {selectedAgent.name}
                  </div>
                  <div className="text-xs text-white/40">
                    {sendState.statusText ?? selectedAgent.status}
                  </div>
                </div>
              </>
            ) : (
              <span className="text-sm text-white/40">
                Select an agent to chat
              </span>
            )}
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto flex flex-col gap-3"
            style={{ padding: "16px 20px" }}
          >
            {sendState.warning && (
              <div
                className="text-sm rounded-lg"
                style={{
                  padding: "10px 12px",
                  background: "rgba(245,158,11,0.12)",
                  border: "1px solid rgba(245,158,11,0.35)",
                  color: "rgba(255,255,255,0.82)",
                }}
              >
                {sendState.warning}
              </div>
            )}
            {agentMessages.length === 0 && selectedAgent && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-white/30">
                <Bot size={40} />
                <span className="text-sm">
                  Start a conversation with {selectedAgent.name}
                </span>
              </div>
            )}
            {agentMessages.map((msg) => (
              <div
                key={msg.id}
                className="flex"
                style={{
                  justifyContent:
                    msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div
                  className="text-sm leading-relaxed"
                  style={{
                    maxWidth: "75%",
                    padding: "10px 14px",
                    borderRadius:
                      msg.role === "user"
                        ? "16px 16px 4px 16px"
                        : "16px 16px 16px 4px",
                    background:
                      msg.role === "user"
                        ? "#2563eb"
                        : "rgba(255,255,255,0.08)",
                    color:
                      msg.role === "user" ? "#fff" : "rgba(255,255,255,0.9)",
                  }}
                >
                  {msg.text}
                  {msg.confirmation && (
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleConfirmCommand(msg.confirmation!.id)}
                        className="rounded px-3 py-1 text-xs font-semibold"
                        style={{ background: msg.confirmation.danger ? "#dc2626" : "#2563eb", color: "#fff" }}
                      >
                        {msg.confirmation.confirmLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleCancelCommand(msg.confirmation!.id)}
                        className="rounded px-3 py-1 text-xs font-semibold"
                        style={{ background: "rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.9)" }}
                      >
                        {msg.confirmation.cancelLabel}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {selectedAgentId && loadingMap[selectedAgentId] && (
              <div className="flex" style={{ justifyContent: "flex-start" }}>
                <div
                  className="text-sm leading-relaxed flex items-center gap-2"
                  style={{
                    maxWidth: "75%",
                    padding: "10px 14px",
                    borderRadius: "16px 16px 16px 4px",
                    background: "rgba(255,255,255,0.08)",
                    color: "rgba(255,255,255,0.6)",
                  }}
                >
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: "rgba(255,255,255,0.4)",
                      animation: "pulse 1s infinite",
                    }}
                  />
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: "rgba(255,255,255,0.4)",
                      animation: "pulse 1s infinite 0.2s",
                    }}
                  />
                  <span
                    className="inline-block rounded-full"
                    style={{
                      width: 6,
                      height: 6,
                      background: "rgba(255,255,255,0.4)",
                      animation: "pulse 1s infinite 0.4s",
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div
            className="flex items-center gap-2"
            style={{
              padding: "12px 16px",
              borderTop: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder={sendState.placeholder}
              disabled={!sendState.canEdit}
              className="flex-1 text-sm rounded-lg outline-none text-white placeholder-white/30"
              style={{
                padding: "10px 14px",
                background: "rgba(255,255,255,0.06)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            />
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!sendState.canSend}
              className="flex items-center justify-center rounded-lg transition-colors disabled:opacity-30"
              style={{
                width: 40,
                height: 40,
                background: "#2563eb",
              }}
            >
              <Send size={18} className="text-white" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
