# ORION Office 3D Workspace Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Keep legacy external Claw3D as optional/advanced; do not make it a dependency of the main Office experience.

**Goal:** Turn Hermes One's built-in Office tab into the primary VPS-aware ORION 3D workspace/operator console.

**Architecture:** Replace the current ad hoc Office data loading (`listProfiles`, `gatewayStatus`, provider checks) with a single SSH-aware `get-office-status` read model. The renderer maps this read model into avatar state, operator cards, agent side panels, and OneChat behaviour. The VPS remains canonical for secrets, profiles, sessions, gateway, providers, memory, task/cron state, and runtime activity.

**Tech Stack:** Electron main/preload IPC, TypeScript, React, React Three Fiber, Hermes Agent CLI/API over SSH tunnel, local/SSH read-model helpers, Vitest.

---

## Current Baseline

The current Office tab is native/in-renderer:

- `src/renderer/src/screens/Office/Office.tsx`
- `src/renderer/src/screens/Office/office3d/*`
- `src/renderer/src/screens/Office/OneChatModal.tsx`

It currently derives most agent state from `listProfiles()` and treats `profile.gatewayRunning` as `working`. That is too shallow. In ORION's VPS architecture, the Office should be a real operational read model over remote state, not just a profile visualiser.

Legacy Claw3D/hermes-office code still exists in:

- `src/main/claw3d.ts`
- `src/main/office-start.ts`
- `src/main/kanban.ts` Claw3D HQ mirror

But legacy Claw3D is not the main Office experience. It should be moved toward Advanced/External visualisation later.

---

## Non-goals

- Do not install or depend on external Claw3D/hermes-office for the main Office tab.
- Do not expose VPS ports publicly.
- Do not move secrets from the VPS to the laptop/renderer.
- Do not rename stable internal profile keys destructively.
- Do not make Office execute destructive actions without explicit user confirmation.

---

## Desired Office Model

Office should represent ORION as a 3D workspace:

- Profiles are rooms/agents/workstations.
- Agent status reflects actual operational state, not merely gateway-running.
- Operator cards summarize build, gateway, providers, memory, tasks, and session activity.
- OneChat routes to selected VPS profile and can recover/start the remote gateway when needed.
- Agent side panels expose practical actions: chat, restart gateway, open sessions, open Kanban, open provider config, open logs.

---

## Data Plan

### New IPC endpoint

Create:

```ts
window.hermesAPI.getOfficeStatus(profile?: string): Promise<OfficeStatus>
```

Main handler:

```ts
ipcMain.handle("office-status", async (_event, profile?: string) => getOfficeStatus(profile));
```

Preload:

```ts
getOfficeStatus: (profile?: string) => ipcRenderer.invoke("office-status", profile)
```

### New files

Create:

- `src/main/office-status.ts`
- `tests/office-status.test.ts`

Optional renderer type helper:

- `src/renderer/src/screens/Office/officeStatus.ts`

### Type shape

```ts
export type OfficeAgentState =
  | "active"
  | "available"
  | "idle"
  | "offline"
  | "error"
  | "waiting";

export interface OfficeProfileStatus {
  id: string;              // stable internal profile key
  displayName: string;     // UI label from metadata or prettified key
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
  lastInteractionAt?: number | null; // epoch ms
  kanban: {
    todo: number;
    ready: number;
    running: number;
    blocked: number;
    doneRecent: number;
  };
  platforms: {
    connected: number;
    error: number;
    configured: number;
  };
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
  system: {
    warningCount: number;
    warnings: string[];
  };
}
```

### Data sources

Use existing SSH-aware helpers where available:

- Profiles: `listProfiles()` / `sshListProfiles()`
- Gateway state: `gatewayStatus()` / `sshGatewayStatus()`
- Platform state: `getMessagingPlatforms(profile)` logic / `sshReadGatewayPlatformStates()`
- Providers: `getProviderCredentialStatus("openai-codex")`, `getProviderCredentialStatus("honcho")`
- Sessions: local `getSessionMessages()` plus SSH equivalent already used by sessions IPC; add narrow session summary helper if needed.
- Kanban: existing kanban list APIs where feasible; initially use task counts only, not full task bodies.

### Status semantics

Do not map gateway-running directly to `working`.

Use:

- `active`: recent session/tool/task activity within the last 5 minutes or running Kanban task.
- `available`: gateway running and credentials healthy, but no active work.
- `idle`: profile exists but gateway inactive/unknown, no error.
- `offline`: remote gateway unreachable or profile cannot be contacted.
- `error`: auth/platform/MCP/gateway error.
- `waiting`: blocked task or pending user action.

