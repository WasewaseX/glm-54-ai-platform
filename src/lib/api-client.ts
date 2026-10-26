"use client";

import type {
  ChatStreamEvent,
  ConversationDetail,
  ConversationSummary,
  DocumentItem,
  ServerInfo,
  SystemPromptItem,
  UsageStats,
  UserSettings,
} from "@/lib/types";

/** Fetch JSON, throwing a descriptive Error on failure. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export interface ChatRequestBody {
  conversationId?: string;
  message?: string;
  attachmentIds?: string[];
  webSearch?: boolean;
  thinking?: boolean;
  systemPrompt?: string | null;
  regenerate?: boolean;
}

/**
 * POST /api/chat and parse the SSE response into typed events.
 * Returns the Response so callers can abort; onEvent is called per frame.
 */
export async function streamChatSse(
  body: ChatRequestBody,
  onEvent: (event: ChatStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    let message = `Chat request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep default */
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onEvent(JSON.parse(payload) as ChatStreamEvent);
      } catch {
        /* skip malformed frame */
      }
    }
  }
}

// ---------- Typed endpoint helpers ----------

export const apiClient = {
  listConversations: (q = "") =>
    api<{ conversations: ConversationSummary[] }>(
      `/api/conversations${q ? `?q=${encodeURIComponent(q)}` : ""}`
    ),

  createConversation: () =>
    api<{ conversation: ConversationSummary }>("/api/conversations", { method: "POST" }),

  getConversation: (id: string) =>
    api<{ conversation: ConversationDetail }>(`/api/conversations/${id}`),

  updateConversation: (id: string, patch: Partial<Pick<ConversationSummary, "title" | "pinned" | "archived" | "systemPrompt">>) =>
    api<{ conversation: unknown }>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteConversation: (id: string) => api<{ ok: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),

  clearConversations: () => api<{ ok: boolean }>("/api/conversations", { method: "DELETE" }),

  exportConversation: (id: string, format: "md" | "json") =>
    `/api/conversations/${id}/export?format=${format}`,

  uploadFiles: async (files: File[]) => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    return api<{ documents: DocumentItem[]; errors: string[] }>("/api/upload", {
      method: "POST",
      body: form,
    });
  },

  listDocuments: () => api<{ documents: DocumentItem[] }>("/api/documents"),

  deleteDocument: (id: string) => api<{ ok: boolean }>(`/api/documents/${id}`, { method: "DELETE" }),

  summarizeDocument: (id: string) =>
    api<{ summary: string }>(`/api/documents/${id}`, {
      method: "POST",
      body: JSON.stringify({ action: "summarize" }),
    }),

  listPrompts: () => api<{ prompts: SystemPromptItem[] }>("/api/prompts"),

  createPrompt: (name: string, content: string, isDefault = false) =>
    api<{ prompt: SystemPromptItem }>("/api/prompts", {
      method: "POST",
      body: JSON.stringify({ name, content, isDefault }),
    }),

  updatePrompt: (id: string, patch: Partial<Pick<SystemPromptItem, "name" | "content" | "isDefault">>) =>
    api<{ prompt: SystemPromptItem }>(`/api/prompts/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deletePrompt: (id: string) => api<{ ok: boolean }>(`/api/prompts/${id}`, { method: "DELETE" }),

  getSettings: () => api<{ settings: Required<UserSettings> }>("/api/settings"),

  updateSettings: (patch: Partial<UserSettings>) =>
    api<{ settings: Required<UserSettings> }>("/api/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  getStats: () => api<{ stats: UsageStats }>("/api/stats"),

  getServerInfo: () => api<ServerInfo & { status: string }>("/api/health"),
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
