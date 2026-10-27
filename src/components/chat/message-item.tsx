"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  FileText,
  Globe,
  Paperclip,
  RefreshCw,
  Sparkles,
  User,
} from "lucide-react";
import { Markdown } from "@/components/chat/markdown";
import { AgentTimeline } from "@/components/chat/agent-timeline";
import type { ChatMessage } from "@/lib/types";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---- [[artifact:<id>]] markers (embedded by the agent engine) ----

const ARTIFACT_MARKER_RE = /\[\[artifact:([^\]\n]+)\]\]/g;

type ContentSegment = { type: "text"; value: string } | { type: "artifact"; id: string };

function splitArtifactSegments(content: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let last = 0;
  for (const match of content.matchAll(ARTIFACT_MARKER_RE)) {
    const start = match.index ?? 0;
    if (start > last) segments.push({ type: "text", value: content.slice(last, start) });
    segments.push({ type: "artifact", id: match[1] });
    last = start + match[0].length;
  }
  if (last < content.length) segments.push({ type: "text", value: content.slice(last) });
  return segments;
}

function ArtifactChip({ id }: { id: string }) {
  const artifact = useAppStore((s) => s.artifacts.find((a) => a.id === id));
  const openArtifact = useAppStore((s) => s.openArtifact);
  const title = artifact?.title ?? "Artifact";
  return (
    <button
      type="button"
      onClick={() => openArtifact(id)}
      aria-label={`Open artifact: ${title}`}
      className="my-2 inline-flex max-w-full items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.07] px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <FileText className="h-4 w-4 shrink-0" aria-hidden />
      <span className="truncate">{title}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
    </button>
  );
}

function AttachmentChips({ message }: { message: ChatMessage }) {
  if (!message.attachments?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {message.attachments.map((att) => (
        <span
          key={att.id}
          className="inline-flex max-w-[220px] items-center gap-1.5 rounded-full border bg-background/60 px-2.5 py-1 text-xs text-muted-foreground"
        >
          {att.kind === "image" ? (
            <Paperclip className="h-3 w-3 shrink-0" />
          ) : (
            <FileText className="h-3 w-3 shrink-0" />
          )}
          <span className="truncate">{att.name}</span>
        </span>
      ))}
    </div>
  );
}

function ThinkingBlock({ thinking }: { thinking: string }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-primary/20 bg-primary/[0.04]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-primary/90 transition hover:bg-primary/[0.06]"
        aria-expanded={open}
      >
        <BrainCircuit className="h-3.5 w-3.5" />
        Reasoning trace
        <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-primary/15 px-3 py-2.5 scrollbar-thin">
          <p className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-muted-foreground">
            {thinking}
          </p>
        </div>
      )}
    </div>
  );
}

