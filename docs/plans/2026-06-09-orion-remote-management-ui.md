# Hermes One ORION Remote Management UI Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task in isolated git worktrees, then merge through `orion/interface-remote-management` only after verification.

**Goal:** Make Hermes One accurately represent and manage ORION's VPS-backed Hermes runtime in SSH Tunnel mode, while preserving ORION-patched desktop builds and keeping secrets on the VPS.

**Architecture:** Keep ORION-specific behaviour in main-process SSH helpers and small renderer read-model/status components to minimise upstream conflicts. Remote secrets remain in `/root/.hermes` on the VPS; renderer receives masked presence/status only. Office view should expose the same remote-management health/status summary as a calm operator dashboard.

**Tech Stack:** Electron main process TypeScript, React renderer, Vitest, electron-builder, SSH helper layer in `src/main/ssh-remote.ts`.

---

## Stage 1: ORION build updater UX and upstream-monitoring signal

**Objective:** Remove the misleading automatic upstream auto-update failure UX for ORION-patched builds and replace it with clear ORION build status. Add a non-destructive upstream-check status so Aaron can manually choose when to sync/rebuild the fork.

**Files:**
- Modify: `src/main/updater-guard.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/screens/Layout/Layout.tsx`
- Modify/Create: tests around updater guard/Layout behaviour if existing harness allows.
- Optional Office integration: `src/renderer/src/screens/Office/*` or equivalent actual Office view files.

**Implementation notes:**
1. In ORION-patched builds, suppress generic `update-error` events from `electron-updater` unless user explicitly starts a manual desktop update.
2. Renderer should not show bottom-left `Update failed` for the ORION guard message.
3. Show a small status instead:
   - `ORION build`
   - `Desktop updates: manual fork rebuild`
4. Add or expose a read-only upstream status endpoint if straightforward:
   - compare local fork branch against `upstream/main` using git on the repo if available,
   - display only “upstream changes available” / “up to date” / “unknown”, not auto-merge.
5. Office view should include this as a compact card: `Desktop build: ORION-patched · Manual updates`.

**Acceptance criteria:**
- ORION-patched build does not show persistent `Update failed` from upstream auto-updater.
- User can still run `hermes update` separately for the VPS Agent.
- UI makes clear that app updates are through fork sync + `.deb` install.
- Office view contains ORION build/update status.

**Verification:**
```bash
npm test -- <focused updater/layout tests>
npm run typecheck
npm run build
```

---

## Stage 2: Full remote gateway runtime reporting and remote restart UX

**Objective:** Gateway platform cards/tests in SSH Tunnel mode should use remote VPS runtime state, not only config/env presence.

**Files:**
- Modify: `src/main/ssh-remote.ts`
- Modify: `src/main/index.ts`
- Modify: `src/shared/messaging-platforms.ts` only if wording/state model needs refinement.
- Modify: `src/renderer/src/screens/Gateway/Gateway.tsx`
- Modify/Add: `tests/ssh-remote.test.ts`, `src/shared/messaging-platforms.test.ts`, `src/renderer/src/screens/Gateway/Gateway.test.tsx`

**Implementation notes:**
1. Add SSH equivalent of local gateway state reader:
   - `sshReadGatewayPlatformStates(config, profile?)`
   - read remote `gateway_state.json` from the selected profile home.
   - map aliases like `homeassistant` → `home_assistant`, `webhook` → `webhooks` just like local mode.
   - fail closed to `{}` without throwing if file is missing/malformed.
2. Pass remote platform states into `buildDesktopMessagingPlatforms(...)` for:
   - `get-messaging-platforms`
   - `test-messaging-platform`
3. Gateway UI should show accurate state/error when remote state exists.
4. After saving platform keys, provide a **Restart remote gateway** button in SSH mode.
   - It should call existing `restart-gateway` IPC.
   - Label clearly: `Restart remote gateway`.
   - Do not auto-restart silently after every secret edit unless already established behaviour is safe.
5. Make copy explicit: `Secrets are stored on the VPS and masked locally`.

**Acceptance criteria:**
- A connected remote Telegram/API/etc platform tests as connected when remote state says connected.
- A remote platform error surfaces actual `error_message` from VPS `gateway_state.json`.
- Saving a key does not expose the key in renderer state or logs.
- SSH mode Gateway page has a visible remote restart control.
- Office view has a compact remote gateway status card.

**Verification:**
```bash
npm test -- tests/ssh-remote.test.ts src/shared/messaging-platforms.test.ts src/renderer/src/screens/Gateway/Gateway.test.tsx
npm run typecheck
npm run build
```

---

## Stage 3: SSH-aware credential pool/OAuth Providers UI

**Objective:** Providers/OAuth cards should reflect VPS-side `auth.json` in SSH Tunnel mode, especially `openai-codex`, and write credentials to the VPS profile auth store rather than local Desktop state.