Initial implementation can approximate activity using session timestamps + Kanban running counts. Future implementation can add live tool/process events.

---

## Implementation Stages

## Stage 1 — Office read model foundation

### Task 1.1: Add OfficeStatus types and pure status reducer

**Objective:** Define data contract and pure mapping logic before IPC wiring.

**Files:**
- Create: `src/main/office-status.ts`
- Create: `tests/office-status.test.ts`

**Test cases:**

- gateway running + no activity → `available`
- recent message within threshold → `active`
- running Kanban task → `active`
- platform error → `error`
- blocked task → `waiting`
- no gateway and no errors → `idle`

**Verification:**

```bash
npm test -- tests/office-status.test.ts
```

Expected: tests pass after implementation.

### Task 1.2: Implement metadata-friendly display name resolver

**Objective:** Show friendly profile names/personality without changing internal keys.

**Files:**
- Modify: `src/main/office-status.ts`
- Test: `tests/office-status.test.ts`

Resolver order:

1. `profile.display_name`
2. `display.name`
3. prettified internal key

Description/personality order:

1. `profile.description`
2. `display.description`
3. `display.personality`

**Verification:** test raw `quantum_research` becomes `Quantum Research` when no metadata exists.

### Task 1.3: Wire `getOfficeStatus` main IPC

**Objective:** Expose `office-status` from main process.

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/index.d.ts`

**Verification:**

```bash
npm run typecheck
npm test -- tests/office-status.test.ts
```

## Stage 2 — SSH/VPS data aggregation

### Task 2.1: Aggregate profile/gateway/platform/provider state

**Objective:** Build `OfficeStatus` from current SSH-aware read models.

**Files:**
- Modify: `src/main/office-status.ts`
- Test: `tests/office-status.test.ts`

Implementation notes:

- Use connection config to set `source`.
- In SSH mode, call SSH helpers directly or through existing management functions.
- Never include raw secrets.
- Continue returning partial status with warnings if one subsystem fails.

**Verification:** tests simulate partial failure and assert warnings rather than hard failure.

### Task 2.2: Add session summary support

**Objective:** Give Office enough data to distinguish active/available/idle.

**Files:**
- Modify: `src/main/sessions.ts` or create helper in `src/main/office-status.ts`
- Modify: `src/main/ssh-remote.ts` if remote session summary needs SSH query.
- Test: `tests/office-status.test.ts` or `tests/sessions.test.ts`

Suggested helper:

```ts
getRecentSessionSummary(profileId: string): Promise<{
  activeSessionId?: string | null;
  recentSessionCount: number;
  recentMessageCount: number;
  lastInteractionAt?: number | null;
}>
```

For the first version, use messages/sessions from last 24h and last interaction timestamp.

### Task 2.3: Add Kanban count summary

**Objective:** Surface task counts without rendering full Kanban in Office.

**Files:**
- Modify: `src/main/office-status.ts`
- Test: `tests/office-status.test.ts`

Counts:

- todo
- ready
- running
- blocked
- doneRecent

If Kanban unavailable, return zero counts plus warning.

## Stage 3 — Renderer migration

### Task 3.1: Replace Office ad hoc loading with `getOfficeStatus`

**Objective:** Office calls one endpoint instead of multiple independent IPC calls.

**Files:**
- Modify: `src/renderer/src/screens/Office/Office.tsx`
- Modify: `src/renderer/src/screens/Office/office3d/agents.ts`
- Test: add renderer/unit tests if existing pattern supports it.

Behaviour:

- Poll `getOfficeStatus` while visible.
- Store entire `OfficeStatus` in component state.
- Map `OfficeProfileStatus[]` into `OfficeAgent[]`.

### Task 3.2: Update Office agent visual states

**Objective:** Make 3D avatar state reflect `active/available/idle/offline/error/waiting`.

**Files:**
- Modify: `src/renderer/src/screens/Office/office3d/core/types.ts`
- Modify: `src/renderer/src/screens/Office/office3d/agents.ts`
- Modify: `src/renderer/src/screens/Office/office3d/Office3D.tsx`
- Modify: `src/renderer/src/screens/Office/office3d/objects/agents.tsx`

Visual mapping:

- `active`: green, desk/standing/working animation.
- `available`: blue/green, sitting at desk.
- `idle`: amber, lounge/rest room.
- `offline`: grey, dimmed.
- `error`: red badge/pulse.
- `waiting`: purple/amber, waiting animation.

### Task 3.3: Upgrade operator cards

**Objective:** Cards consume `OfficeStatus` instead of ad hoc local state.

**Files:**
- Modify: `src/renderer/src/screens/Office/Office.tsx`

Cards:

- ORION build
- Remote gateway
- Active work
- Provider auth
- Memory
- Platform health
- Kanban task summary

## Stage 4 — OneChat improvement

### Task 4.1: Remove hard offline send block

**Objective:** Let backend recover/start gateway rather than silently blocking user.

**Files:**
- Modify: `src/renderer/src/screens/Office/OneChatModal.tsx`

Current issue:

```ts
if (!target?.gatewayRunning) return;
```

Replace with:

- warning banner if profile appears offline,
- still allow send,
- rely on `send-message` backend recovery,
- show error only if backend fails.

### Task 4.2: Add “Start remote gateway and send” UI state

**Objective:** Make recovery visible instead of silent.

**Files:**
- Modify: `OneChatModal.tsx`
- Possibly add `restartGateway(profile?)` action if not already exposed.

Verification:

- If `gatewayRunning=false`, send button remains enabled but labelled clearly.
- On failure, message shows actionable error.

## Stage 5 — Agent side-panel actions

### Task 5.1: Add action buttons

**Objective:** Turn selected agent panel into an operator control surface.

**Files:**
- Modify: `Office.tsx`

Buttons:

- Chat
- Restart remote gateway
- Open Gateway settings
- Open Providers
- Open Kanban
- Open Sessions/logs where available

If app routing does not support direct navigation yet, wire buttons to existing tab navigation props or add a TODO in plan for route-aware navigation.

### Task 5.2: Add status detail list

**Objective:** Explain why an avatar is active/waiting/error.

Show:

- `stateReason`
- last interaction
- recent sessions/messages
- running/blocked tasks
- platform errors

## Stage 6 — Legacy Claw3D cleanup / advanced mode boundary

### Task 6.1: Rename stale Office copy

**Objective:** Stop implying main Office requires Claw3D.

**Files:**
- Modify: `src/shared/i18n/locales/en/office.ts`
- Optionally update other locales later or keep English fallback.

Replace:

- “Set Up Claw3D” in main Office path
- “Install Claw3D” main CTA

With:

- “ORION Office”
- “Built-in 3D workspace”
- “External Claw3D is optional advanced visualisation.”

### Task 6.2: Add Advanced External Claw3D placeholder/status

**Objective:** Preserve future optionality without polluting main Office.

**Files:**
- Modify: `Settings.tsx` or create advanced section.

Display:

- installed local/remote status
- remote not installed on VPS
- future install/start controls disabled or labelled experimental

No full external Claw3D implementation in this phase.

## Stage 7 — Verification and release

### Task 7.1: Full test gate

Run from `/srv/orion/workspace/hermes-desktop` using Node 22:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
npm test
npm run typecheck
npm run build
npx electron-builder --linux deb
```

