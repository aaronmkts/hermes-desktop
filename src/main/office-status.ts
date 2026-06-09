import type { OrionBuildStatus } from "./updater-guard";

type ConnectionMode = "local" | "remote" | "ssh";

export type OfficeAgentState =
  | "active"
  | "available"
  | "idle"
  | "offline"
  | "error"
  | "waiting";

export interface OfficeKanbanCounts {
  todo: number;
  ready: number;
  running: number;
  blocked: number;
  doneRecent: number;
}

export interface OfficePlatformCounts {
  connected: number;
  error: number;
  configured: number;
}

export interface OfficeProfileStatus {
  id: string;
  displayName: string;
  description?: string | null;
  personality?: string | null;
  model?: string | null;
  provider?: string | null;
  gatewayRunning: boolean;
  state: OfficeAgentState;
  stateReason: string;
  activeSessionId?: string | null;
  recentSessionCount: number;
  recentMessageCount: number;
  lastInteractionAt?: number | null;
  kanban: OfficeKanbanCounts;
  platforms: OfficePlatformCounts;
}

export interface OfficeStatus {
  source: "local" | "ssh" | "remote";
  generatedAt: number;
  activeProfile?: string | null;
  build: OrionBuildStatus;
  gateway: {
    running: boolean;
    connectedPlatforms: number;
    errorPlatforms: number;
    configuredPlatforms: number;
  };
  providers: {
    codexConfigured: boolean;
    codexSource?: string | null;
    honchoConfigured: boolean;
    honchoSource?: string | null;
  };
  profiles: OfficeProfileStatus[];
  system: { warningCount: number; warnings: string[] };
}

export interface OfficeStatusDependencies {
  now?: () => number;
  getConnectionConfig?: () => { mode?: ConnectionMode; ssh?: unknown };
  getBuildStatus?: () => OrionBuildStatus;
  listProfiles?: (profile?: string) => Promise<OfficeProfileInput[]> | OfficeProfileInput[];
  gatewayStatus?: (profile?: string) => Promise<boolean> | boolean;
  readPlatformStates?: (profile?: string) => Promise<Record<string, unknown>> | Record<string, unknown>;
  getProviderCredentialStatus?: (provider: string, profile?: string) => Promise<ProviderStatusInput> | ProviderStatusInput;
  listSessions?: (profile?: string) => Promise<OfficeSessionInput[]> | OfficeSessionInput[];
  listKanbanTasks?: (profile?: string) => Promise<OfficeKanbanTaskInput[]> | OfficeKanbanTaskInput[];
}

export interface OfficeProfileInput {
  name?: string;
  id?: string;
  isActive?: boolean;
  model?: string | null;
  provider?: string | null;
  gatewayRunning?: boolean;
  display_name?: string | null;
  description?: string | null;
  personality?: string | null;
  display?: { name?: string | null; description?: string | null; personality?: string | null };
}

export interface OfficeSessionInput {
  id?: string;
  sessionId?: string;
  updatedAt?: number | string | null;
  startedAt?: number | string | null;
  endedAt?: number | string | null;
  lastInteractionAt?: number | string | null;
  messageCount?: number | null;
  message_count?: number | null;
}

export interface OfficeKanbanTaskInput {
  status?: string | null;
  completed_at?: number | null;
  completedAt?: number | null;
}

interface ProviderStatusInput {
  configured?: boolean;
  source?: string | null;
}

const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000;
const EMPTY_KANBAN: OfficeKanbanCounts = {
  todo: 0,
  ready: 0,
  running: 0,
  blocked: 0,
  doneRecent: 0,
};

export function reduceOfficeAgentState(input: {
  gatewayRunning: boolean;
  now: number;
  lastInteractionAt?: number | null;
  kanban?: Partial<OfficeKanbanCounts> | null;
  platformErrors?: number;
  connectedPlatforms?: number;
  authError?: boolean;
  gatewayError?: boolean;
  offline?: boolean;
}): { state: OfficeAgentState; stateReason: string } {
  const kanban = { ...EMPTY_KANBAN, ...(input.kanban ?? {}) };
  if (input.offline) return { state: "offline", stateReason: "Remote gateway is unreachable" };
  const platformErrors = input.platformErrors ?? 0;
  const connectedPlatforms = input.connectedPlatforms ?? 0;
  if (input.authError || input.gatewayError || (platformErrors > 0 && connectedPlatforms === 0)) {
    return { state: "error", stateReason: "Platform or authentication error" };
  }
  const recent =
    typeof input.lastInteractionAt === "number" &&
    input.now - input.lastInteractionAt <= ACTIVE_THRESHOLD_MS;
  if (recent || kanban.running > 0) {
    return { state: "active", stateReason: recent ? "Recent session activity" : "Running task" };
  }
  if (kanban.blocked > 0) return { state: "waiting", stateReason: "Blocked task needs attention" };
  if (input.gatewayRunning) {
    return {
      state: "available",
      stateReason: connectedPlatforms > 0
        ? `Gateway online with ${connectedPlatforms} connected platform${connectedPlatforms === 1 ? "" : "s"}`
        : "Gateway online and ready",
    };
  }
  return { state: "idle", stateReason: "Gateway is not running" };
}

