export type ConversationStatus = "OPEN" | "SNOOZED" | "CLOSED";
export type StatusFilter = "ALL" | ConversationStatus;
export type SenderType = "MERCHANT" | "AGENT" | "SYSTEM";
export type Priority = "URGENT" | "HIGH" | "NORMAL" | "LOW" | "NONE";
export type SlaState = "ON_TRACK" | "BREACHING" | "BREACHED" | "MET";
export type ComposerTab = "reply" | "note";

export interface Conversation {
  readonly id: string;
  readonly shop: string;
  readonly status: ConversationStatus;
  readonly assignedTo: string | null;
  readonly priority: Priority;
  readonly slaState: SlaState;
  readonly firstReplyAt: string | null;
  readonly firstResponseDueAt: string | null;
  readonly resolutionDueAt: string | null;
  readonly csatScore: number | null;
  readonly unreadCount: number;
  readonly lastMessageAt: string | null;
}

export interface ChatMessage {
  readonly id: string;
  readonly conversationId: string;
  readonly senderType: SenderType;
  readonly senderId: string;
  readonly body: string;
  readonly internal: boolean;
  readonly attachmentUrl: string | null;
  readonly createdAt: string;
}
