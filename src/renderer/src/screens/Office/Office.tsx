import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Move,
  RefreshCw,
  RotateCcw,
  Save,
  Users,
  X,
} from "lucide-react";
import { useI18n } from "../../components/useI18n";
import oneChatIcon from "../../assets/images/one-chat.svg";
import OneChatModal from "./OneChatModal";
import OfficeDetailsPanel from "./OfficeDetailsPanel";
import Office3D from "./office3d/Office3D";
import { buildOperatorCards, officeStatusToAgents } from "./officeStatus";
import type { OfficeAgent } from "./office3d/core/types";
import {
  buildOfficeAgentActions,
  buildOfficeAgentDetailRows,
  buildOfficeAgentStatusRows,
  type OfficeNavigationTarget,
} from "./officeActions";
import type { OfficeStatus } from "../../../../main/office-status";

type Claw3dStatus = Awaited<ReturnType<typeof window.hermesAPI.claw3dStatus>>;
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
  const [claw3dStatus, setClaw3dStatus] = useState<Claw3dStatus | null>(null);
  const [claw3dLoading, setClaw3dLoading] = useState(true);
  const [claw3dBusy, setClaw3dBusy] = useState<"setup" | "start" | null>(null);
  const [claw3dError, setClaw3dError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [designMode, setDesignMode] = useState(false);


  const supportsClaw3d = typeof window.hermesAPI.claw3dStatus === "function";

  const loadClaw3dStatus = useCallback(async () => {
    if (!supportsClaw3d) return;
    setClaw3dLoading(true);
    try {
      const status = await window.hermesAPI.claw3dStatus(profile);
      setClaw3dStatus(status);
      setClaw3dError(status.error || null);
    } catch (error) {
      setClaw3dStatus(null);
      setClaw3dError(error instanceof Error ? error.message : String(error));
    } finally {
      setClaw3dLoading(false);
    }
  }, [profile, supportsClaw3d]);

  useEffect(() => {
    if (visible && supportsClaw3d) {
      void loadClaw3dStatus();
    }
  }, [visible, supportsClaw3d, loadClaw3dStatus]);

  useEffect(() => {
    if (!visible || !supportsClaw3d) return;
    const interval = window.setInterval(() => {
      void loadClaw3dStatus();
    }, 4000);
    return () => window.clearInterval(interval);
  }, [visible, supportsClaw3d, loadClaw3dStatus]);

  const handleClaw3dSetup = useCallback(async () => {
    setClaw3dBusy("setup");
    setClaw3dError(null);
    try {
      const result = await window.hermesAPI.claw3dSetup();
      if (!result.success) setClaw3dError(result.error ?? t("office.setupFailed"));
      await loadClaw3dStatus();
    } finally {
      setClaw3dBusy(null);
    }
  }, [loadClaw3dStatus, t]);

  const handleClaw3dStart = useCallback(async () => {
    setClaw3dBusy("start");
    setClaw3dError(null);
    try {
      const result = await window.hermesAPI.claw3dStartAll(profile);
      if (!result.success) setClaw3dError(result.error ?? t("office.startFailed"));
      await loadClaw3dStatus();
    } finally {
      setClaw3dBusy(null);
    }
  }, [loadClaw3dStatus, profile, t]);

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
    ? (layoutDraft.layout.workstations.find(
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
    ? [
        ...buildOfficeAgentStatusRows(selectedAgent),
        ...buildOfficeAgentDetailRows(selectedAgent),
      ]
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


  if (supportsClaw3d) {
    const installed = Boolean(claw3dStatus?.cloned && claw3dStatus?.installed);
    const running = Boolean(claw3dStatus?.running);
    const runtimeUrl = claw3dStatus?.remoteUrl || (claw3dStatus?.port ? `http://127.0.0.1:${claw3dStatus.port}` : "");

    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%" }}>
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
            <span style={{ fontWeight: 600, fontSize: 15 }}>{t("office.title")}</span>
            <span style={{ fontSize: 12, opacity: 0.6 }}>{t("office.subtitle")}</span>
          </div>
          <button type="button" onClick={() => void loadClaw3dStatus()} disabled={claw3dLoading} title={t("office.refresh")}>
            <RefreshCw size={14} /> {t("office.refresh")}
          </button>
        </header>

        <main style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: running ? 0 : 24 }}>
          {claw3dLoading && !claw3dStatus ? (
            <div role="status">{t("office.checkingStatus")}</div>
          ) : !installed ? (
            <section aria-label="Claw3D setup" style={{ margin: "auto", maxWidth: 680, textAlign: "center" }}>
              <h2>{t("office.setupTitle")}</h2>
              <p>{t("office.setupDesc1")}</p>
              <p>{t("office.setupDesc2")}</p>
              {claw3dError && <p role="alert">{claw3dError}</p>}
              <button type="button" onClick={() => void handleClaw3dSetup()} disabled={claw3dBusy !== null}>
                {claw3dBusy === "setup" ? t("office.starting") : t("office.installClaw3d")}
              </button>
            </section>
          ) : !running ? (
            <section aria-label="Claw3D start" style={{ margin: "auto", maxWidth: 680, textAlign: "center" }}>
              <h2>{t("office.loadingClaw3d")}</h2>
              <p>{t("office.clickToStart")}</p>
              {claw3dError && <p role="alert">{claw3dError}</p>}
              <button type="button" onClick={() => void handleClaw3dStart()} disabled={claw3dBusy !== null || claw3dStatus?.portInUse}>
                {claw3dBusy === "start" ? t("office.starting") : "Start"}
              </button>
            </section>
          ) : (
            <section aria-label="Claw3D runtime" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border, rgba(0,0,0,0.08))" }}>
                <span>{runtimeUrl}</span>
                <a href={runtimeUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> {t("office.openInBrowser")}
                </a>
              </div>
              <iframe title="Claw3D Studio runtime" src={runtimeUrl} style={{ flex: 1, width: "100%", border: 0 }} />
            </section>
          )}
        </main>
      </div>
    );
  }

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
          profile={profile}
          onNavigate={onNavigate}
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
          <OfficeDetailsPanel
            agent={selectedAgent}
            isCeo={selectedIsCeo}
            statusColor={selectedStatusColor}
            statusRows={selectedStatusRows}
            actions={selectedActions}
            actionBusy={actionBusy}
            onClose={() => setSelectedId(null)}
            onAction={(action) => void handleAgentAction(action)}
            onToggleCeo={() => setCeo(selectedIsCeo ? null : selectedAgent.id)}
            t={t}
          />
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
