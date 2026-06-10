import { Crown, MessageCircle, Power, X } from "lucide-react";
import type { OfficeAgent } from "./office3d/core/types";
import type { OfficeAgentActionDescriptor, OfficeAgentStatusRow } from "./officeActions";

export interface OfficeDetailsPanelProps {
  agent: OfficeAgent;
  isCeo: boolean;
  statusColor: string;
  statusRows: OfficeAgentStatusRow[];
  actions: OfficeAgentActionDescriptor[];
  actionBusy: string | null;
  onClose: () => void;
  onAction: (action: OfficeAgentActionDescriptor) => void;
  onToggleCeo: () => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
}

function rowBackground(severity?: OfficeAgentStatusRow["severity"]): string {
  if (severity === "error") return "rgba(239,68,68,0.14)";
  if (severity === "warning") return "rgba(245,158,11,0.14)";
  if (severity === "active") return "rgba(34,197,94,0.14)";
  return "rgba(255,255,255,0.06)";
}

export default function OfficeDetailsPanel({
  agent,
  isCeo,
  statusColor,
  statusRows,
  actions,
  actionBusy,
  onClose,
  onAction,
  onToggleCeo,
  t,
}: OfficeDetailsPanelProps): React.JSX.Element {
  return (
    <aside
      aria-label="Office details panel"
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
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: 4, background: agent.color, flex: "0 0 auto" }} />
          <span style={{ fontWeight: 700, fontSize: 16 }}>{agent.name}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("office.close")}
          title={t("office.close")}
          style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 4, borderRadius: 6, border: "none", background: "transparent", color: "rgba(255,255,255,0.7)", cursor: "pointer" }}
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
          background: isCeo ? "rgba(245,158,11,0.18)" : "rgba(255,255,255,0.08)",
          color: isCeo ? "#fbbf24" : "rgba(255,255,255,0.85)",
        }}
      >
        {isCeo && <Crown size={13} />}
        {isCeo ? t("office.ceo") : t("office.employee")}
      </div>

      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px 14px", margin: 0, fontSize: 13 }}>
        <dt style={{ opacity: 0.55 }}>{t("office.statusLabel")}</dt>
        <dd style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: 999, background: statusColor }} />
          {t(`office.status_${agent.status}`)}
        </dd>
        <dt style={{ opacity: 0.55 }}>{t("office.modelLabel")}</dt>
        <dd style={{ margin: 0, wordBreak: "break-word" }}>{agent.model || "—"}</dd>
        <dt style={{ opacity: 0.55 }}>{t("office.providerLabel")}</dt>
        <dd style={{ margin: 0, wordBreak: "break-word" }}>{agent.provider || "—"}</dd>
        <dt style={{ opacity: 0.55 }}>{t("office.gatewayLabel")}</dt>
        <dd style={{ margin: 0 }}>{agent.gatewayRunning ? t("office.gatewayRunning") : t("office.gatewayStopped")}</dd>
        <dt style={{ opacity: 0.55 }}>Reason</dt>
        <dd style={{ margin: 0 }}>{agent.stateReason || "—"}</dd>
        <dt style={{ opacity: 0.55 }}>Recent work</dt>
        <dd style={{ margin: 0 }}>{agent.recentSessionCount ?? 0} sessions · {agent.recentMessageCount ?? 0} messages</dd>
        <dt style={{ opacity: 0.55 }}>Tasks</dt>
        <dd style={{ margin: 0 }}>{agent.kanban?.running ?? 0} running · {agent.kanban?.blocked ?? 0} blocked</dd>
        <dt style={{ opacity: 0.55 }}>Platforms</dt>
        <dd style={{ margin: 0 }}>{agent.platforms?.connected ?? 0} connected · {agent.platforms?.error ?? 0} errors · {agent.platforms?.configured ?? 0} configured</dd>
      </dl>

      {statusRows.length > 0 && (
        <section aria-label="Workload" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.75 }}>Operational details</div>
          {statusRows.map((row) => (
            <div key={row.label} aria-label={row.severity === "warning" ? row.label : undefined} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 9px", borderRadius: 8, background: rowBackground(row.severity) }}>
              <span style={{ fontSize: 12, opacity: 0.65 }}>{row.label}</span>
              <span style={{ fontSize: 12, fontWeight: 700, textAlign: "right" }}>{row.value}</span>
            </div>
          ))}
        </section>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            disabled={Boolean(action.disabled) || actionBusy === action.id}
            onClick={() => onAction(action)}
            title={action.disabled ? "Navigation is not available in this view yet" : action.label}
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "9px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.14)", background: action.kind === "chat" ? "rgba(59,130,246,0.22)" : "rgba(255,255,255,0.07)", color: action.disabled ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.9)", cursor: action.disabled ? "not-allowed" : "pointer", fontSize: 13, fontWeight: 650 }}
          >
            {action.kind === "chat" ? <MessageCircle size={14} /> : action.kind === "restartGateway" ? <Power size={14} /> : null}
            {actionBusy === action.id ? "Working…" : action.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onToggleCeo}
        style={{ marginTop: 8, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 14px", borderRadius: 10, border: isCeo ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(245,158,11,0.5)", background: isCeo ? "transparent" : "rgba(245,158,11,0.16)", color: isCeo ? "rgba(255,255,255,0.85)" : "#fbbf24", cursor: "pointer", fontSize: 13, fontWeight: 600 }}
      >
        <Crown size={15} />
        {isCeo ? t("office.removeCeo") : t("office.makeCeo")}
      </button>
    </aside>
  );
}
