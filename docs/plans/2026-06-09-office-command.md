# Phase 6 plan: Office natural-language command dispatcher

Date: 2026-06-09
Worktree: `/srv/orion/worktrees/office-command`
Scope: planning only; implementation must follow strict TDD.

## Objective

Add a deterministic natural-language command layer to the Office chat modal so users can manage Kanban work from the 3D Office without allowing uncontrolled LLM side effects.

Supported Phase 6 commands:

- Create tasks.
- Move tasks between Kanban states.
- Assign/reassign tasks to agents.
- Show blocked tasks.
- Redesign/rearrange the office only through an explicit confirmation flow when the request is ambiguous or destructive.

## Existing code touchpoints inspected

- `src/renderer/src/screens/Office/OneChatModal.tsx`
  - Currently sends every message through `window.hermesAPI.sendMessage(text, selectedAgentId, sessionId, history)`.
  - Maintains per-agent modal history and loading state locally, then reloads persisted session messages.
  - No command interception exists yet.
- `src/renderer/src/screens/Office/officeActions.ts`
  - Defines Office action descriptors and navigation targets: `gateway`, `providers`, `kanban`, `sessions`.
  - Useful place only for quick action/navigation metadata; do not mix command parsing into this UI-action helper.
- `src/preload/index.ts`
  - Exposes Kanban IPC APIs already needed by the command dispatcher:
    - `kanbanListBoards`, `kanbanCurrentBoard`, `kanbanSwitchBoard`
    - `kanbanListTasks`, `kanbanGetTask`, `kanbanCreateTask`
    - `kanbanAssignTask`, `kanbanCompleteTask`, `kanbanBlockTask`, `kanbanUnblockTask`, `kanbanArchiveTask`, `kanbanSpecifyTask`, `kanbanReclaimTask`, `kanbanCommentTask`, `kanbanDispatchOnce`
- `src/main/index.ts`
  - Registers matching `ipcMain.handle(...)` channels for Kanban APIs.
  - Existing pattern is renderer -> preload facade -> main handler -> Kanban service function.
- `src/renderer/src/screens/Kanban/Kanban.tsx`
  - Shows the canonical renderer-side Kanban API usage and status-transition rules.
  - `handleMove` permits:
    - `done` via `kanbanCompleteTask`
    - `blocked` via `kanbanBlockTask(reason)`
    - `blocked` -> other via `kanbanUnblockTask` first
    - ordinary move only through existing explicit API paths; no generic arbitrary status setter is exposed.
  - Existing destructive UI already confirms done/archive via `window.confirm`.
- `src/renderer/src/screens/Layout/Layout.tsx` and `src/renderer/src/screens/Office/Office.tsx`
  - Office already receives navigation callbacks and can navigate to Kanban.
  - Phase 6 should reuse that pathway for command results such as “show blocked tasks”.
- Test style
  - Vitest is already available (`npm test`).
  - Office has pure helper tests like `src/renderer/src/screens/Office/oneChatSendState.test.ts`.

## Architecture

### New renderer-side command module

Create a pure, deterministic command parser and planner under Office:

- `src/renderer/src/screens/Office/officeCommandParser.ts`
- `src/renderer/src/screens/Office/officeCommandDispatcher.ts`
- Tests:
  - `src/renderer/src/screens/Office/officeCommandParser.test.ts`
  - `src/renderer/src/screens/Office/officeCommandDispatcher.test.ts`

Keep parser and dispatcher separate:

- Parser: converts text into a typed intent or `unknown` without side effects.
- Dispatcher: resolves entities, checks safety, calls Kanban/Office APIs, and returns a structured UI result.

### Types

Recommended core types:

```ts
export type OfficeCommandIntent =
  | { kind: "createTask"; title: string; body?: string; assignee?: string; board?: string }
  | { kind: "moveTask"; taskRef: string; targetStatus: "todo" | "ready" | "running" | "blocked" | "done"; reason?: string }
  | { kind: "assignTask"; taskRef: string; assignee: string | null }
  | { kind: "showBlockedTasks"; assignee?: string }
  | { kind: "redesignOffice"; description: string }
  | { kind: "unknown"; text: string };

export type ConfirmationRequirement = {
  id: string;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  payload: OfficeCommandIntent;
};

export type OfficeCommandResult =
  | { type: "handled"; message: string; navigate?: OfficeNavigationTarget; refreshKanban?: boolean }
  | { type: "needsConfirmation"; confirmation: ConfirmationRequirement }
  | { type: "needsClarification"; message: string; options?: string[] }
  | { type: "fallbackToChat"; text: string }
  | { type: "error"; message: string };
```