### Task 7.2: Runtime smoke checklist

After installing `.deb` locally:

- App starts without onboarding.
- SSH Tunnel mode connects to VPS API port 8642.
- Office cards show VPS ORION state.
- Office avatars use friendly profile labels.
- OneChat can send to default/profile agent.
- Gateway stopped/offline state gives visible recovery action.
- Provider/Honcho status matches VPS credentials.
- No Claw3D install prompt appears in main Office path.

---

## Worktree execution plan

Use remote worktrees under the `orion` user:

```bash
cd /srv/orion/workspace/hermes-desktop
git switch main
git pull --ff-only origin main

git worktree add /srv/orion/worktrees/hermes-office-status -b orion/office-status main
git worktree add /srv/orion/worktrees/hermes-office-renderer -b orion/office-renderer main
git worktree add /srv/orion/worktrees/hermes-office-chat -b orion/office-chat main
git worktree add /srv/orion/worktrees/hermes-office-actions -b orion/office-actions main
git worktree add /srv/orion/worktrees/hermes-office-advanced -b orion/office-advanced main
```

Recommended order:

1. `orion/office-status`: Stages 1–2.
2. `orion/office-renderer`: Stage 3, based on `office-status` when merged.
3. `orion/office-chat`: Stage 4.
4. `orion/office-actions`: Stage 5.
5. `orion/office-advanced`: Stage 6.
6. Integration branch: `orion/office-workspace-integration`.

Commit after each stage and verify before merging.

---

## Acceptance criteria

- Office uses a single `getOfficeStatus` data contract.
- Office is SSH/VPS-aware by design.
- Main Office no longer depends on or markets itself as Claw3D.
- Avatar state reflects meaningful ORION operational status.
- Secrets never leave the VPS or appear in renderer payloads.
- OneChat no longer silently refuses because of stale gateway state.
- Agent panel exposes useful operator actions.
- Full test/typecheck/build/package gate passes.
