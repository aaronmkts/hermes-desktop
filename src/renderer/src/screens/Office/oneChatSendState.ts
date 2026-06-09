import type { OfficeAgent } from "./office3d/core/types";

export interface OneChatSendStateInput {
  input: string;
  selectedAgent: OfficeAgent | null;
  isLoading: boolean;
}

export interface OneChatSendState {
  canEdit: boolean;
  canSend: boolean;
  placeholder: string;
  statusText: string | null;
  warning: string | null;
}

export function getOneChatSendState({
  input,
  selectedAgent,
  isLoading,
}: OneChatSendStateInput): OneChatSendState {
  if (!selectedAgent) {
    return {
      canEdit: false,
      canSend: false,
      placeholder: "Select an agent...",
      statusText: null,
      warning: null,
    };
  }

  const gatewayOffline = selectedAgent.gatewayRunning === false;
  const canEdit = !isLoading;

  return {
    canEdit,
    canSend: canEdit && input.trim().length > 0,
    placeholder: gatewayOffline
      ? `Message ${selectedAgent.name} — will try to reconnect gateway...`
      : `Message ${selectedAgent.name}...`,
    statusText: gatewayOffline
      ? "Gateway appears offline — sending will try to reconnect"
      : selectedAgent.status,
    warning: gatewayOffline
      ? "Gateway appears offline. You can still send; Hermes will try to reconnect or start it."
      : null,
  };
}