### Deterministic-first rule

`OneChatModal.handleSend` should attempt the command dispatcher before calling `sendMessage`:

1. Optimistically append the user message as it does today.
2. Call `dispatchOfficeCommand(text, context)`.
3. If result is `fallbackToChat`, continue the existing `sendMessage` path unchanged.
4. If result is handled/clarification/confirmation/error, append an agent/system-style message locally and do not call `sendMessage`.
5. Confirmed commands call a dispatcher `confirmOfficeCommand(confirmationId)` or pass the original confirmation payload through a local confirmation handler.

This preserves normal chat behavior while preventing LLM side effects for recognized commands.

### Command grammar: Phase 6 RED/GREEN cases

Start narrow and explicit. Expand only with tests.

#### Create task

Recognize:

- `create task Fix login bug`
- `add task Fix login bug`
- `new task Fix login bug`
- `create task Fix login bug for alice`
- `create task Fix login bug assigned to alice`
- `create task Fix login bug on board desktop`

Behavior:

- If title is empty -> `needsClarification`.
- If assignee exists in Office agents, pass agent id/name consistently to `kanbanCreateTask`.
- If assignee text does not uniquely match one agent -> `needsClarification`.
- On success -> message includes created task title/id and `refreshKanban: true`.

#### Move task

Recognize:

- `move TASK-123 to ready`
- `move Fix login bug to blocked because waiting on API key`
- `mark TASK-123 done`
- `complete TASK-123 with result shipped`
- `unblock TASK-123`

Behavior:

- Resolve task by exact id first, then exact title, then unique case-insensitive substring.
- Multiple matches -> `needsClarification` with options.
- `blocked` requires a reason. If missing -> `needsClarification` asking for reason.
- `done` is destructive/completing -> `needsConfirmation` before `kanbanCompleteTask` unless user used an explicit confirmation phrase such as `confirm complete TASK-123` in the confirmation flow.
- `archive` is out of Phase 6 unless explicitly added with a danger confirmation test.

#### Assign task

Recognize:

- `assign TASK-123 to alice`
- `reassign Fix login bug to bob`
- `unassign TASK-123`

Behavior:

- Resolve task by id/title as above.
- Resolve agent by exact id/name, then unique case-insensitive prefix/substring.
- Multiple agents or no match -> `needsClarification`.
- Call `kanbanAssignTask(task.id, assigneeOrNull, profile)`.

#### Show blocked tasks

Recognize:

- `show blocked tasks`
- `list blocked tasks`
- `what is blocked?`
- `show alice blocked tasks`

Behavior:

- Call `kanbanListTasks({ status: "blocked", assignee?, profile })`.
- Return a readable summary of blocked tasks.
- Include `navigate: "kanban"` so Office can switch to the Kanban view.
- No mutation and no confirmation.

#### Redesign office

Recognize:

- `redesign office ...`
- `rearrange office ...`
- `move desks ...`

Behavior:

- Phase 6 should not directly mutate 3D layout.
- Always produce `needsConfirmation` for redesign/rearrange requests with a clear preview of what would change.
- If the request is ambiguous (`make it better`, `clean up office`) -> `needsClarification` first.
- If destructive (`reset office`, `remove desks`, `delete layout`) -> `needsConfirmation` with `danger: true`.
- Actual layout mutation may be deferred behind a later typed layout-action API. In Phase 6, confirmed redesign can return a safe “not yet applied” result unless the existing layout API is ready and covered by tests.

## Safe confirmation model

Use local, typed confirmations; do not ask an LLM to perform actions.

Rules:

