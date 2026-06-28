// Shared DB row types for the app. Mirror the Supabase schema (DATA_MODEL.md).
// (Will move to packages/shared when that workspace is created.)

export type ChannelType = "instagram" | "sms" | "wechat" | "kakao";
export type MessageDirection = "in" | "out" | "note";
export type MessageStatus = "sent" | "delivered" | "failed";
export type ConversationIntent = "none" | "booking";

export type IntentPayload = {
  service_guess: string | null;
  preferred: string | null;
  candidate_times: string[];
  confidence: number;
};

export type ClientRow = {
  id: string;
  name: string;
  value: "high" | "regular" | "new";
  phone: string | null;
  email: string | null;
  instagram_handle: string | null;
};

export type ConversationRow = {
  id: string;
  client_id: string;
  channel_type: ChannelType;
  last_message_at: string | null;
  unread: boolean;
  archived: boolean;
  window_expires_at: string | null;
  intent: ConversationIntent;
  intent_payload: IntentPayload | null;
};

export type MessageRow = {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  body: string | null;
  media: unknown | null;
  channel_message_id: string | null;
  status: MessageStatus | null;
  sent_at: string;
};

/** A conversation joined with its client + a derived snippet, for the inbox. */
export type InboxItem = ConversationRow & {
  client: ClientRow;
  snippet: string;
  hasBooking: boolean;
};
