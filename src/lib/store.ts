"use client";

import { create } from "zustand";
import { apiClient, streamChatSse } from "@/lib/api-client";
import { AGENT_BY_ID, CONTINUE_INSTRUCTION } from "@/lib/agents";
import type {
  AttachmentMeta,
  ChatMessage,
  ConversationSummary,
  DocumentItem,
  ServerInfo,
  SystemPromptItem,
} from "@/lib/types";

let activeAbort: AbortController | null = null;

const LAST_CONVERSATION_KEY = "glm54.lastConversation";

interface AppState {
  // data
  conversations: ConversationSummary[];
  activeId: string | null;
  messages: ChatMessage[];
  prompts: SystemPromptItem[];
  documents: DocumentItem[];
  settings: Required<import("@/lib/types").UserSettings>;
  serverInfo: ServerInfo | null;
  pendingAttachments: DocumentItem[];
  activeAgentId: string | null;
  composerDraft: string;

  // ui state
  conversationsLoading: boolean;
  messagesLoading: boolean;
  streaming: boolean;
  streamingTool: string | null;
  streamingContextNote: string | null;
  searchQuery: string;
  sidebarOpen: boolean;
  activeDialog: "settings" | "documents" | "about" | null;

  // data actions
  bootstrap: () => Promise<void>;
  loadConversations: (q?: string) => Promise<void>;
  openConversation: (id: string) => Promise<void>;
  newConversation: () => void;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string, pinned: boolean) => Promise<void>;
  toggleArchive: (id: string, archived: boolean) => Promise<void>;
  clearAllConversations: () => Promise<void>;

  sendMessage: (text: string, opts?: { webSearch?: boolean; thinking?: boolean; systemPrompt?: string | null }) => Promise<void>;
  regenerate: () => Promise<void>;
  stopStreaming: () => void;
  continueWriting: () => Promise<void>;
  setActiveAgent: (id: string | null) => void;
  setComposerDraft: (text: string) => void;

  uploadFiles: (files: File[]) => Promise<void>;
  removePendingAttachment: (id: string) => void;
  loadDocuments: () => Promise<void>;
  deleteDocument: (id: string) => Promise<void>;

  loadPrompts: () => Promise<void>;
  createPrompt: (name: string, content: string, isDefault?: boolean) => Promise<void>;
  updatePrompt: (id: string, patch: Partial<SystemPromptItem>) => Promise<void>;
  deletePrompt: (id: string) => Promise<void>;

  loadSettings: () => Promise<void>;
  updateSettings: (patch: Partial<import("@/lib/types").UserSettings>) => Promise<void>;
  loadServerInfo: () => Promise<void>;
  setSearchQuery: (q: string) => Promise<void>;
  setSidebarOpen: (open: boolean) => void;
  setActiveDialog: (dialog: "settings" | "documents" | "about" | null) => void;
}

