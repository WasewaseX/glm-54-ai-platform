"use client";

import { create } from "zustand";
import { apiClient, streamAgentSse, streamChatSse } from "@/lib/api-client";
import { AGENT_BY_ID, CONTINUE_INSTRUCTION } from "@/lib/agents";
import type {
  AgentStepItem,
  ArtifactItem,
  AttachmentMeta,
  ChatMessage,
  ConversationSummary,
  DocumentItem,
  ServerInfo,
  SystemPromptItem,
} from "@/lib/types";

let activeAbort: AbortController | null = null;

const LAST_CONVERSATION_KEY = "glm54.lastConversation";

/** Debounce handle for the background artifact-content hydration fetch. */
let artifactHydrationTimer: ReturnType<typeof setTimeout> | null = null;

function sortArtifacts(list: ArtifactItem[]): ArtifactItem[] {
  return [...list].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** Upsert an agent step by id (running → done/error reuse the same id), keeping idx order. */
function upsertStep(list: AgentStepItem[], step: AgentStepItem): AgentStepItem[] {
  const existing = list.findIndex((s) => s.id === step.id);
  const next =
    existing >= 0 ? list.map((s) => (s.id === step.id ? { ...s, ...step } : s)) : [...list, step];
  return next.sort((a, b) => a.idx - b.idx);
}

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

  // agent state
  agentMode: boolean;
  stepsByMessage: Record<string, AgentStepItem[]>;
  artifacts: ArtifactItem[];
  artifactPanelOpen: boolean;
  activeArtifactId: string | null;
  liveArtifact: import("@/lib/types").LiveArtifact | null;

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
  sendAgentMessage: (text: string, opts?: { thinking?: boolean }) => Promise<void>;
  regenerate: () => Promise<void>;
  stopStreaming: () => void;
  continueWriting: () => Promise<void>;
  setActiveAgent: (id: string | null) => void;
  setComposerDraft: (text: string) => void;

  setAgentMode: (on: boolean) => void;
  setArtifactPanelOpen: (open: boolean) => void;
  openArtifact: (id: string) => void;
  hydrateArtifacts: () => Promise<void>;
  scheduleArtifactHydration: () => void;

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

  agentMode: false,
  stepsByMessage: {},
  artifacts: [],
  artifactPanelOpen: false,
  activeArtifactId: null,
  liveArtifact: null,

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
      // Group agent steps per assistant message (idx order) so timelines and
      // artifacts survive reloads.
      const stepsByMessage: Record<string, AgentStepItem[]> = {};
      for (const step of conversation.steps ?? []) {
        (stepsByMessage[step.messageId] ??= []).push(step);
      }
      for (const key of Object.keys(stepsByMessage)) {
        stepsByMessage[key].sort((a, b) => a.idx - b.idx);
      }
      set({
        messages: conversation.messages,
        artifacts: conversation.artifacts ?? [],
        stepsByMessage,
        activeArtifactId: null,
        liveArtifact: null,
      });
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
      artifacts: [],
      stepsByMessage: {},
      liveArtifact: null,
      activeArtifactId: null,
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
              try {
                localStorage.setItem(LAST_CONVERSATION_KEY, event.conversationId);
              } catch {
                /* ignore */
              }
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

  /**
   * Agent-mode send: same optimistic UX as sendMessage, but POSTs to
   * /api/agent and handles the richer agent event protocol (plan, steps,
   * artifact deltas, finalized artifacts).
   */
  sendAgentMessage: async (text, opts = {}) => {
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
    };

    activeAbort = new AbortController();
    set((s) => ({
      messages: [...s.messages, optimisticUser, optimisticAssistant],
      pendingAttachments: [],
      streaming: true,
      streamingTool: null,
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
      await streamAgentSse(
        {
          conversationId,
          message: trimmed || undefined,
          attachmentIds: attachmentIds.length ? attachmentIds : undefined,
          thinking: opts.thinking,
          agentId: state.activeAgentId ?? undefined,
        },
        (event) => {
          switch (event.type) {
            case "meta":
              conversationId = event.conversationId;
              set({ activeId: event.conversationId });
              try {
                localStorage.setItem(LAST_CONVERSATION_KEY, event.conversationId);
              } catch {
                /* ignore */
              }
              // Patch first (message still has the temp id), then track the real id.
              patchAssistant({ id: event.assistantMessageId });
              currentAssistantId = event.assistantMessageId;
              break;
            case "plan":
              // The plan also arrives as a persisted step event (kind "plan",
              // detail { steps }) — step events are the source of truth for
              // the timeline, so nothing to do here.
              break;
            case "step":
              set((s) => ({
                stepsByMessage: {
                  ...s.stepsByMessage,
                  [currentAssistantId]: upsertStep(s.stepsByMessage[currentAssistantId] ?? [], {
                    id: event.id,
                    messageId: currentAssistantId,
                    idx: event.idx,
                    kind: event.kind,
                    tool: event.tool,
                    title: event.title,
                    detail: event.detail ?? null,
                    status: event.status,
                    createdAt: nowIso(),
                  }),
                },
              }));
              break;
            case "artifact_delta":
              set((s) => ({
                liveArtifact:
                  s.liveArtifact && s.liveArtifact.tempId === event.tempId
                    ? { ...s.liveArtifact, content: s.liveArtifact.content + event.text }
                    : {
                        tempId: event.tempId,
                        title: "Draft",
                        kind: "markdown",
                        language: null,
                        content: event.text,
                      },
              }));
              break;
            case "artifact": {
              // Text drafts were streamed via artifact_delta — harvest the
              // accumulated content so the viewer works without a refetch.
              // Image artifacts hold a document id we don't learn until the
              // background hydration fetch below.
              const live = get().liveArtifact;
              const harvested = live?.content ?? "";
              const item: ArtifactItem = {
                id: event.id,
                conversationId: conversationId ?? "",
                messageId: currentAssistantId,
                title: event.title,
                kind: event.kind,
                language: event.language,
                content: event.kind === "image" ? "" : harvested,
                version: event.version,
                createdAt: nowIso(),
                updatedAt: event.updatedAt,
              };
              set((s) => ({
                artifacts: sortArtifacts([...s.artifacts.filter((a) => a.id !== event.id), item]),
                liveArtifact: null,
                activeArtifactId: event.id,
                artifactPanelOpen: true,
              }));
              // Embed the marker in the live message so the chip renders
              // immediately (the server persists the same marker).
              streamedText += `\n\n[[artifact:${event.id}]]\n\n`;
              patchAssistant({ content: streamedText });
              if (!item.content) get().scheduleArtifactHydration();
              break;
            }
            case "delta":
              streamedText += event.text;
              patchAssistant({ content: streamedText });
              break;
            case "thinking":
              streamedThinking += event.text;
              patchAssistant({ thinking: streamedThinking });
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
              // Safety net: fill in any artifact content we could not harvest
              // live (image artifacts keep a document id on the server).
              if (get().artifacts.length > 0) get().scheduleArtifactHydration();
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
        liveArtifact: null,
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
    // A pending draft can never finalize after an abort.
    if (get().liveArtifact) set({ liveArtifact: null });
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

  setAgentMode: (on) => set({ agentMode: on }),

  setArtifactPanelOpen: (open) => set({ artifactPanelOpen: open }),

  openArtifact: (id) => {
    set({ activeArtifactId: id, artifactPanelOpen: true });
    // Content may be missing for artifacts created before a hydration fetch
    // completed (e.g. image artifacts) — self-heal in the background.
    const artifact = get().artifacts.find((a) => a.id === id);
    if (artifact && !artifact.content) get().scheduleArtifactHydration();
  },

  /**
   * Refetch the conversation and merge authoritative artifact rows (the
   * artifact SSE event does not carry content, so live-created artifacts
   * — especially images — need one background fetch to become viewable).
   */
  hydrateArtifacts: async () => {
    const { activeId, artifacts } = get();
    if (!activeId) return;
    if (!artifacts.some((a) => !a.content)) return;
    try {
      const { conversation } = await apiClient.getConversation(activeId);
      set((s) => {
        const byId = new Map(s.artifacts.map((a) => [a.id, a]));
        for (const artifact of conversation.artifacts ?? []) {
          byId.set(artifact.id, artifact); // server row is authoritative
        }
        return { artifacts: sortArtifacts(Array.from(byId.values())) };
      });
    } catch (err) {
      console.error("hydrateArtifacts:", err);
    }
  },

  scheduleArtifactHydration: () => {
    if (artifactHydrationTimer) return;
    artifactHydrationTimer = setTimeout(() => {
      artifactHydrationTimer = null;
      void get().hydrateArtifacts();
    }, 400);
  },

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
