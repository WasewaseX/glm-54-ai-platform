"use client";

import * as React from "react";
import {
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  FileText,
  Globe,
  Image as ImageIcon,
  Plus,
  SendHorizontal,
  Square,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/lib/store";
import { formatBytes } from "@/lib/api-client";
import { AGENT_BY_ID } from "@/lib/agents";
import { cn } from "@/lib/utils";

const ACCEPT =
  ".txt,.md,.markdown,.csv,.tsv,.json,.yaml,.yml,.xml,.html,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.c,.h,.cpp,.cs,.php,.sh,.sql,.toml,.ini,.log,.css,.pdf,image/png,image/jpeg,image/webp,image/gif";

export function Composer() {
  const streaming = useAppStore((s) => s.streaming);
  const sendMessage = useAppStore((s) => s.sendMessage);
  const sendAgentMessage = useAppStore((s) => s.sendAgentMessage);
  const stopStreaming = useAppStore((s) => s.stopStreaming);
  const uploadFiles = useAppStore((s) => s.uploadFiles);
  const pendingAttachments = useAppStore((s) => s.pendingAttachments);
  const removePendingAttachment = useAppStore((s) => s.removePendingAttachment);
  const settings = useAppStore((s) => s.settings);
  const prompts = useAppStore((s) => s.prompts);
  const activeAgentId = useAppStore((s) => s.activeAgentId);
  const setActiveAgent = useAppStore((s) => s.setActiveAgent);
  const agentMode = useAppStore((s) => s.agentMode);
  const setAgentMode = useAppStore((s) => s.setAgentMode);
  const composerDraft = useAppStore((s) => s.composerDraft);
  const setComposerDraft = useAppStore((s) => s.setComposerDraft);
  const serverInfo = useAppStore((s) => s.serverInfo);

  const [text, setText] = React.useState("");
  const [webSearch, setWebSearch] = React.useState(false);
  const [thinking, setThinking] = React.useState(false);
  const [dragging, setDragging] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragCounter = React.useRef(0);

  const activeAgent = activeAgentId ? AGENT_BY_ID[activeAgentId] : null;

  // Initialize toggles from saved settings
  React.useEffect(() => {
    setWebSearch(settings.webSearchDefault);
    setThinking(settings.thinkingDefault);
  }, [settings.webSearchDefault, settings.thinkingDefault]);

  // Auto-grow textarea
  const resize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  React.useEffect(() => {
    resize();
  }, [text, resize]);

  // Consume drafts pushed by agent cards on the welcome screen
  React.useEffect(() => {
    if (!composerDraft) return;
    setText(composerDraft);
    setComposerDraft("");
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      resize();
    });
  }, [composerDraft, setComposerDraft, resize]);

  const submit = React.useCallback(() => {
    if (streaming) return;
    const value = text.trim();
    if (!value && pendingAttachments.length === 0) return;

    // Agent mode handles its own tool calls; visual attachments are not supported.
    if (agentMode) {
      const hasVisual = pendingAttachments.some((d) => d.kind !== "text");
      if (hasVisual) {
        toast.warning("Agent mode supports text documents — switch to standard chat for images/PDFs");
        return;
      }
      sendAgentMessage(value, { thinking });
      setText("");
      requestAnimationFrame(resize);
      return;
    }

    const defaultPrompt = prompts.find((p) => p.id === settings.defaultSystemPromptId);
    sendMessage(value, {
      webSearch,
      thinking,
      systemPrompt: activeAgent?.systemPrompt ?? defaultPrompt?.content ?? null,
    });
    setText("");
    requestAnimationFrame(resize);
  }, [
    streaming,
    text,
    pendingAttachments,
    agentMode,
    sendAgentMessage,
    prompts,
    settings.defaultSystemPromptId,
    activeAgent,
    sendMessage,
    webSearch,
    thinking,
    resize,
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && settings.sendOnEnter && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !settings.sendOnEnter) {
      e.preventDefault();
      submit();
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void uploadFiles(files.slice(0, 6));
  };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="bg-gradient-to-t from-background via-background to-background/80 px-3 pb-3 pt-2 sm:px-6">
        <div className="mx-auto max-w-3xl">
          {/* Attachment chips */}
          {pendingAttachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {pendingAttachments.map((d) => (
                <span
                  key={d.id}
                  className="group inline-flex max-w-[240px] items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.07] py-1 pl-2.5 pr-1 text-xs"
                >
                  {d.kind === "image" ? (
                    <ImageIcon className="h-3 w-3 shrink-0 text-primary" />
                  ) : (
                    <FileText className="h-3 w-3 shrink-0 text-primary" />
                  )}
                  <span className="truncate text-foreground/90">{d.name}</span>
                  <span className="shrink-0 text-muted-foreground">{formatBytes(d.size)}</span>
                  <button
                    type="button"
                    onClick={() => removePendingAttachment(d.id)}
                    aria-label={`Remove ${d.name}`}
                    className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-destructive/15 hover:text-destructive"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Input shell */}
          <div
            onDragEnter={(e) => {
              e.preventDefault();
              dragCounter.current += 1;
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              dragCounter.current -= 1;
              if (dragCounter.current <= 0) setDragging(false);
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            className={cn(
              "glass relative rounded-[26px] border shadow-lg transition-all duration-200",
              dragging
                ? "border-primary/70 ring-2 ring-primary/40"
                : agentMode
                  ? "border-primary/40 ring-1 ring-primary/15 focus-within:border-primary/60 focus-within:ring-2 focus-within:ring-primary/25"
                  : "border-border/80 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/25"
            )}
          >
            {dragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-[26px] bg-background/70 backdrop-blur-sm">
                <p className="text-sm font-medium text-primary">Drop files to attach</p>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder={agentMode ? "Describe a task — the Agent will plan, search & build…" : "Send a Message…"}
              aria-label="Message input"
              className="max-h-[220px] w-full resize-none bg-transparent px-4 pb-1 pt-4 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground/70 scrollbar-thin"
            />

            {/* Toolbar */}
            <div className="flex items-center gap-1 px-2.5 pb-2.5 pt-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  if (files.length > 0) void uploadFiles(files.slice(0, 6));
                  e.target.value = "";
                }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach files"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Attach documents or images</TooltipContent>
              </Tooltip>

              {activeAgent && (
                <button
                  type="button"
                  onClick={() => setActiveAgent(null)}
                  className="inline-flex h-8 max-w-[170px] items-center gap-1.5 rounded-full border border-primary/35 bg-primary/10 px-2.5 text-xs font-medium text-primary transition hover:bg-primary/15"
                  aria-label={`Active agent: ${activeAgent.name}. Click to deactivate.`}
                >
                  <span className="truncate">{activeAgent.name}</span>
                  <X className="h-3 w-3 shrink-0 opacity-70" />
                </button>
              )}

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={agentMode ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-8 gap-1.5 rounded-full px-2.5 text-xs",
                      agentMode && "border border-primary/35 bg-primary/10 text-primary"
                    )}
                    onClick={() => setAgentMode(!agentMode)}
                    aria-pressed={agentMode}
                  >
                    <Bot className="h-3.5 w-3.5" />
                    Agent
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Agent mode: plan, search, read pages, generate images &amp; files</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={webSearch ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-8 gap-1.5 rounded-full px-2.5 text-xs",
                      webSearch && "border border-primary/35 bg-primary/10 text-primary",
                      agentMode && "opacity-60"
                    )}
                    onClick={() => setWebSearch((v) => !v)}
                    aria-pressed={webSearch}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    Web
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {agentMode
                    ? "The Agent decides its own tools — web toggle applies to standard chat"
                    : "Ground answers with web search"}
                </TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={thinking ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "h-8 gap-1.5 rounded-full px-2.5 text-xs",
                      thinking && "border border-primary/35 bg-primary/10 text-primary"
                    )}
                    onClick={() => setThinking((v) => !v)}
                    aria-pressed={thinking}
                  >
                    <BrainCircuit className="h-3.5 w-3.5" />
                    Think
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Extended reasoning (slower, deeper)</TooltipContent>
              </Tooltip>

              <div className="ml-auto flex items-center gap-1.5">
                {/* Model selector — honest: single "Auto" mode + real served model */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
                      aria-label="Select model"
                    >
                      GLM 5.4 · Auto
                      <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Model
                    </DropdownMenuLabel>
                    <DropdownMenuItem disabled className="text-xs">
                      <Check className="h-3.5 w-3.5 text-primary" /> Auto — best available
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      {serverInfo?.servedChatModel ? (
                        <>
                          Actually serving:{" "}
                          <span className="font-mono text-foreground/80">
                            {serverInfo.servedChatModel}
                          </span>
                        </>
                      ) : (
                        "Served model is shown once the first response streams."
                      )}
                      <br />
                      Vision engages automatically for image/PDF attachments; thinking mode adds a
                      reasoning trace.
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>

                {streaming ? (
                  <Button
                    size="icon"
                    className="h-9 w-9 rounded-full bg-destructive/90 text-white hover:bg-destructive"
                    onClick={stopStreaming}
                    aria-label="Stop generating"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className="h-9 w-9 rounded-full glow-primary transition-transform active:scale-95 disabled:opacity-40"
                    onClick={submit}
                    disabled={!text.trim() && pendingAttachments.length === 0}
                    aria-label="Send message"
                  >
                    <SendHorizontal className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          </div>

          <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground/80">
            GLM 5.4 AI can make mistakes — verify important information. Conversations are saved
            automatically.
          </p>
        </div>
      </div>
    </TooltipProvider>
  );
}