**Files:**
- Modify: `src/main/ssh-remote.ts`
- Modify: `src/main/index.ts`
- Modify: `src/renderer/src/screens/Providers/Providers.tsx`
- Modify: `src/preload/index.ts`, `src/preload/index.d.ts` only if API shape changes.
- Add tests for SSH credential pool handlers.

**Implementation notes:**
1. Add SSH helpers:
   - `sshGetCredentialPool(config, profile?)`
   - `sshSetCredentialPool(config, provider, entries, profile?)`
   - `sshAddCredentialPoolEntry(config, provider, apiKey, label, profile?)`
   - Possibly `sshHasAuthProvider(config, provider, profile?)` or reuse `sshHasOAuthCredentials`.
2. Main IPC handlers must branch on SSH mode for:
   - `get-credential-pool`
   - `set-credential-pool`
   - `add-credential-pool-entry`
3. Renderer must pass `profile` into credential pool calls; current calls omit it.
4. OAuth cards should show signed-in status when VPS `auth.json` contains usable provider credentials.
5. For `openai-codex`, show `Signed in on VPS` when detected.
6. OAuth sign-in flow should be reviewed separately before attempting remote browser/device-code support. Do not fake sign-in status.

**Acceptance criteria:**
- In SSH mode, Codex status comes from VPS `/root/.hermes/auth.json`.
- Providers screen does not imply Aaron must re-sign into Codex when VPS auth exists.
- Adding/removing credential pool entries in SSH mode writes to VPS profile auth store.
- Secrets are never printed or sent back raw except user-entered input during save.
- Office view includes provider/auth readiness card: e.g. `Codex: signed in on VPS`.

**Verification:**
```bash
npm test -- tests/ssh-remote.test.ts <provider tests if present>
npm run typecheck
npm run build
```

---

## Stage 4: Provider-specific secret detection, especially Honcho

**Objective:** Tool API Keys / Providers UI should understand credentials stored outside `.env`, especially Honcho configured through `honcho.json`.

**Files:**
- Modify: `src/main/ssh-remote.ts`
- Modify: `src/main/index.ts` or provider/config metadata layer.
- Modify: `src/renderer/src/screens/Providers/Providers.tsx`
- Modify: `src/renderer/src/constants.ts` if metadata supports multiple credential sources.
- Tests for Honcho detection in SSH and local paths.

**Implementation notes:**
1. Add credential source detection API returning masked status, not values:
   ```ts
   type CredentialSourceStatus = {
     key: string;
     configured: boolean;
     source: "env" | "auth.json" | "honcho.json" | "missing";
     locationLabel: string;
   }
   ```
2. Honcho detection:
   - `.env` `HONCHO_API_KEY` counts as configured via env.
   - `honcho.json` with `apiKey` or equivalent counts as configured via honcho.json.
3. UI should render:
   - `Configured via honcho.json on VPS`
   - not `missing`.
4. Extend pattern so future tool keys can have provider-specific status without leaking secrets.
5. Office view should surface memory provider/auth readiness: `Honcho: configured via honcho.json`.

**Acceptance criteria:**
- Honcho does not appear missing when `/root/.hermes/honcho.json` is valid.
- UI still allows adding/updating `.env` keys when appropriate.
- Detection works in SSH mode and local mode.
- No raw secret values are exposed.

**Verification:**
```bash
npm test -- tests/ssh-remote.test.ts <provider/credential-status tests>
npm run typecheck
npm run build
```

---

## Stage 5: Office view integration

**Objective:** The Office view should become the high-level operator dashboard for ORION remote-management health.

**Files:**
- Inspect actual Office view files under `src/renderer/src/screens/Office` or current route map.
- Modify/create Office status cards using existing IPC data; avoid duplicating logic.

**Cards to add:**
1. **ORION build**
   - patched build/manual updates
   - upstream status if available
2. **Remote gateway**
   - gateway running/stopped
   - platform count connected/error/configured
   - button/link to Gateway screen
3. **Providers/Auth**
   - active model/provider
   - Codex OAuth signed-in status on VPS
   - missing critical credentials only when actually missing remotely
4. **Memory**
   - Honcho configured source/status

**Acceptance criteria:**
- Office view provides useful situational awareness without exposing secrets.
- Cards deep-link or navigate to existing detailed screens where possible.
- Uses same IPC/read-model functions as Settings/Gateway/Providers.

**Verification:**
```bash
npm test -- <office tests if present>
npm run typecheck
npm run build
```

---

## Integration gate

After worktree lanes complete:

```bash
cd /srv/orion/workspace/hermes-desktop
git switch orion/interface-remote-management
# merge selected worktree branches one by one, resolve conflicts deliberately
npm test
npm run typecheck
npm run build
npx eslint src/main/ssh-remote.ts src/main/index.ts src/renderer/src/screens/Gateway/Gateway.tsx src/renderer/src/screens/Providers/Providers.tsx
npx electron-builder --linux deb
```

Do not install the `.deb` until integration verification passes.