function tmpId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export const useAppStore = create<AppState>()((set, get) => ({
  conversations: [],
  activeId: null,
  messages: [],
  prompts: [],
  documents: [],
  settings: {
    theme: "system",
    sendOnEnter: true,
    thinkingDefault: false,
    webSearchDefault: false,
    defaultSystemPromptId: null,
  },
  serverInfo: null,
  pendingAttachments: [],
  activeAgentId: null,
  composerDraft: "",

  conversationsLoading: false,
  messagesLoading: false,
  streaming: false,
  streamingTool: null,
  streamingContextNote: null,
  searchQuery: "",
  sidebarOpen: true,
  activeDialog: null,

  bootstrap: async () => {
    await Promise.all([
      get().loadConversations(),
      get().loadSettings(),
      get().loadPrompts(),
      get().loadDocuments(),
      get().loadServerInfo(),
    ]);
    // Restore the most recent conversation (survives reloads — the whole point).
    try {
      const last = localStorage.getItem(LAST_CONVERSATION_KEY);
      if (last && !get().activeId && get().conversations.some((c) => c.id === last)) {
        await get().openConversation(last);
      }
    } catch {
      /* storage unavailable */
    }
  },

  loadConversations: async (q = "") => {
    set({ conversationsLoading: true });
    try {
      const { conversations } = await apiClient.listConversations(q);
      set({ conversations });
    } catch (err) {
      console.error("loadConversations:", err);
    } finally {
      set({ conversationsLoading: false });
    }
  },

  setSearchQuery: async (q: string) => {
    set({ searchQuery: q });
    await get().loadConversations(q);
  },

  openConversation: async (id: string) => {
    set({ activeId: id, messagesLoading: true, messages: [] });
    try {
      const { conversation } = await apiClient.getConversation(id);
      set({ messages: conversation.messages });
      try {
        localStorage.setItem(LAST_CONVERSATION_KEY, id);
      } catch {
        /* ignore */
      }
    } catch (err) {
      console.error("openConversation:", err);
      set({ activeId: null });
    } finally {
      set({ messagesLoading: false });
    }
  },

  newConversation: () => {
    activeAbort?.abort();
    activeAbort = null;
    try {
      localStorage.removeItem(LAST_CONVERSATION_KEY);
    } catch {
      /* ignore */
    }
    set({
      activeId: null,
      messages: [],
      pendingAttachments: [],
      streaming: false,
      streamingTool: null,
      streamingContextNote: null,
    });
  },

  deleteConversation: async (id: string) => {
    await apiClient.deleteConversation(id);
    const { activeId } = get();
    if (activeId === id) get().newConversation();
    set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }));
  },

  renameConversation: async (id: string, title: string) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
    try {
      await apiClient.updateConversation(id, { title });
    } catch (err) {
      console.error("renameConversation:", err);
    }
  },

  togglePin: async (id: string, pinned: boolean) => {
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === id ? { ...c, pinned } : c)),
    }));
    try {
      await apiClient.updateConversation(id, { pinned });
    } catch (err) {
      console.error("togglePin:", err);
    }
  },

  toggleArchive: async (id: string, archived: boolean) => {
    try {
      await apiClient.updateConversation(id, { archived });
      set((s) => ({ conversations: s.conversations.filter((c) => c.id !== id) }));
    } catch (err) {
      console.error("toggleArchive:", err);
    }
  },

  clearAllConversations: async () => {
    await apiClient.clearConversations();
    get().newConversation();
    set({ conversations: [] });
  },

  sendMessage: async (text, opts = {}) => {
    const state = get();
    if (state.streaming) return;
    const trimmed = text.trim();
    const pending = state.pendingAttachments;
    if (!trimmed && pending.length === 0) return;

    const attachmentIds = pending.map((d) => d.id);
    const attachmentMeta: AttachmentMeta[] = pending.map((d) => ({
      id: d.id,
      name: d.name,
      mime: d.mime,
      size: d.size,
      kind: d.kind,
    }));

    const optimisticUser: ChatMessage = {
      id: tmpId("u"),
      role: "user",
      content: trimmed,
      attachments: attachmentMeta.length ? attachmentMeta : null,
      status: "complete",
      createdAt: nowIso(),
    };
    const optimisticAssistant: ChatMessage = {
      id: tmpId("a"),
      role: "assistant",
      content: "",
      status: "streaming",
      streaming: true,
      createdAt: nowIso(),
      webSearchUsed: opts.webSearch,
    };

    activeAbort = new AbortController();
    set((s) => ({
      messages: [...s.messages, optimisticUser, optimisticAssistant],
      pendingAttachments: [],
      streaming: true,
      streamingTool: opts.webSearch ? "web_search" : null,
      streamingContextNote: null,
      activeId: s.activeId,
    }));

    const patchAssistant = (patch: Partial<ChatMessage>) => {
      set((s) => {
        const messages = [...s.messages];
        const idx = messages.findIndex((m) => m.id === currentAssistantId);
        if (idx >= 0) messages[idx] = { ...messages[idx], ...patch };
        return { messages };
      });
    };

    let streamedText = "";
    let streamedThinking = "";
    let currentAssistantId = optimisticAssistant.id;
    let conversationId = state.activeId ?? undefined;

    try {
      await streamChatSse(
        {
          conversationId,
          message: trimmed || undefined,
          attachmentIds: attachmentIds.length ? attachmentIds : undefined,
          webSearch: opts.webSearch,
          thinking: opts.thinking,
          systemPrompt: opts.systemPrompt,
        },
        (event) => {
          switch (event.type) {
            case "meta":
              conversationId = event.conversationId;
              set({ activeId: event.conversationId });
              // Patch first (message still has the temp id), then track the real id.
              patchAssistant({ id: event.assistantMessageId });
              currentAssistantId = event.assistantMessageId;
              break;
            case "delta":
              streamedText += event.text;
              patchAssistant({ content: streamedText });
              break;
            case "thinking":
              streamedThinking += event.text;
              patchAssistant({ thinking: streamedThinking });
              break;
            case "tool":
              set({
                streamingTool: event.status === "start" ? "web_search" : null,
              });
              patchAssistant({ webSearchUsed: true });
              break;
            case "context":
              set({ streamingContextNote: event.message });
              break;
            case "title":
              set((s) => ({
                conversations: s.conversations.map((c) =>
                  c.id === conversationId ? { ...c, title: event.title } : c
                ),
              }));
              break;
            case "done":
              patchAssistant({
                id: event.assistantMessageId,
                status: event.status,
                streaming: false,
                model: event.model,
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
                latencyMs: event.latencyMs,
              });
              break;
            case "error":
              patchAssistant({
                status: "error",
                streaming: false,
                error: event.message,
              });
              break;
          }
        },
        activeAbort.signal
      );

      // Refresh conversation list to pick up new conversation / ordering.
      await get().loadConversations(get().searchQuery);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        patchAssistant({ status: "cancelled", streaming: false });
      } else {
        patchAssistant({
          status: "error",
          streaming: false,
          error: (err as Error)?.message ?? "Request failed",
        });
      }
    } finally {
      set((s) => ({
        streaming: false,
        streamingTool: null,
        streamingContextNote: null,
        messages: s.messages.map((m) =>
          m.streaming ? { ...m, streaming: false, status: m.status === "streaming" ? "cancelled" : m.status } : m
        ),
      }));
      activeAbort = null;
    }
  },

  regenerate: async () => {
    const { activeId, streaming } = get();
    if (streaming || !activeId) return;

    // Optimistically remove trailing assistant messages in the UI.
    set((s) => {
      const messages = [...s.messages];
      while (messages.length > 0 && messages[messages.length - 1].role === "assistant") messages.pop();
      return {
        messages: [
          ...messages,
          {
            id: tmpId("a"),
            role: "assistant" as const,
            content: "",
            status: "streaming" as const,
            streaming: true,
            createdAt: nowIso(),
          },
        ],
        streaming: true,
      };
    });

    const optimisticAssistant = get().messages[get().messages.length - 1];
    const patchAssistant = (patch: Partial<ChatMessage>) => {
      set((s) => {
        const messages = [...s.messages];
        const idx = messages.findIndex((m) => m.id === currentAssistantId);
        if (idx >= 0) messages[idx] = { ...messages[idx], ...patch };
        return { messages };
      });
    };

    let currentAssistantId = optimisticAssistant.id;
    activeAbort = new AbortController();
    let streamedText = "";
    try {
      await streamChatSse(
        { conversationId: activeId, regenerate: true },
        (event) => {
          switch (event.type) {
            case "meta":
              patchAssistant({ id: event.assistantMessageId });
              currentAssistantId = event.assistantMessageId;
              break;
            case "delta":
              streamedText += event.text;
              patchAssistant({ content: streamedText });
              break;
            case "thinking":
              patchAssistant({ thinking: (optimisticAssistant.thinking ?? "") + event.text });
              break;
            case "done":
              patchAssistant({
                id: event.assistantMessageId,
                status: event.status,
                streaming: false,
                model: event.model,
                promptTokens: event.promptTokens,
                completionTokens: event.completionTokens,
                latencyMs: event.latencyMs,
              });
              break;
            case "error":
              patchAssistant({ status: "error", streaming: false, error: event.message });
              break;
          }
        },
        activeAbort.signal
      );
      await get().loadConversations(get().searchQuery);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        patchAssistant({ status: "cancelled", streaming: false });
      } else {
        patchAssistant({ status: "error", streaming: false, error: (err as Error)?.message });
      }
    } finally {
      set((s) => ({
        streaming: false,
        messages: s.messages.map((m) => ({ ...m, streaming: false })),
      }));
      activeAbort = null;
    }
  },

  stopStreaming: () => {
    activeAbort?.abort();
    activeAbort = null;
  },

  /**
   * Ask the model to resume the last assistant message exactly where it
   * stopped (serialized writing / long-form generation). Reuses the active
   * conversation so the full context and conversation-level system prompt
   * apply.
   */
  continueWriting: async () => {
    const { activeId, streaming, activeAgentId } = get();
    if (streaming || !activeId) return;
    const agent = activeAgentId ? AGENT_BY_ID[activeAgentId] : null;
    await get().sendMessage(CONTINUE_INSTRUCTION, {
      webSearch: false,
      thinking: false,
      systemPrompt: agent?.systemPrompt ?? undefined,
    });
  },

  setActiveAgent: (id) => set({ activeAgentId: id }),

  setComposerDraft: (text) => set({ composerDraft: text }),

  uploadFiles: async (files: File[]) => {
    try {
      const { documents, errors } = await apiClient.uploadFiles(files);
      set((s) => ({
        pendingAttachments: [...s.pendingAttachments, ...documents].slice(0, 6),
        documents: [...documents, ...s.documents],
      }));
      if (errors.length > 0) {
        const { toast } = await import("sonner");
        toast.warning(errors[0]);
      }
    } catch (err) {
      const { toast } = await import("sonner");
      toast.error((err as Error)?.message ?? "Upload failed");
    }
  },

  removePendingAttachment: (id: string) => {
    set((s) => ({ pendingAttachments: s.pendingAttachments.filter((d) => d.id !== id) }));
  },

  loadDocuments: async () => {
    try {
      const { documents } = await apiClient.listDocuments();
      set({ documents });
    } catch (err) {
      console.error("loadDocuments:", err);
    }
  },

  deleteDocument: async (id: string) => {
    await apiClient.deleteDocument(id);
    set((s) => ({
      documents: s.documents.filter((d) => d.id !== id),
      pendingAttachments: s.pendingAttachments.filter((d) => d.id !== id),
    }));
  },

  loadPrompts: async () => {
    try {
      const { prompts } = await apiClient.listPrompts();
      set({ prompts });
    } catch (err) {
      console.error("loadPrompts:", err);
    }
  },

  createPrompt: async (name, content, isDefault = false) => {
    const { prompt } = await apiClient.createPrompt(name, content, isDefault);
    set((s) => ({ prompts: [prompt, ...s.prompts] }));
  },

  updatePrompt: async (id, patch) => {
    const { prompt } = await apiClient.updatePrompt(id, patch);
    set((s) => ({ prompts: s.prompts.map((p) => (p.id === id ? { ...p, ...prompt } : p)) }));
  },

  deletePrompt: async (id: string) => {
    await apiClient.deletePrompt(id);
    set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) }));
  },

  loadSettings: async () => {
    try {
      const { settings } = await apiClient.getSettings();
      set({ settings });
    } catch (err) {
      console.error("loadSettings:", err);
    }
  },

  updateSettings: async (patch) => {
    set((s) => ({ settings: { ...s.settings, ...patch } }));
    try {
      const { settings } = await apiClient.updateSettings(patch);
      set({ settings });
    } catch (err) {
      console.error("updateSettings:", err);
    }
  },

  loadServerInfo: async () => {
    try {
      const serverInfo = await apiClient.getServerInfo();
      set({ serverInfo });
    } catch (err) {
      console.error("loadServerInfo:", err);
    }
  },

  setSidebarOpen: (open: boolean) => set({ sidebarOpen: open }),

  setActiveDialog: (dialog) => set({ activeDialog: dialog }),
}));
