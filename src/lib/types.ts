// Shared types between client and server (no server-only imports here)

export type Role = "user" | "assistant";

export interface AttachmentMeta {
  id: string; // document id
  name: string;
  mime: string;
  size: number;
  kind: "text" | "image" | "binary";
  documentId?: string;
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  thinking?: string | null;
  attachments?: AttachmentMeta[] | null;
  model?: string | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  latencyMs?: number | null;
  webSearchUsed?: boolean;
  status: "complete" | "cancelled" | "error" | "streaming";
  error?: string | null;
  createdAt: string;
  /** client-only: currently streaming this message */
  streaming?: boolean;
}

export interface ConversationSummary {
  id: string;
  title: string;
  model: string | null;
  systemPrompt: string | null;
  pinned: boolean;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  preview?: string | null;
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[];
}

export interface SystemPromptItem {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  name: string;
  mime: string;
  size: number;
  kind: "text" | "image" | "binary";
  chunkCount: number;
  hasSummary: boolean;
  createdAt: string;
  excerpt?: string;
}

export interface DocumentDetail extends DocumentItem {
  content: string | null;
  summary: string | null;
}

export interface UserSettings {
  theme?: "dark" | "light" | "system";
  sendOnEnter?: boolean;
  thinkingDefault?: boolean;
  webSearchDefault?: boolean;
  defaultSystemPromptId?: string | null;
}

export interface UsageStats {
  totalMessages: number;
  totalConversations: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  last24hMessages: number;
  searches: number;
}

export interface ServerInfo {
  product: string;
  servedChatModel: string; // actual model id echoed by the gateway
  visionModel: string;
  capabilities: { label: string; verified: boolean; note: string }[];
  limits: { maxUploadBytes: number; maxHistoryMessages: number; contextCharBudget: number };
}

// ---- Streaming wire protocol (SSE over POST /api/chat) ----
export type ChatStreamEvent =
  | { type: "meta"; conversationId: string; userMessageId: string; assistantMessageId: string }
  | { type: "title"; title: string }
  | { type: "tool"; tool: "web_search"; status: "start" | "done"; message: string; results?: WebSearchResult[] }
  | { type: "context"; message: string } // e.g. RAG retrieval info
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | {
      type: "done";
      assistantMessageId: string;
      model: string | null;
      promptTokens: number | null;
      completionTokens: number | null;
      latencyMs: number;
      status: "complete" | "cancelled";
    }
  | { type: "error"; message: string; fatal: boolean };

export interface WebSearchResult {
  url: string;
  name: string;
  snippet: string;
  host_name: string;
  rank: number;
  date: string;
  favicon: string;
}