- Every confirmation contains a stable id, human-readable summary, danger flag, and original typed intent payload.
- Confirm UI must show exactly which API call(s) will happen.
- Confirmation ids are single-use and expire when modal closes or selected agent changes.
- Destructive actions requiring confirmation:
  - completing a task (`kanbanCompleteTask`)
  - archiving/removing tasks if later added
  - any office reset/remove/delete layout command
- Ambiguous actions requiring clarification, not confirmation:
  - multiple matching tasks
  - multiple matching agents
  - blocked move without reason
  - redesign command without actionable details
- Cancelling a confirmation must not call any Kanban/Layout API.

Initial UI can be simple:

- Render a confirmation card/message in `OneChatModal` with Confirm/Cancel buttons.
- Avoid `window.confirm` for command dispatcher confirmations so tests can assert behavior and so the chat transcript shows the pending operation.

## UI integration plan

1. Add command result messages to `OneChatModal` without changing persisted chat history for handled commands in Phase 6.
   - If persistence is desired later, add a typed local/system message persistence API deliberately.
2. Add an optional `onNavigate?: (target: OfficeNavigationTarget) => void` prop to `OneChatModal` if not already reachable through Office.
3. Pass `onNavigate` from `Office.tsx` into `OneChatModal`.
4. When dispatcher returns `navigate: "kanban"`, invoke Office navigation after appending the response.
5. If `refreshKanban` is true and the Kanban view is mounted, prefer existing visible refresh behavior. If a direct refresh hook is needed, add it in a separate test-backed change.
6. Keep fallback chat path byte-for-byte equivalent except for the pre-dispatch branch.

## TDD implementation sequence

### RED 1: parser accepts only deterministic command grammar

Add `officeCommandParser.test.ts`:

- parses `create task Fix login bug` into `createTask` with title.
- parses `create task Fix login bug assigned to alice` with assignee.
- parses `move TASK-123 to ready` into `moveTask`.
- parses `move TASK-123 to blocked because waiting on api` with reason.
- parses `mark TASK-123 done` into `moveTask` target `done`.
- parses `assign TASK-123 to alice` into `assignTask`.
- parses `unassign TASK-123` into `assignTask` with `assignee: null`.
- parses `show blocked tasks` into `showBlockedTasks`.
- parses `redesign office with more desks` into `redesignOffice`.
- returns `unknown` for normal chat like `how are you?`.

GREEN: implement parser with anchored regexes/string normalization. No LLM calls.

### RED 2: entity resolution is deterministic and safe

Add dispatcher tests with mocked Kanban API and agents:

- exact task id wins over title substring.
- unique title substring resolves.
- multiple task matches returns `needsClarification` and no mutation calls.
- missing task returns `needsClarification` or `error` and no mutation calls.
- exact agent id/name wins.
- multiple agent matches returns `needsClarification` and no mutation calls.

GREEN: implement resolver helpers as pure functions exported for tests or tested through dispatcher.

### RED 3: create task command calls Kanban create only when safe

Tests:

- `create task Fix login bug` calls `kanbanCreateTask({ title: "Fix login bug" }, profile)`.
- `create task Fix login bug assigned to Alice` maps Alice to the unique Office agent and calls create with assignee.
- unknown assignee returns `needsClarification`; create is not called.
- failed API response returns `error` with backend message.

GREEN: implement `dispatchOfficeCommand` create branch.

### RED 4: move/complete/block commands enforce confirmations and reasons

Tests:

- `move TASK-123 to ready` performs allowed non-destructive move only if an API exists; if no generic status API exists, return a clear unsupported result and navigate to Kanban. Do not invent an API.
- `move TASK-123 to blocked` returns `needsClarification` for reason and calls nothing.
- `move TASK-123 to blocked because waiting` calls `kanbanBlockTask(id, reason, profile)`.
- `mark TASK-123 done` returns `needsConfirmation` and calls no `kanbanCompleteTask` before confirmation.
- confirming the completion calls `kanbanCompleteTask(id, result?, profile)` once.
- cancelling the completion calls nothing.

GREEN: implement confirmation store/handler in dispatcher or modal state.

Note: because the current preload facade does not expose a generic `kanbanMoveTask`, Phase 6 should either use existing specific transitions (`complete`, `block`, `unblock`) or add a new main/preload API in a separate RED/GREEN slice after verifying the underlying service supports it.

