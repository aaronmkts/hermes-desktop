import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Crown,
  MessageCircle,
  Move,
  Power,
  RefreshCw,
  RotateCcw,
  Save,
  Users,
  X,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import oneChatIcon from "../../assets/images/one-chat.svg";
import OneChatModal from "./OneChatModal";
import Office3D from "./office3d/Office3D";
import { buildOperatorCards, officeStatusToAgents } from "./officeStatus";
import type { OfficeAgent } from "./office3d/core/types";
import {
  buildOfficeAgentActions,
  buildOfficeAgentStatusRows,
  type OfficeNavigationTarget,
} from "./officeActions";
import type { OfficeStatus } from "../../../../main/office-status";
import {
  OFFICE_LAYOUT_STORAGE_KEY,
  useOfficeLayoutDraft,
} from "./useOfficeLayoutDraft";

interface OfficeProps {
  profile?: string;
  visible?: boolean;
  onNavigate?: (target: OfficeNavigationTarget) => void;
  onSelectProfile?: (profile: string) => void;
}

// The CEO assignment is desktop-local UI state (one agent at a time), persisted
// across reloads like the app's other renderer preferences (theme, locale).
const CEO_STORAGE_KEY = "hermes:office:ceo";

function readStoredCeo(): string | null {
  try {
    return localStorage.getItem(CEO_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/**
 * The Office tab. Renders a native, in-renderer 3D office (no external dev
 * server / webview) where each Hermes profile appears as an interactive agent.
 */
function Office({
  profile,
  visible,
  onNavigate,
  onSelectProfile,
}: OfficeProps): React.JSX.Element {
  const { t } = useI18n();
  const [agents, setAgents] = useState<OfficeAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [ceoId, setCeoId] = useState<string | null>(readStoredCeo);
  const [chatOpen, setChatOpen] = useState(false);
  const [officeStatus, setOfficeStatus] = useState<OfficeStatus | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [designMode, setDesignMode] = useState(false);

  const setCeo = useCallback((id: string | null) => {
    setCeoId(id);
    try {
      if (id) localStorage.setItem(CEO_STORAGE_KEY, id);
      else localStorage.removeItem(CEO_STORAGE_KEY);
    } catch {
      // localStorage may be unavailable in sandboxed renderers
    }
  }, []);
  // Avoid refetching every time the tab regains visibility within a session;
  // only the first reveal and explicit refreshes hit IPC.
  const loadedOnce = useRef(false);

  const loadOfficeStatus = useCallback(async () => {
    setLoading(true);
    try {
      const status = await window.hermesAPI.getOfficeStatus(profile);
      setOfficeStatus(status);
      setAgents(officeStatusToAgents(status));
    } catch {
      setOfficeStatus(null);
      setAgents([]);
    } finally {
      setLoading(false);
      loadedOnce.current = true;
    }
  }, [profile]);

  const refreshOfficeStatus = useCallback(async () => {
    try {
      const status = await window.hermesAPI.getOfficeStatus(profile);
      const next = officeStatusToAgents(status);
      setOfficeStatus(status);
      setAgents((prev) => {
        const prevById = new Map(prev.map((a) => [a.id, a]));
        const changed =
          next.length !== prev.length ||
          next.some((a) => {
            const before = prevById.get(a.id);
            return (
              !before ||
              before.status !== a.status ||
              before.gatewayRunning !== a.gatewayRunning ||
              before.stateReason !== a.stateReason ||
              before.recentMessageCount !== a.recentMessageCount
            );
          });
        return changed ? next : prev;
      });
    } catch {
      // Transient IPC failures are ignored; the next tick retries.
    }
  }, [profile]);

  useEffect(() => {
    if (visible && !loadedOnce.current) {
      void loadOfficeStatus();
    }
  }, [visible, loadOfficeStatus]);

  // Background poll: re-read profiles while the tab is visible so a gateway
  // starting/stopping flips an agent's status (idle <-> working). The 3D
  // controller reacts to that change by walking the agent to its desk or to
  // the rest room. We update state only when something actually changed and
  // never toggle `loading`, so this stays flicker-free.
  useEffect(() => {
    if (!visible) return;
    const interval = window.setInterval(() => {
      void refreshOfficeStatus();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [visible, refreshOfficeStatus]);

  // The initial fetch is driven solely by the visible-guard effect above
  // (gated on `!loadedOnce.current`). A second unconditional mount effect used
  // to live here too, but when the tab was visible on first render both fired
  // in the same commit and raced two concurrent `listProfiles` calls.

  // Reset selection / CEO if the underlying profile disappears on refresh.
  useEffect(() => {
    if (selectedId && !agents.some((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [agents, selectedId]);
  useEffect(() => {
    // Only prune a stale CEO once profiles have loaded — otherwise the initial
    // empty `agents` array would wipe the just-restored CEO on every launch.
    if (loading) return;
    if (ceoId && !agents.some((a) => a.id === ceoId)) setCeo(null);
  }, [loading, agents, ceoId, setCeo]);

  // Tag each agent with its org position; the CEO drives the executive desk.
  const positionedAgents = useMemo<OfficeAgent[]>(
    () =>
      agents.map((a) => ({
        ...a,
        position: a.id === ceoId ? "ceo" : "employee",
      })),
    [agents, ceoId],
  );

  const agentIds = useMemo(
    () => positionedAgents.map((a) => a.id),
    [positionedAgents],
  );
  const layoutDraft = useOfficeLayoutDraft({
    storageKey: `${OFFICE_LAYOUT_STORAGE_KEY}:${profile ?? "default"}`,
    agentIds,
    ceoId,
  });
  const selectedDesk = layoutDraft.selectedItemId?.startsWith("desk:")
    ? (layoutDraft.layout.desks.find(
        (d) => `desk:${d.id}` === layoutDraft.selectedItemId,
      ) ?? null)
    : null;

  const selectedAgent = !designMode
    ? (positionedAgents.find((a) => a.id === selectedId) ?? null)
    : null;
  const selectedActions = selectedAgent
    ? buildOfficeAgentActions(selectedAgent, {
        chat: true,
        restartGateway: typeof window.hermesAPI.restartGateway === "function",
        gateway: Boolean(onNavigate),
        providers: Boolean(onNavigate),
        kanban: Boolean(onNavigate),
        sessions: Boolean(onNavigate),
      })
    : [];
  const selectedStatusRows = selectedAgent
    ? buildOfficeAgentStatusRows(selectedAgent)
    : [];
  const selectedIsCeo = selectedAgent?.position === "ceo";
  const selectedStatusColor =
    selectedAgent?.status === "active"
      ? "#22c55e"
      : selectedAgent?.status === "available"
        ? "#38bdf8"
        : selectedAgent?.status === "error"
          ? "#ef4444"
          : selectedAgent?.status === "waiting"
            ? "#a855f7"
            : selectedAgent?.status === "offline"
              ? "#64748b"
              : "#f59e0b";

  const handleAgentAction = useCallback(
    async (action: ReturnType<typeof buildOfficeAgentActions>[number]) => {
      if (!selectedAgent || action.disabled) return;
      if (action.kind === "chat") {
        onSelectProfile?.(selectedAgent.id);
        setChatOpen(true);
        return;
      }
      if (action.kind === "navigate") {
        onSelectProfile?.(selectedAgent.id);
        onNavigate?.(action.target as OfficeNavigationTarget);
        return;
      }
      setActionBusy(action.id);
      try {
        await window.hermesAPI.restartGateway(selectedAgent.id);
        await loadOfficeStatus();
      } finally {
        setActionBusy(null);
      }
    },
    [loadOfficeStatus, onNavigate, onSelectProfile, selectedAgent],
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "relative",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 16px",
          borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>
            {t("office.title")}
          </span>
          <span style={{ fontSize: 12, opacity: 0.6 }}>
            {t("office.subtitle")}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 13,
              opacity: 0.75,
            }}
          >
            <Users size={15} />
            {t("office.agentCount", { count: agents.length })}
          </span>
          <button
            type="button"
            onClick={() => {
              setDesignMode((value) => {
                const next = !value;
                if (next) setSelectedId(null);
                else layoutDraft.selectItem(null);
                return next;
              });
            }}
            aria-pressed={designMode}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: designMode ? "rgba(56,189,248,0.16)" : "transparent",
              color: "var(--text-secondary)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Design mode{layoutDraft.dirty ? " *" : ""}
          </button>
          <button
            type="button"
            onClick={() => {
              void loadOfficeStatus();
            }}
            disabled={loading}
            title={t("office.refresh")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border, rgba(0,0,0,0.12))",
              background: "transparent",
              // Native <button> doesn't inherit `color`; without this it falls
              // back to the UA default (black) and is invisible on the dark
              // header. Use the theme's text colour so it's readable in every
              // theme.
              color: "var(--text-secondary)",
              cursor: loading ? "default" : "pointer",
              fontSize: 13,
            }}
          >
            <RefreshCw
              size={14}
              style={{
                animation: loading ? "spin 1s linear infinite" : undefined,
              }}
            />
            {t("office.refresh")}
          </button>
        </div>
      </header>

      <section
        aria-label="ORION operator status"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
          gap: 8,
          padding: "10px 16px",
          borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))",
          background: "rgba(127,127,127,0.04)",
        }}
      >
        {buildOperatorCards(officeStatus).map((card) => (
          <div
            key={card.label}
            style={{
              border: "1px solid var(--border, rgba(0,0,0,0.08))",
              borderRadius: 10,
              padding: "8px 10px",
              background: "var(--surface, rgba(255,255,255,0.04))",
              minWidth: 0,
            }}
          >
            <div style={{ fontSize: 11, opacity: 0.58, marginBottom: 3 }}>
              {card.label}
            </div>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={card.value}
            >
              {card.value}
            </div>
          </div>
        ))}
      </section>

      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <Office3D
          agents={positionedAgents}
          selectedId={selectedId}
          onSelectAgent={setSelectedId}
          layout={layoutDraft.layout}
          editMode={designMode}
          selectedLayoutItemId={layoutDraft.selectedItemId}
          onSelectLayoutItem={layoutDraft.selectItem}
        />

        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="absolute bottom-5 right-5 w-[120px] h-11 rounded-lg border-none bg-black cursor-pointer flex items-center justify-center px-3 gap-2 z-10"
        >
          <img
            src={oneChatIcon}
            alt="Chat"
            className="h-6 brightness-0 invert"
          />
        </button>

        <OneChatModal
          open={chatOpen}
          onClose={() => setChatOpen(false)}
          agents={positionedAgents}
        />

        {designMode && (
          <aside
            aria-label="Office design inspector"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 320,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              padding: "18px",
              background: "var(--card, rgba(20,24,33,0.96))",
              color: "#fff",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "-12px 0 32px rgba(0,0,0,0.28)",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <strong>Design inspector</strong>
              <button
                type="button"
                onClick={() => {
                  setDesignMode(false);
                  layoutDraft.selectItem(null);
                }}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Selected: {layoutDraft.selectedItemId ?? "none"}
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr 1fr",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={() => layoutDraft.moveSelected(0, -10)}
                aria-label="Move up"
              >
                <Move size={14} /> Up
              </button>
              <button
                type="button"
                onClick={() => layoutDraft.moveSelected(-10, 0)}
                aria-label="Move left"
              >
                Left
              </button>
              <button
                type="button"
                onClick={() => layoutDraft.moveSelected(10, 0)}
                aria-label="Move right"
              >
                Right
              </button>
              <button
                type="button"
                onClick={() => layoutDraft.moveSelected(0, 10)}
                aria-label="Move down"
              >
                Down
              </button>
              <button
                type="button"
                onClick={() => layoutDraft.rotateSelected(-15)}
                aria-label="Rotate left"
              >
                <RotateCcw size={14} /> -15°
              </button>
              <button
                type="button"
                onClick={() => layoutDraft.rotateSelected(15)}
                aria-label="Rotate right"
              >
                +15°
              </button>
            </div>
            {selectedDesk && (
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                  fontSize: 13,
                }}
              >
                Desk assignment
                <select
                  value={selectedDesk.agentId ?? ""}
                  onChange={(event) =>
                    layoutDraft.assignDesk(
                      selectedDesk.id,
                      event.target.value || null,
                    )
                  }
                >
                  <option value="">Unassigned</option>
                  {positionedAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={layoutDraft.save}
              disabled={!layoutDraft.dirty}
            >
              <Save size={14} /> Save layout
            </button>
            <button type="button" onClick={layoutDraft.resetDraft}>
              Reset draft
            </button>
            <button type="button" onClick={layoutDraft.resetToDefault}>
              Reset to default
            </button>
          </aside>
        )}

        {selectedAgent && (
          <aside
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 300,
              display: "flex",
              flexDirection: "column",
              gap: 16,
              padding: "18px 18px 22px",
              background: "var(--card, rgba(20,24,33,0.96))",
              color: "#fff",
              borderLeft: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "-12px 0 32px rgba(0,0,0,0.28)",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "flex-start",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 4,
                    background: selectedAgent.color,
                    flex: "0 0 auto",
                  }}
                />
                <span style={{ fontWeight: 700, fontSize: 16 }}>
                  {selectedAgent.name}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(null)}
                title={t("office.close")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 4,
                  borderRadius: 6,
                  border: "none",
                  background: "transparent",
                  color: "rgba(255,255,255,0.7)",
                  cursor: "pointer",
                }}
              >
                <X size={16} />
              </button>
            </div>

            <div
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                alignSelf: "flex-start",
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 12,
                fontWeight: 600,
                background: selectedIsCeo
                  ? "rgba(245,158,11,0.18)"
                  : "rgba(255,255,255,0.08)",
                color: selectedIsCeo ? "#fbbf24" : "rgba(255,255,255,0.85)",
              }}
            >
              {selectedIsCeo && <Crown size={13} />}
              {selectedIsCeo ? t("office.ceo") : t("office.employee")}
            </div>

            <dl
              style={{
                display: "grid",
                gridTemplateColumns: "auto 1fr",
                gap: "10px 14px",
                margin: 0,
                fontSize: 13,
              }}
            >
              <dt style={{ opacity: 0.55 }}>{t("office.statusLabel")}</dt>
              <dd
                style={{
                  margin: 0,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: selectedStatusColor,
                  }}
                />
                {t(`office.status_${selectedAgent.status}`)}
              </dd>

              <dt style={{ opacity: 0.55 }}>{t("office.modelLabel")}</dt>
              <dd style={{ margin: 0, wordBreak: "break-word" }}>
                {selectedAgent.model || "—"}
              </dd>

              <dt style={{ opacity: 0.55 }}>{t("office.providerLabel")}</dt>
              <dd style={{ margin: 0, wordBreak: "break-word" }}>
                {selectedAgent.provider || "—"}
              </dd>

              <dt style={{ opacity: 0.55 }}>{t("office.gatewayLabel")}</dt>
              <dd style={{ margin: 0 }}>
                {selectedAgent.gatewayRunning
                  ? t("office.gatewayRunning")
                  : t("office.gatewayStopped")}
              </dd>

              <dt style={{ opacity: 0.55 }}>Reason</dt>
              <dd style={{ margin: 0 }}>{selectedAgent.stateReason || "—"}</dd>

              <dt style={{ opacity: 0.55 }}>Recent work</dt>
              <dd style={{ margin: 0 }}>
                {selectedAgent.recentSessionCount ?? 0} sessions ·{" "}
                {selectedAgent.recentMessageCount ?? 0} messages
              </dd>

              <dt style={{ opacity: 0.55 }}>Tasks</dt>
              <dd style={{ margin: 0 }}>
                {selectedAgent.kanban?.running ?? 0} running ·{" "}
                {selectedAgent.kanban?.blocked ?? 0} blocked
              </dd>

              <dt style={{ opacity: 0.55 }}>Platforms</dt>
              <dd style={{ margin: 0 }}>
                {selectedAgent.platforms?.connected ?? 0} connected ·{" "}
                {selectedAgent.platforms?.error ?? 0} errors
              </dd>
            </dl>

            {selectedStatusRows.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.75 }}>
                  Operational details
                </div>
                {selectedStatusRows.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      padding: "7px 9px",
                      borderRadius: 8,
                      background:
                        row.severity === "error"
                          ? "rgba(239,68,68,0.14)"
                          : row.severity === "warning"
                            ? "rgba(245,158,11,0.14)"
                            : row.severity === "active"
                              ? "rgba(34,197,94,0.14)"
                              : "rgba(255,255,255,0.06)",
                    }}
                  >
                    <span style={{ fontSize: 12, opacity: 0.65 }}>
                      {row.label}
                    </span>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        textAlign: "right",
                      }}
                    >
                      {row.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div
              style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}
            >
              {selectedActions.map((action) => (
                <button
                  key={action.id}
                  type="button"
                  disabled={
                    Boolean(action.disabled) || actionBusy === action.id
                  }
                  onClick={() => void handleAgentAction(action)}
                  title={
                    action.disabled
                      ? "Navigation is not available in this view yet"
                      : action.label
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "9px 12px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background:
                      action.kind === "chat"
                        ? "rgba(59,130,246,0.22)"
                        : "rgba(255,255,255,0.07)",
                    color: action.disabled
                      ? "rgba(255,255,255,0.35)"
                      : "rgba(255,255,255,0.9)",
                    cursor: action.disabled ? "not-allowed" : "pointer",
                    fontSize: 13,
                    fontWeight: 650,
                  }}
                >
                  {action.kind === "chat" ? (
                    <MessageCircle size={14} />
                  ) : action.kind === "restartGateway" ? (
                    <Power size={14} />
                  ) : null}
                  {actionBusy === action.id ? "Working…" : action.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setCeo(selectedIsCeo ? null : selectedAgent.id)}
              style={{
                marginTop: 8,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                padding: "10px 14px",
                borderRadius: 10,
                border: selectedIsCeo
                  ? "1px solid rgba(255,255,255,0.18)"
                  : "1px solid rgba(245,158,11,0.5)",
                background: selectedIsCeo
                  ? "transparent"
                  : "rgba(245,158,11,0.16)",
                color: selectedIsCeo ? "rgba(255,255,255,0.85)" : "#fbbf24",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <Crown size={15} />
              {selectedIsCeo ? t("office.removeCeo") : t("office.makeCeo")}
            </button>
          </aside>
        )}

        {!loading && agents.length === 0 && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              opacity: 0.6,
              fontSize: 14,
            }}
          >
            {t("office.noAgents")}
          </div>
        )}
      </div>
    </div>
  );
}

export default Office;
