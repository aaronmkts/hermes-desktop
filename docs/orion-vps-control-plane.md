# ORION VPS Control-Plane Architecture

> Scope: keep Hermes One visually and functionally usable as Aaron's local `orion-desktop` application while making the ORION VPS (`/root/.hermes`) the canonical source of truth for chat, profiles, models, tools, MCP servers, cron jobs, API keys, skills, and identity.

## Goal

Hermes One's SSH Tunnel mode should behave as a full ORION control panel, not merely a chat client pointed at a remote API. When the connection mode is `ssh`, management screens must read and write the remote Hermes profile over SSH rather than falling back to local `~/.hermes` state or unsupported HTTP management endpoints.

## Canonical state

For Aaron's current ORION deployment:

- Host: ORION VPS
- SSH user: `root`
- Hermes home: `/root/.hermes`
- Default profile config: `/root/.hermes/config.yaml`
- Default profile env: `/root/.hermes/.env`
- Named profiles: `/root/.hermes/profiles/<name>/`
- API/chat port: `127.0.0.1:8642` on the VPS, tunnelled to the local machine
- Local launcher/wake phrase: `orion-desktop`

The local Ubuntu app installation is a UI shell. It should not become a second ORION brain.

## Update model

This branch is intentionally small and rebase-friendly:

- `upstream`: `https://github.com/fathah/hermes-desktop`
- ORION branch: `orion-vps-control-plane`
- Local launcher remains `orion-desktop`, pointing to the installed Electron binary.

Do not let Electron auto-update overwrite an ORION-patched build with an unpatched upstream package. Upstream releases should be consumed by:

```bash
git fetch upstream --tags
git checkout orion-vps-control-plane
git rebase upstream/main   # or a release tag such as v0.5.9
npm install
npm run typecheck
npm test
npm run build:linux
sudo apt install ./dist/*.deb
```

The desired updater behaviour for ORION builds is notification-only: report that a new upstream release exists, then instruct the user to rebuild/reinstall the ORION branch.

## Control-plane design

Prefer changing main-process IPC handlers and transport helpers over renderer components. This keeps upstream merge conflicts low.

### Transport split

- `local` mode: preserve upstream local file/CLI behaviour.
- `remote` HTTP mode: use HTTP management endpoints only when they exist.
- `ssh` mode: use SSH as the management control plane.

In SSH mode, handlers should use one of:

1. Remote Hermes CLI, e.g. `hermes mcp list`, `hermes cron list`, `hermes profile list`.
2. Remote config reads/writes, e.g. `/root/.hermes/config.yaml` for `mcp_servers`.
3. Remote env writes, e.g. `/root/.hermes/.env`, with secrets kept in the Electron main process and never echoed back to the renderer.

### Do not use unsupported HTTP endpoints in SSH mode

The current Hermes Agent API exposes chat/runs/sessions/skills/toolsets, but not every management route. In particular, current ORION backend builds may not expose:

- `/api/mcp/servers`
- `/api/mcp/catalog`
- `/api/mcp/servers/<name>/test`
- `/api/jobs` when `jobs_admin` is false

If the app is in SSH mode, those screens should prefer SSH operations rather than treating HTTP 404 as a runtime failure.

## Phase map

### Phase 1: branch discipline and documentation

- Create/maintain Aaron fork.
- Add `upstream` remote.
- Keep ORION patches on `orion-vps-control-plane`.
- Document this architecture.

### Phase 2: MCP SSH control plane

MCP management is the first vertical slice because the failure is clear: chat can use MCP tools but the app's MCP screen calls unsupported HTTP endpoints.

In SSH mode:

- List: read remote `config.yaml` and parse `mcp_servers`.
- Add/remove/enable: edit remote `config.yaml`.
- Test/catalog/install: run `hermes mcp ...` over SSH.

Secrets provided by marketplace installers must not be placed in the remote process command line. Install the server template first, then write secrets through the env/API-key path.

### Phase 3: models and validation banners

The `No model selected` banner must validate the remote `model:` block in `/root/.hermes/config.yaml` when in SSH mode.

### Phase 4: cron/workflows

Cron screens should use remote `hermes cron ...` or remote cron files, not `/api/jobs` if the backend does not advertise jobs admin capability.

### Phase 5: tools, profiles, env, and identity

- Tools: remote `hermes tools list/enable/disable` or remote config.
- Profiles: remote `hermes profile ...` and `/root/.hermes/profiles`.
- Env/API keys: remote `.env`; display only key presence/masked metadata.
- Soul/identity: remote `/root/.hermes/SOUL.md` and config personality.

## Verification checklist

For each patched screen:

1. Configure SSH Tunnel mode to the VPS.
2. Verify chat still works through `8642`.
3. Verify the screen matches the output of the equivalent remote CLI command.
4. Verify writes modify `/root/.hermes`, not local `~/.hermes`.
5. Verify local mode still follows upstream behaviour.
6. Run `npm run typecheck` and relevant tests before building.

## Merge-conflict policy

- Keep ORION logic in main-process transport/helper files.
- Avoid broad renderer rewrites.
- Avoid branding/package renames until explicitly required.
- Prefer small, named commits per control-plane area.
- Rebase frequently onto upstream rather than accumulating a divergent product.