export function MessageItem({
  message,
  isLast,
  onRegenerate,
}: {
  message: ChatMessage;
  isLast: boolean;
  onRegenerate: () => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = React.useState(false);
  const hasContent = message.content.length > 0;

  // Agent timeline steps for this assistant message (live + hydrated).
  const steps = useAppStore((s) => s.stepsByMessage[message.id]);

  // Content split around [[artifact:id]] markers → markdown text + chips.
  const segments = React.useMemo(
    () => (isUser ? null : splitArtifactSegments(message.content)),
    [isUser, message.content]
  );
  const hasArtifactChips = segments?.some((seg) => seg.type === "artifact") ?? false;

  const copyMessage = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn("group w-full", isUser ? "flex justify-end" : "flex justify-start")}
    >
      <div className={cn("flex max-w-full gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
        {/* Avatar */}
        <div
          className={cn(
            "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
            isUser
              ? "border-border bg-secondary text-secondary-foreground"
              : "border-primary/30 bg-primary/10 text-primary glow-primary"
          )}
          aria-hidden
        >
          {isUser ? <User className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
        </div>

        <div className={cn("min-w-0", isUser ? "max-w-[85%]" : "max-w-[92%] sm:max-w-[85%]")}>
          {/* Agent execution timeline (plan / searches / reads / artifacts) */}
          {!isUser && steps && steps.length > 0 && (
            <div className="mb-2">
              <AgentTimeline steps={steps} streaming={Boolean(message.streaming)} />
            </div>
          )}

          {/* Thinking trace */}
          {!isUser && message.thinking && message.thinking.trim().length > 0 && (
            <ThinkingBlock thinking={message.thinking} />
          )}

          {/* Error card — rendered INSTEAD of an empty bubble so failures are
              actionable, not a floating banner over a blank shell. */}
          {!isUser && message.status === "error" && (
            <div className="overflow-hidden rounded-2xl border border-destructive/40 bg-destructive/[0.06]">
              <div className="flex items-start gap-3 px-4 py-3.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-destructive/30 bg-destructive/10 text-destructive"
                  aria-hidden
                >
                  <AlertTriangle className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-destructive">Generation failed</p>
                  <p className="mt-0.5 break-words text-xs leading-relaxed text-destructive/90">
                    {message.error ?? "Something went wrong while generating the response."}
                  </p>
                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    {isLast && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1.5 border-destructive/40 px-2.5 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={onRegenerate}
                      >
                        <RefreshCw className="h-3 w-3" />
                        Retry
                      </Button>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      Transient gateway errors are retried automatically — a manual retry usually succeeds.
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Bubble — hidden entirely for error-with-no-content (the error card replaces it) */}
          {!(message.status === "error" && !hasContent) && (
          <div
            className={cn(
              "relative rounded-2xl px-4 py-3",
              isUser
                ? "rounded-tr-md bg-primary text-primary-foreground"
                : "rounded-tl-md border border-border/70 bg-card/70"
            )}
          >
            {isUser ? (
              <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">{message.content}</p>
            ) : hasArtifactChips && segments ? (
              <div className={cn(message.streaming && "stream-caret-wrap")}>
                {segments.map((seg, i) =>
                  seg.type === "artifact" ? (
                    <ArtifactChip key={`${seg.id}-${i}`} id={seg.id} />
                  ) : seg.value.trim().length > 0 ? (
                    <Markdown key={i} content={seg.value} />
                  ) : null
                )}
              </div>
            ) : hasContent ? (
              <div className={cn(message.streaming && "stream-caret-wrap")}>
                <Markdown content={message.content} />
              </div>
            ) : message.status === "error" ? null : message.status === "streaming" ? (
              <div className="flex items-center gap-2 py-0.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
                <span className="shimmer-text text-sm">Thinking…</span>
              </div>
            ) : (
              <p className="text-sm italic text-muted-foreground">
                {message.status === "cancelled" ? "Cancelled — no output." : "(empty response)"}
              </p>
            )}

            {message.webSearchUsed && !isUser && (
              <div className="mt-2 flex items-center gap-1.5 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                <Globe className="h-3 w-3" />
                Grounded with web search
              </div>
            )}
          </div>
          )}

          <AttachmentChips message={message} />

          {/* Meta + actions */}
          {!message.streaming && (hasContent || message.status !== "streaming") && (
            <div
              className={cn(
                "mt-1 flex items-center gap-1 px-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
                isUser && "justify-end"
              )}
            >
              {isUser ? (
                <>
                  <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 rounded-md"
                    onClick={copyMessage}
                    aria-label="Copy message"
                  >
                    {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </>
              ) : (
                <>
                  {message.model && <span className="font-mono">{message.model}</span>}
                  {message.latencyMs != null && <span>· {(message.latencyMs / 1000).toFixed(1)}s</span>}
                  {message.completionTokens != null && <span>· {message.completionTokens} tok</span>}
                  {message.status === "cancelled" && <span className="text-amber-500">· cancelled</span>}
                  <span className="ml-1 flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 rounded-md"
                      onClick={copyMessage}
                      aria-label="Copy message"
                    >
                      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </Button>
                    {isLast && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 rounded-md"
                        onClick={onRegenerate}
                        aria-label="Regenerate response"
                      >
                        <RefreshCw className="h-3 w-3" />
                      </Button>
                    )}
                  </span>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