export function resolveOfficeProfileMetadata(
  id: string,
  profile: OfficeProfileInput,
): Pick<OfficeProfileStatus, "displayName" | "description" | "personality"> {
  const displayName =
    clean(profile.display_name) ?? clean(profile.display?.name) ?? prettifyProfileKey(id);
  const description =
    clean(profile.description) ?? clean(profile.display?.description) ?? clean(profile.display?.personality) ?? null;
  const personality = clean(profile.personality) ?? clean(profile.display?.personality) ?? null;
  return { displayName, description, personality };
}

function clean(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function prettifyProfileKey(key: string): string {
  return key.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function toEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function summarizeSessions(sessions: OfficeSessionInput[], now: number) {
  const recent = sessions
    .map((s) => ({
      s,
      at: toEpochMs(s.lastInteractionAt ?? s.updatedAt ?? s.endedAt ?? s.startedAt),
    }))
    .filter((x): x is { s: OfficeSessionInput; at: number } => typeof x.at === "number")
    .sort((a, b) => b.at - a.at);
  const within = recent.filter((x) => now - x.at <= ACTIVE_THRESHOLD_MS);
  return {
    activeSessionId: (within[0]?.s.id ?? within[0]?.s.sessionId ?? null) as string | null,
    recentSessionCount: within.length,
    recentMessageCount: within.reduce(
      (sum, x) => sum + Number(x.s.messageCount ?? x.s.message_count ?? 0),
      0,
    ),
    lastInteractionAt: recent[0]?.at ?? null,
  };
}

function summarizeKanban(tasks: OfficeKanbanTaskInput[], now: number): OfficeKanbanCounts {
  const counts = { ...EMPTY_KANBAN };
  for (const task of tasks) {
    const status = String(task.status ?? "").toLowerCase();
    if (status === "todo") counts.todo++;
    if (status === "ready") counts.ready++;
    if (status === "running") counts.running++;
    if (status === "blocked") counts.blocked++;
    if (["done", "completed", "closed"].includes(status)) {
      const doneAt = toEpochMs(task.completedAt ?? task.completed_at);
      if (doneAt && now - doneAt <= 24 * 60 * 60 * 1000) counts.doneRecent++;
    }
  }
  return counts;
}

function summarizePlatforms(states: Record<string, unknown>): OfficePlatformCounts {
  const counts: OfficePlatformCounts = { connected: 0, error: 0, configured: 0 };
  for (const state of Object.values(states)) {
    const s = state as {
      configured?: boolean;
      connected?: boolean;
      state?: string | null;
      error_code?: string | null;
      error_message?: string | null;
    };
    if (s.configured !== false) counts.configured++;
    if (s.connected === true || s.state === "connected" || s.state === "running") counts.connected++;
    if (s.error_code || s.error_message || s.state === "error") counts.error++;
  }
  return counts;
}

async function callSafely<T>(fn: () => T | Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

const REQUIRED_DEPENDENCY_KEYS: (keyof OfficeStatusDependencies)[] = [
  "now",
  "getConnectionConfig",
  "getBuildStatus",
  "listProfiles",
  "gatewayStatus",
  "readPlatformStates",
  "getProviderCredentialStatus",
  "listSessions",
  "listKanbanTasks",
];

function hasCompleteOfficeStatusDependencies(
  deps: OfficeStatusDependencies,
): deps is Required<OfficeStatusDependencies> {
  return REQUIRED_DEPENDENCY_KEYS.every((key) => typeof deps[key] === "function");
}

async function resolveOfficeStatusDependencies(
  deps: OfficeStatusDependencies,
): Promise<Required<OfficeStatusDependencies>> {
  if (hasCompleteOfficeStatusDependencies(deps)) return deps;
  const defaults = await getDefaultOfficeStatusDependencies();
  return { ...defaults, ...deps } as Required<OfficeStatusDependencies>;
}

export async function getOfficeStatus(
  profile?: string,
  deps: OfficeStatusDependencies = {},
): Promise<OfficeStatus> {
  const d = await resolveOfficeStatusDependencies(deps);
  const now = d.now();
  const conn = d.getConnectionConfig();
  const source = conn.mode === "ssh" ? "ssh" : conn.mode === "remote" ? "remote" : "local";
  const [profiles, gatewayRunning, platformStates, codex, honcho] = await Promise.all([
    callSafely(() => d.listProfiles(profile), []),
    callSafely(() => d.gatewayStatus(profile), false),
    callSafely(() => d.readPlatformStates(profile), {}),
    callSafely(() => d.getProviderCredentialStatus("openai-codex", profile), { configured: false, source: "missing" }),
    callSafely(() => d.getProviderCredentialStatus("honcho", profile), { configured: false, source: "missing" }),
  ]);
  const platformCounts = summarizePlatforms(platformStates);
  const outputProfiles: OfficeProfileStatus[] = [];
  for (const p of profiles) {
    const id = p.name ?? p.id ?? "default";
    const [sessions, tasks] = await Promise.all([
      callSafely(() => d.listSessions(id), []),
      callSafely(() => d.listKanbanTasks(id), []),
    ]);
    const sessionSummary = summarizeSessions(sessions, now);
    const kanban = summarizeKanban(tasks, now);
    const profilePlatformCounts = profile === id || profiles.length === 1 ? platformCounts : { connected: 0, error: 0, configured: 0 };
    const profileGatewayRunning = Boolean(p.gatewayRunning ?? gatewayRunning);
    const reduction = reduceOfficeAgentState({
      gatewayRunning: profileGatewayRunning,
      now,
      lastInteractionAt: sessionSummary.lastInteractionAt,
      kanban,
      platformErrors: profilePlatformCounts.error,
      connectedPlatforms: profilePlatformCounts.connected,
    });
    outputProfiles.push({
      id,
      ...resolveOfficeProfileMetadata(id, p),
      model: p.model ?? null,
      provider: p.provider ?? null,
      gatewayRunning: profileGatewayRunning,
      ...reduction,
      ...sessionSummary,
      kanban,
      platforms: profilePlatformCounts,
    });
  }
  const activeProfile =
    outputProfiles.find((p) => profiles.find((raw) => (raw.name ?? raw.id) === p.id)?.isActive)?.id ??
    outputProfiles[0]?.id ??
    null;
  return {
    source,
    generatedAt: now,
    activeProfile,
    build: d.getBuildStatus(),
    gateway: {
      running: Boolean(gatewayRunning),
      connectedPlatforms: platformCounts.connected,
      errorPlatforms: platformCounts.error,
      configuredPlatforms: platformCounts.configured,
    },
    providers: {
      codexConfigured: Boolean(codex.configured),
      codexSource: codex.source ?? null,
      honchoConfigured: Boolean(honcho.configured),
      honchoSource: honcho.source ?? null,
    },
    profiles: outputProfiles,
    system: { warningCount: 0, warnings: [] },
  };
}

async function getDefaultOfficeStatusDependencies(): Promise<Required<OfficeStatusDependencies>> {
  const [config, profiles, updater, hermes, messaging, sessions, kanban, ssh] = await Promise.all([
    import("./config"),
    import("./profiles"),
    import("./updater-guard"),
    import("./hermes"),
    import("./messaging-platforms"),
    import("./sessions"),
    import("./kanban"),
    import("./ssh-remote"),
  ]);
  return {
    now: () => Date.now(),
    getConnectionConfig: config.getConnectionConfig,
    getBuildStatus: () => updater.getOrionBuildStatus(null),
    listProfiles: async () => {
      const conn = config.getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) return ssh.sshListProfiles(conn.ssh) as Promise<OfficeProfileInput[]>;
      return profiles.listProfiles() as Promise<OfficeProfileInput[]>;
    },
    gatewayStatus: async () => {
      const conn = config.getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) return ssh.sshGatewayStatus(conn.ssh);
      return hermes.isGatewayRunning();
    },
    readPlatformStates: async (p?: string) => {
      const conn = config.getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) return ssh.sshReadGatewayPlatformStates(conn.ssh, p);
      return messaging.readLocalGatewayPlatformStates(p, hermes.isGatewayRunning());
    },
    getProviderCredentialStatus: async (provider: string, p?: string) => {
      const conn = config.getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) return ssh.sshGetProviderCredentialStatus(conn.ssh, provider, p);
      return config.getProviderCredentialStatus(provider, p);
    },
    listSessions: async (p?: string) => {
      const conn = config.getConnectionConfig();
      if (conn.mode === "ssh" && conn.ssh) return ssh.sshListSessions(conn.ssh, 30, 0, p) as Promise<OfficeSessionInput[]>;
      return sessions.listSessions(30, 0) as OfficeSessionInput[];
    },
    listKanbanTasks: async (p?: string) => {
      const res = await kanban.listTasks({ profile: p, includeArchived: false });
      return (res.success ? res.data ?? [] : []) as OfficeKanbanTaskInput[];
    },
  };
}