### RED 5: assign/unassign commands call Kanban assignment APIs

Tests:

- `assign TASK-123 to alice` calls `kanbanAssignTask(task.id, alice.id, profile)`.
- `reassign Fix login bug to bob` resolves task and agent then calls assignment.
- `unassign TASK-123` calls `kanbanAssignTask(task.id, null, profile)`.
- ambiguous task/agent returns clarification and calls no mutation.

GREEN: implement assign branch.

### RED 6: show blocked tasks navigates and summarizes

Tests:

- `show blocked tasks` calls `kanbanListTasks({ status: "blocked", profile })`.
- result message contains count and task titles.
- returns `navigate: "kanban"`.
- `show alice blocked tasks` resolves assignee and filters by assignee.
- empty list returns friendly “No blocked tasks” message.

GREEN: implement list branch and Office navigation callback wiring.

### RED 7: OneChatModal intercepts commands before chat

Add `OneChatModal` tests using React Testing Library:

- typing `show blocked tasks` calls dispatcher/Kanban path and does not call `sendMessage`.
- typing `how are you?` falls back to `sendMessage` exactly as before.
- command result appears as an agent/system message.
- command requiring confirmation renders Confirm and Cancel buttons.
- Confirm triggers the confirm handler exactly once.
- Cancel removes/marks the confirmation and triggers no mutation.

GREEN: integrate command dispatcher into `handleSend`.

### RED 8: office redesign confirmation is safe by default

Tests:

- `redesign office with desks around the CEO` returns `needsConfirmation`, no layout mutation.
- `reset office` returns `needsConfirmation` with `danger: true`.
- `make the office better` returns `needsClarification`.
- cancelling redesign calls no layout API.

GREEN: implement safe placeholder branch; defer real layout mutation until typed layout APIs exist.

## Acceptance criteria

- `npm test -- src/renderer/src/screens/Office/officeCommandParser.test.ts src/renderer/src/screens/Office/officeCommandDispatcher.test.ts` passes.
- `npm test -- src/renderer/src/screens/Office/OneChatModal.test.tsx` passes once UI integration lands.
- Full `npm test` passes before merge.
- `npm run typecheck` passes before merge.
- Recognized Office commands never call `sendMessage`/LLM directly.
- Unrecognized chat continues to use the existing `sendMessage` path.
- Every mutating Kanban command is backed by explicit typed IPC/preload APIs.
- Ambiguous or destructive commands produce clarification/confirmation and perform no side effects until confirmed.
- Completion/destructive confirmations are single-use and cancel-safe.
- “Show blocked tasks” navigates to Kanban and summarizes results.
- No new command parser behavior is added without a failing parser/dispatcher test first.

## Manual verification script after implementation

Run on the remote host:

```bash
export PATH=/srv/orion/tools/node-v22.13.1-linux-x64/bin:$PATH
cd /srv/orion/worktrees/office-command
npm test -- src/renderer/src/screens/Office/officeCommandParser.test.ts src/renderer/src/screens/Office/officeCommandDispatcher.test.ts
npm test -- src/renderer/src/screens/Office/OneChatModal.test.tsx
npm run typecheck
```

Then in the app:

1. Open Office.
2. Open One Chat for an agent.
3. Send `show blocked tasks`; verify Kanban opens and no LLM response is generated.
4. Send `create task Test office command assigned to <agent>`; verify task appears in Kanban.
5. Send `mark <task id> done`; verify confirmation appears and completion only happens after Confirm.
6. Send normal chat text; verify existing chat still works.

## Commit guidance

- Commit this plan doc by itself.
- Implementation should be split into small TDD commits:
  1. Parser tests + parser.
  2. Resolver/dispatcher tests + non-mutating dispatcher skeleton.
  3. Create/assign/list command branches.
  4. Confirmation model + completion/blocking branches.
  5. OneChatModal UI integration.
  6. Redesign confirmation placeholder.
  7. Typecheck/test cleanup.
- Do not combine broad UI refactors with dispatcher behavior.
- Do not add LLM-based tool execution for these commands.
