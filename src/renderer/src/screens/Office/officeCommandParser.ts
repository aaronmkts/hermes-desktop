export type OfficeCommandIntent =
  | { kind: "createTask"; title: string; body?: string; assignee?: string; board?: string }
  | { kind: "moveTask"; taskRef: string; targetStatus: "todo" | "ready" | "running" | "blocked" | "done"; reason?: string }
  | { kind: "assignTask"; taskRef: string; assignee: string | null }
  | { kind: "showBlockedTasks"; assignee?: string }
  | { kind: "redesignOffice"; description: string }
  | { kind: "unknown"; text: string };


export function parseOfficeCommand(input: string): OfficeCommandIntent {
  const text = input.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "unknown", text: input };

  let m = /^(?:create|add|new) task(?:\s+(.+))?$/i.exec(text);
  if (m) {
    let rest = (m[1] ?? "").trim();
    let assignee: string | undefined;
    let board: string | undefined;
    const boardMatch = /\s+on board\s+(.+)$/i.exec(rest);
    if (boardMatch) {
      board = boardMatch[1].trim();
      rest = rest.slice(0, boardMatch.index).trim();
    }
    const assigneeMatch = /\s+(?:assigned to|for)\s+(.+)$/i.exec(rest);
    if (assigneeMatch) {
      assignee = assigneeMatch[1].trim();
      rest = rest.slice(0, assigneeMatch.index).trim();
    }
    return { kind: "createTask", title: rest, ...(assignee ? { assignee } : {}), ...(board ? { board } : {}) };
  }

  m = /^move\s+(.+?)\s+to\s+(todo|ready|running|blocked|done)(?:\s+because\s+(.+))?$/i.exec(text);
  if (m) return { kind: "moveTask", taskRef: m[1].trim(), targetStatus: m[2].toLowerCase() as any, ...(m[3] ? { reason: m[3].trim() } : {}) } as OfficeCommandIntent;
  m = /^mark\s+(.+?)\s+done$/i.exec(text);
  if (m) return { kind: "moveTask", taskRef: m[1].trim(), targetStatus: "done" };
  m = /^complete\s+(.+?)(?:\s+with result\s+(.+))?$/i.exec(text);
  if (m) return { kind: "moveTask", taskRef: m[1].trim(), targetStatus: "done", ...(m[2] ? { reason: m[2].trim() } : {}) };
  m = /^unblock\s+(.+)$/i.exec(text);
  if (m) return { kind: "moveTask", taskRef: m[1].trim(), targetStatus: "ready" };

  m = /^(?:assign|reassign)\s+(.+?)\s+to\s+(.+)$/i.exec(text);
  if (m) return { kind: "assignTask", taskRef: m[1].trim(), assignee: m[2].trim() };
  m = /^unassign\s+(.+)$/i.exec(text);
  if (m) return { kind: "assignTask", taskRef: m[1].trim(), assignee: null };

  if (/^(?:show|list) blocked tasks$/i.test(text) || /^what is blocked\??$/i.test(text)) return { kind: "showBlockedTasks" };
  m = /^(?:show|list)\s+(.+?)\s+blocked tasks$/i.exec(text);
  if (m) return { kind: "showBlockedTasks", assignee: m[1].trim() };

  m = /^(?:redesign office|rearrange office|move desks)\s*(.*)$/i.exec(text);
  if (m) return { kind: "redesignOffice", description: m[1].trim() };
  if (/^(?:reset office|remove desks|delete layout|make (?:the )?office better|clean up office)$/i.test(text)) return { kind: "redesignOffice", description: text };

  return { kind: "unknown", text };
}
