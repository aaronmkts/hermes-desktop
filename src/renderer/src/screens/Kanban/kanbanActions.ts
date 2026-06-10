export type KanbanTaskMutation =
  | "assign"
  | "block"
  | "unblock"
  | "complete"
  | "archive"
  | "create"
  | "specify"
  | "reclaim";

export interface KanbanTaskActionTask {
  id: string;
  status: string;
  assignee?: string | null;
}

export interface KanbanTaskActionDescriptor {
  id: string;
  label: string;
  kind: "mutation" | "detail";
  mutation?: KanbanTaskMutation;
  targetStatus?: string;
  assignee?: string | null;
  disabled?: boolean;
  confirmationRequired?: boolean;
}

const BLOCKABLE_STATUSES = new Set(["todo", "ready", "running"]);
const COMPLETABLE_STATUSES = new Set(["todo", "ready", "running", "blocked"]);

export function isValidKanbanTransition(from: string, to: string): boolean {
  if (!from || !to || from === to) return false;
  if (to === "done") return COMPLETABLE_STATUSES.has(from);
  if (to === "blocked") return BLOCKABLE_STATUSES.has(from);
  if (to === "ready" && from === "blocked") return true;
  return false;
}

export function requiresKanbanConfirmation(
  action: KanbanTaskMutation,
): boolean {
  return action === "complete" || action === "archive";
}

export function buildKanbanTaskActions(
  task: KanbanTaskActionTask,
  opts: { isHqActive: boolean; selectedAgentId?: string | null },
): KanbanTaskActionDescriptor[] {
  const readOnly = !!opts.isHqActive;
  const mutation = (
    id: string,
    label: string,
    action: KanbanTaskMutation,
    extra: Partial<KanbanTaskActionDescriptor> = {},
  ): KanbanTaskActionDescriptor => ({
    id,
    label,
    kind: "mutation",
    mutation: action,
    disabled: readOnly || undefined,
    confirmationRequired: requiresKanbanConfirmation(action),
    ...extra,
  });
  const actions: KanbanTaskActionDescriptor[] = [
    { id: "details", label: "Details", kind: "detail" },
  ];
  if (BLOCKABLE_STATUSES.has(task.status))
    actions.push(
      mutation("block", "Block", "block", { targetStatus: "blocked" }),
    );
  if (task.status === "blocked")
    actions.push(
      mutation("unblock", "Unblock", "unblock", { targetStatus: "ready" }),
    );
  if (COMPLETABLE_STATUSES.has(task.status))
    actions.push(
      mutation("complete", "Complete", "complete", { targetStatus: "done" }),
    );
  if (opts.selectedAgentId && task.assignee !== opts.selectedAgentId)
    actions.push(
      mutation(
        "assign-selected-agent",
        `Assign to ${opts.selectedAgentId}`,
        "assign",
        { assignee: opts.selectedAgentId },
      ),
    );
  if (task.assignee)
    actions.push(
      mutation("unassign", "Unassign", "assign", { assignee: null }),
    );
  if (task.status === "triage")
    actions.push(mutation("specify", "Specify", "specify"));
  if (task.status === "running")
    actions.push(mutation("reclaim", "Reclaim", "reclaim"));
  actions.push(mutation("archive", "Archive", "archive"));
  return actions;
}
