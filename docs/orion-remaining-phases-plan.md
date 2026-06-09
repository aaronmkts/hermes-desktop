# ORION VPS Control-Plane Remaining Phases Plan

Base branch: `orion-vps-control-plane`

Goal: make Hermes One SSH Tunnel mode consistently operate against the ORION VPS `/root/.hermes` source of truth while keeping the fork small and easy to rebase onto `fathah/hermes-desktop`.

## Global constraints

- Preserve local mode and HTTP remote mode semantics unless explicitly fixing SSH Tunnel mode.
- Prefer main-process transport/helper patches over renderer rewrites.
- Keep branch changes small and isolated by feature area.
- Never expose raw secrets to the renderer; env/API-key UI should receive presence/masked metadata only.
- Keep local launcher name `orion-desktop`; package rename/branding is out of scope.
- Tests must assert SSH-mode behaviour and local-mode non-regression where possible.
- Node toolchain in ORION workspace: `export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH`.

## Lane 1 — Model config and validation banners

### Problem
The app can show `No model selected` even when the remote ORION VPS has a valid `model:` block. SSH Tunnel mode must validate the remote profile config, not local app state.

### Target files
- `src/main/config.ts`
- `src/main/models.ts`
- `src/main/model-discovery.ts`
- possibly `src/main/index.ts`
- Tests: `tests/config-model-block.test.ts`, `tests/set-model-config-base-url.test.ts`, new SSH-model test if needed.

### Expected behaviour
In SSH mode:
- Read `model:` from remote `$HOME/.hermes/config.yaml` or `$HOME/.hermes/profiles/<profile>/config.yaml` via SSH.
- Model read/list UI reflects remote config.
- Model write/update operations modify remote config via SSH helpers.
- `No model selected` banner/health check should pass when remote config has valid `provider` and `default`/`model` value.

### Acceptance tests
- Mock SSH connection config and `sshExec`; assert model getter reads remote config.
- Assert writer updates remote config payload and preserves non-model sections.
- Existing model/config tests pass.

## Lane 2 — Cron/workflows

### Problem
Cron/workflow screens may use `/api/jobs`, which can fail when backend capability `jobs_admin` is false. SSH Tunnel mode should operate through remote Hermes CLI or remote cron config.

### Target files
- `src/main/cronjobs.ts`
- relevant IPC handlers in `src/main/index.ts`
- Tests: `tests/cronjobs.test.ts`, new SSH cron test.

### Expected behaviour
In SSH mode:
- List jobs via `hermes cron list` or remote cron files.
- Create/update/pause/resume/remove via `hermes cron ...` over SSH.
- Do not call unsupported `/api/jobs` endpoints.

### Acceptance tests
- Mock SSH and assert `list` invokes remote Hermes cron command.
- Mock pause/resume/remove/create where practical.
- Existing cron tests pass.

## Lane 3 — Profiles and profile-aware paths

### Problem
Profile lists/creation must reflect `/root/.hermes/profiles`, not local profiles.

### Target files
- `src/main/profiles.ts`
- existing SSH profile helpers in `src/main/ssh-remote.ts`
- relevant IPC in `src/main/index.ts`
- Tests: `tests/profiles.test.ts`, `tests/profile-validation.test.ts`, possible new SSH profiles test.

### Expected behaviour
In SSH mode:
- List profiles via existing `sshListProfiles` or remote `hermes profile list`.
- Create/delete/clone/show profile operations target remote profile directories.
- Default profile maps to remote `$HOME/.hermes`.

### Acceptance tests
- Mock SSH connection and verify list/create/delete paths/commands are remote.
- Existing profile tests pass.

## Lane 4 — Tools/toolsets and skills/workflows visibility

### Problem
Tools, toolsets, and skills should display the VPS state in SSH mode.

### Target files
- `src/main/tools.ts`
- `src/main/skills.ts`
- existing helpers in `src/main/ssh-remote.ts`
- relevant IPC in `src/main/index.ts`
- Tests: `tests/toolset-toggle.test.ts`, `tests/skills-content-security.test.ts`, `tests/skills-cli-output.test.ts`, new SSH tools/skills tests as needed.

### Expected behaviour
In SSH mode:
- Tools/toolsets use remote config or `hermes tools ...` via SSH.
- Skills list/read/install/remove use remote skill directories/CLI.
- UI does not silently inspect local `~/.hermes/skills` while connected to the VPS.

### Acceptance tests
- Mock SSH and assert tools/skills commands or file reads target remote.
- Existing tests pass.

## Lane 5 — Env/API keys and identity/SOUL

### Problem
API keys and identity/SOUL/config personality must operate on the VPS. Secrets must not leak to renderer logs or state.

### Target files
- `src/main/config.ts`
- `src/main/config-health.ts`
- `src/main/host-derived-env.ts`
- any env/API-key IPC handlers in `src/main/index.ts`
- Tests: `tests/env-validation.test.ts`, `tests/config-health.test.ts`, `tests/api-server-key-*.test.ts`, new SSH env test.

### Expected behaviour
In SSH mode:
- Env screen reads remote `.env` presence/masked metadata.
- Writes update remote `$HOME/.hermes/.env` over SSH.
- Identity/SOUL reads remote `$HOME/.hermes/SOUL.md` if surfaced by UI.
- Raw secret values are not returned by read APIs.

### Acceptance tests
- Mock SSH read of `.env`; assert result masks values/presence only.
- Mock SSH write; assert payload goes over stdin or safe write path, not command line.
- Existing env/API-key tests pass.

## Lane 6 — Updater behaviour for ORION-patched builds

### Problem
An ORION-patched build must not auto-overwrite itself with an unpatched upstream release. Updater should be notification-only for ORION builds.

### Target files
- `src/main/updater-log.ts`
- updater handlers in `src/main/index.ts`
- package/build metadata where minimal
- Tests: new updater ORION mode test if existing structure permits.

### Expected behaviour
- Add a small ORION build flag/config constant, preferably main-process only.
- If ORION build flag is enabled, update check may report latest upstream release but download/install is disabled or returns a clear message: rebuild `orion-vps-control-plane`.
- Avoid touching broad packaging/branding unless required.

### Acceptance tests
- Mock ORION build flag and updater; assert download is blocked with clear message.
- Upstream/local updater path remains unchanged when flag is false.

## Integration review

After lanes complete:

1. Merge worktrees into `orion-vps-control-plane` one at a time.
2. Run:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
npm install
npm run typecheck
npx vitest run tests/mcp-servers.test.ts tests/mcp-servers-ssh.test.ts
npm test
npm run build
```

3. Run independent review agent on final diff.
4. Build Linux artifacts:

```bash
npm run build:linux
```

RPM may fail if `rpmbuild` is absent; `.deb` creation is sufficient for local Ubuntu installation.
