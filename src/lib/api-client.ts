"use client";

import type {
  AgentStreamEvent,
  ChatStreamEvent,
  ConversationDetail,
  ConversationSummary,
  DocumentItem,
  ServerInfo,
  SystemPromptItem,
  UsageStats,
  UserSettings,
} from "@/lib/types";

// ---------- Session identity (iframe-proof) ----------
// The app frequently runs inside a cross-site preview iframe where cookies
// are stripped from fetch() requests. Identity therefore travels in the
// `X-Session-Token` header, backed by localStorage, with a document.cookie
// mirror for top-level navigations (export downloads, new tabs).

const STORAGE_KEY = "glm54.session";
const SESSION_HEADER = "X-Session-Token";
const COOKIE_NAME = "glm54_session";
const TOKEN_RE = /^[a-f0-9]{32,128}$/i;

let cachedToken: string | null = null;

function readMirrorCookie(): string | null {
  try {
    const match = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    const value = match?.slice(COOKIE_NAME.length + 1) ?? null;
    return value && TOKEN_RE.test(value) ? value : null;
  } catch {
    return null;
  }
}

function persistToken(token: string) {
  cachedToken = token;
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    /* storage disabled — in-memory token still covers this page session */
  }
  try {
    // Non-httpOnly mirror cookie (server also sets an httpOnly one).
    document.cookie = `${COOKIE_NAME}=${token}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

/** Resolve (or lazily create) the persistent session token. */
export function getSessionToken(): string {
  if (cachedToken) return cachedToken;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && TOKEN_RE.test(stored)) {
      cachedToken = stored;
      return stored;
    }
  } catch {
    /* ignore */
  }
  const mirrored = readMirrorCookie();
  if (mirrored) {
    persistToken(mirrored);
    return mirrored;
  }
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  persistToken(token);
  return token;
}

/** Capture a server-issued token (self-healing) from any API response. */
function adoptSessionToken(res: Response) {
  const issued = res.headers.get("x-session-token");
  if (issued && TOKEN_RE.test(issued) && issued !== cachedToken) persistToken(issued);
}

function withSessionHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set(SESSION_HEADER, getSessionToken());
  return headers;
}

/** Fetch JSON, throwing a descriptive Error on failure.
 *  Idempotent requests (GET/HEAD) ride out transient gateway failures —
 *  429/5xx/network blips are retried twice with a short backoff so background
 *  polling doesn't surface errors during sandbox reboots or quota storms. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "HEAD";
  const attempts = retryable ? 3 : 1;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 900 * attempt + Math.random() * 500));
    }
    let res: Response;
    try {
      res = await fetch(path, {
        ...init,
        headers: withSessionHeaders({
          ...(init?.body && !(init.body instanceof FormData)
            ? { "Content-Type": "application/json" }
            : {}),
          ...init?.headers,
        }),
      });
    } catch (err) {
      // Network-level failure (server rebooting, DNS hiccup, etc.)
      if (!retryable) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      continue;
    }
    adoptSessionToken(res);
    if (res.ok) return (await res.json()) as T;

    let message = `Request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep default */
    }
    const transient = res.status === 429 || res.status >= 500;
    if (!retryable || !transient) throw new Error(message);
    lastError = new Error(message);
  }
  throw lastError ?? new Error("Request failed");
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

/** Shared SSE body reader: splits frames and hands each `data:` payload to onPayload. */
async function readSseBody(res: Response, onPayload: (payload: string) => void): Promise<void> {
  if (!res.body) throw new Error("Stream response has no body.");
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
      onPayload(payload);
    }
  }
}

/** Open a POST SSE stream, throwing a descriptive Error on failure.
 *  Transient gateway failures (429/5xx/network blips) are retried up to 5
 *  attempts with escalating backoff (~25s total) before the error reaches the
 *  user — enough to ride out sandbox reboot windows transparently. */
async function openSseStream(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= 4; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, [0, 1_500, 4_000, 8_000, 12_000][attempt] + Math.random() * 800));
    }
    const res = await fetch(path, {
      method: "POST",
      headers: withSessionHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      signal,
    });
    adoptSessionToken(res);

    if (res.ok && res.body) return res;

    let message = `Stream request failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* keep default */
    }
    // Only transient statuses are retried; other 4xx are terminal.
    if (!(res.status === 429 || res.status >= 500)) throw new Error(message);
    lastError = new Error(message);
  }
  throw lastError ?? new Error("Stream request failed");
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
  const res = await openSseStream("/api/chat", body, signal);
  await readSseBody(res, (payload) => {
    try {
      onEvent(JSON.parse(payload) as ChatStreamEvent);
    } catch {
      /* skip malformed frame */
    }
  });
}

export interface AgentRequestBody {
  conversationId?: string;
  message?: string;
  attachmentIds?: string[];
  thinking?: boolean;
  agentId?: string;
}

/**
 * POST /api/agent and parse the SSE response into typed AgentStreamEvents.
 * Same frame protocol as streamChatSse; events carry plan/step/artifact data.
 */
export async function streamAgentSse(
  body: AgentRequestBody,
  onEvent: (event: AgentStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await openSseStream("/api/agent", body, signal);
  await readSseBody(res, (payload) => {
    try {
      onEvent(JSON.parse(payload) as AgentStreamEvent);
    } catch {
      /* skip malformed frame */
    }
  });
}

/**
 * Fetch any API path as a Blob with session headers attached (iframe-proof
 * downloads — cookies alone are not reliable inside cross-site previews).
 */
export async function fetchRawBlob(path: string): Promise<Blob> {
  const res = await fetch(path, { headers: withSessionHeaders() });
  adoptSessionToken(res);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  return res.blob();
}

/** Trigger a browser download for a Blob (revokes the object URL afterwards). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Download a conversation export via authenticated fetch + blob, so it works
 * even when cookies are unavailable (e.g. inside cross-site preview iframes).
 */
export async function downloadExport(id: string, format: "md" | "json"): Promise<void> {
  const res = await fetch(`/api/conversations/${id}/export?format=${format}`, {
    headers: withSessionHeaders(),
  });
  adoptSessionToken(res);
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const blob = await res.blob();
  const dispo = res.headers.get("content-disposition") ?? "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(dispo);
  const name = match ? decodeURIComponent(match[1]) : `conversation.${format}`;
  saveBlob(blob, name);
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
