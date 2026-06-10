import type { OfficeAgent } from "./office3d/core/types";
import type { OfficeNavigationTarget } from "./officeActions";
import { parseOfficeCommand, type OfficeCommandIntent } from "./officeCommandParser";

type KanbanTask = { id: string; title: string; assignee: string | null; status: string };
type Api = Pick<typeof window.hermesAPI, "kanbanListTasks" | "kanbanCreateTask" | "kanbanAssignTask" | "kanbanCompleteTask" | "kanbanBlockTask" | "kanbanUnblockTask">;

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

function norm(s: string): string { return s.trim().toLowerCase(); }
function apiError(action: string, error?: string): OfficeCommandResult { return { type: "error", message: `${action} failed${error ? `: ${error}` : ""}` }; }

export function createOfficeCommandDispatcher({ api, agents, profile }: { api: Api; agents: OfficeAgent[]; profile?: string }) {
  const confirmations = new Map<string, ConfirmationRequirement>();
  let seq = 0;

  const resolveAgent = (ref: string): { id?: string; clarification?: OfficeCommandResult } => {
    const n = norm(ref);
    const exact = agents.filter((a) => norm(a.id) === n || norm(a.name) === n);
    if (exact.length === 1) return { id: exact[0].id };
    if (exact.length > 1) return { clarification: { type: "needsClarification", message: `Which agent did you mean for ${ref}?`, options: exact.map((a) => a.name) } };
    const matches = agents.filter((a) => norm(a.id).startsWith(n) || norm(a.name).startsWith(n) || norm(a.id).includes(n) || norm(a.name).includes(n));
    if (matches.length === 1) return { id: matches[0].id };
    return { clarification: { type: "needsClarification", message: matches.length ? `Which agent did you mean for ${ref}?` : `I could not find an agent matching ${ref}.`, options: matches.map((a) => a.name) } };
  };

  const listTasks = async (): Promise<KanbanTask[]> => {
    const res = await api.kanbanListTasks({ profile });
    if (!res.success) throw new Error(res.error || "Unable to list tasks");
    return (res.data ?? []) as KanbanTask[];
  };
  const resolveTask = async (ref: string): Promise<{ task?: KanbanTask; clarification?: OfficeCommandResult }> => {
    const tasks = await listTasks();
    const n = norm(ref);
    const exactId = tasks.find((t) => norm(t.id) === n);
    if (exactId) return { task: exactId };
    const exactTitle = tasks.filter((t) => norm(t.title) === n);
    if (exactTitle.length === 1) return { task: exactTitle[0] };
    if (exactTitle.length > 1) return { clarification: { type: "needsClarification", message: `Multiple tasks are titled ${ref}.`, options: exactTitle.map((t) => `${t.id}: ${t.title}`) } };
    const matches = tasks.filter((t) => norm(t.title).includes(n));
    if (matches.length === 1) return { task: matches[0] };
    return { clarification: { type: "needsClarification", message: matches.length ? `Which task did you mean for ${ref}?` : `I could not find a task matching ${ref}.`, options: matches.map((t) => `${t.id}: ${t.title}`) } };
  };

  const executeIntent = async (intent: OfficeCommandIntent): Promise<OfficeCommandResult> => {
    if (intent.kind === "unknown") return { type: "fallbackToChat", text: intent.text };
    if (intent.kind === "createTask") {
      if (!intent.title.trim()) return { type: "needsClarification", message: "What should the task title be?" };
      let assignee: string | undefined;
      if (intent.assignee) { const r = resolveAgent(intent.assignee); if (r.clarification) return r.clarification; assignee = r.id; }
      const res = await api.kanbanCreateTask({ title: intent.title, ...(assignee ? { assignee } : {}) }, profile);
      return res.success ? { type: "handled", message: `Created task ${intent.title}${res.data?.id ? ` (${res.data.id})` : ""}.`, refreshKanban: true } : apiError("Create task", res.error);
    }
    if (intent.kind === "assignTask") {
      const tr = await resolveTask(intent.taskRef); if (tr.clarification || !tr.task) return tr.clarification ?? { type: "error", message: "Task not found." };
      let assignee: string | null = null;
      if (intent.assignee !== null) { const ar = resolveAgent(intent.assignee); if (ar.clarification) return ar.clarification; assignee = ar.id ?? null; }
      const res = await api.kanbanAssignTask(tr.task.id, assignee, profile);
      return res.success ? { type: "handled", message: assignee ? `Assigned ${tr.task.id} to ${assignee}.` : `Unassigned ${tr.task.id}.`, refreshKanban: true } : apiError("Assign task", res.error);
    }
    if (intent.kind === "moveTask") {
      const tr = await resolveTask(intent.taskRef); if (tr.clarification || !tr.task) return tr.clarification ?? { type: "error", message: "Task not found." };
      if (intent.targetStatus === "blocked") {
        if (!intent.reason) return { type: "needsClarification", message: `Why is ${tr.task.id} blocked?` };
        const res = await api.kanbanBlockTask(tr.task.id, intent.reason, profile);
        return res.success ? { type: "handled", message: `Blocked ${tr.task.id}: ${intent.reason}.`, refreshKanban: true } : apiError("Block task", res.error);
      }
      if (intent.targetStatus === "done") {
        const c: ConfirmationRequirement = { id: `office-command-${++seq}`, title: `Complete ${tr.task.id}?`, message: `This will call kanbanCompleteTask for “${tr.task.title}”.`, confirmLabel: "Complete", cancelLabel: "Cancel", danger: true, payload: { ...intent, taskRef: tr.task.id } };
        confirmations.set(c.id, c); return { type: "needsConfirmation", confirmation: c };
      }
      if (intent.targetStatus === "ready" && tr.task.status === "blocked") {
        const res = await api.kanbanUnblockTask(tr.task.id, profile);
        return res.success ? { type: "handled", message: `Unblocked ${tr.task.id}.`, refreshKanban: true } : apiError("Unblock task", res.error);
      }
      return { type: "handled", message: `Moving tasks to ${intent.targetStatus} is not supported by the current Kanban API. Opening Kanban.`, navigate: "kanban" };
    }
    if (intent.kind === "showBlockedTasks") {
      let assignee: string | undefined;
      if (intent.assignee) { const ar = resolveAgent(intent.assignee); if (ar.clarification) return ar.clarification; assignee = ar.id; }
      const res = await api.kanbanListTasks({ status: "blocked", assignee, profile });
      if (!res.success) return apiError("List blocked tasks", res.error);
      const blocked = res.data ?? [];
      return { type: "handled", navigate: "kanban", message: blocked.length ? `${blocked.length} blocked task${blocked.length === 1 ? "" : "s"}: ${blocked.map((t) => `${t.id} ${t.title}`).join("; ")}` : "No blocked tasks." };
    }
    if (intent.kind === "redesignOffice") {
      const d = norm(intent.description);
      if (!d || /make (?:the )?office better|clean up office/.test(d)) return { type: "needsClarification", message: "What specific office layout change should I preview?" };
      const danger = /reset|remove|delete/.test(d);
      const c: ConfirmationRequirement = { id: `office-command-${++seq}`, title: danger ? "Confirm destructive office layout request" : "Confirm office redesign preview", message: `Phase 6 will not mutate the layout yet. Requested change: ${intent.description}`, confirmLabel: "Acknowledge", cancelLabel: "Cancel", danger, payload: intent };
      confirmations.set(c.id, c); return { type: "needsConfirmation", confirmation: c };
    }
    return { type: "fallbackToChat", text: "" };
  };

  return {
    dispatchOfficeCommand: (text: string) => executeIntent(parseOfficeCommand(text)),
    confirmOfficeCommand: async (id: string): Promise<OfficeCommandResult> => {
      const c = confirmations.get(id); if (!c) return { type: "error", message: "Confirmation expired or already used." };
      confirmations.delete(id);
      if (c.payload.kind === "moveTask" && c.payload.targetStatus === "done") {
        const res = await api.kanbanCompleteTask(c.payload.taskRef, c.payload.reason, profile);
        return res.success ? { type: "handled", message: `Completed ${c.payload.taskRef}.`, refreshKanban: true } : apiError("Complete task", res.error);
      }
      return { type: "handled", message: "Office redesign acknowledged; no layout changes were applied in Phase 6." };
    },
    cancelOfficeCommand: async (id: string): Promise<OfficeCommandResult> => { confirmations.delete(id); return { type: "handled", message: "Cancelled." }; },
  };
}
