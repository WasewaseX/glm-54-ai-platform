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
  artifacts?: ArtifactItem[];
  steps?: AgentStepItem[];
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

// ---- Agent engine (POST /api/agent) ----

export type ArtifactKind = "markdown" | "code" | "html" | "svg" | "image";

export interface ArtifactItem {
  id: string;
  conversationId: string;
  messageId: string | null;
  title: string;
  kind: ArtifactKind;
  language: string | null;
  /** Text content; for kind="image" this holds the source document id. */
  content: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type AgentStepKind = "plan" | "tool" | "artifact";

export interface AgentStepItem {
  id: string;
  messageId: string;
  idx: number;
  kind: AgentStepKind;
  tool: string | null;
  title: string;
  detail: string | null;
  status: "running" | "done" | "error";
  createdAt: string;
}

/** Client-side draft of an artifact while its content streams in live. */
export interface LiveArtifact {
  tempId: string;
  title: string;
  kind: ArtifactKind;
  language: string | null;
  content: string;
}

export type AgentStreamEvent =
  | { type: "meta"; conversationId: string; userMessageId: string; assistantMessageId: string }
  | { type: "title"; title: string }
  | { type: "plan"; steps: string[] }
  | {
      type: "step";
      id: string;
      idx: number;
      kind: AgentStepKind;
      tool: string | null;
      title: string;
      status: "running" | "done" | "error";
      detail?: string | null;
    }
  /** Live artifact content while it is being written (tempId until finalized). */
  | { type: "artifact_delta"; tempId: string; text: string }
  | {
      type: "artifact";
      id: string;
      tempId?: string;
      title: string;
      kind: ArtifactKind;
      language: string | null;
      version: number;
      updatedAt: string;
    }
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
      iterations: number;
    }
  | { type: "error"; message: string; fatal: boolean };
