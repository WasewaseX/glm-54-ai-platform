"use client";

import * as React from "react";
import { ArrowDown, ChevronRight, FileSearch, Globe } from "lucide-react";
import { MessageItem } from "@/components/chat/message-item";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function MessageList() {
  const messages = useAppStore((s) => s.messages);
  const streaming = useAppStore((s) => s.streaming);
  const streamingTool = useAppStore((s) => s.streamingTool);
  const streamingContextNote = useAppStore((s) => s.streamingContextNote);
  const regenerate = useAppStore((s) => s.regenerate);
  const continueWriting = useAppStore((s) => s.continueWriting);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const bottomRef = React.useRef<HTMLDivElement>(null);
  const [pinnedToBottom, setPinnedToBottom] = React.useState(true);

  // Track whether the user is near the bottom.
  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinnedToBottom(distance < 120);
  }, []);

  // Auto-scroll while streaming when pinned.
  React.useEffect(() => {
    if (!pinnedToBottom) return;
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "instant" : "smooth", block: "end" });
  }, [messages, streaming, pinnedToBottom]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setPinnedToBottom(true);
  };

  const last = messages[messages.length - 1];
  const showContinue =
    !streaming &&
    last?.role === "assistant" &&
    last.status === "complete" &&
    (last.content?.length ?? 0) > 0;

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto scrollbar-thin"
        role="log"
        aria-live="polite"
        aria-label="Conversation messages"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pb-6 pt-6 sm:px-6">
          {messages.map((message, i) => (
            <MessageItem
              key={message.id}
              message={message}
              isLast={i === messages.length - 1 && message.role === "assistant"}
              onRegenerate={regenerate}
            />
          ))}

          {/* Streaming status strip */}
          {streaming && (streamingTool || streamingContextNote) && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-xs text-primary/90">
                {streamingTool === "web_search" ? (
                  <>
                    <Globe className="h-3.5 w-3.5 animate-spin" />
                    <span className="shimmer-text">Searching the web…</span>
                  </>
                ) : streamingContextNote ? (
                  <>
                    <FileSearch className="h-3.5 w-3.5" />
                    <span>{streamingContextNote}</span>
                  </>
                ) : null}
              </div>
            </div>
          )}

          <div ref={bottomRef} className="h-px" />
        </div>
      </div>

      {/* Continue bar — resume long-form generation where it stopped */}
      {showContinue && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void continueWriting()}
            className="h-8 gap-1 rounded-full bg-background/90 shadow-md backdrop-blur"
            aria-label="Continue the previous response"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            Continue
          </Button>
        </div>
      )}

      {/* Jump to bottom */}
      <Button
        variant="outline"
        size="icon"
        onClick={scrollToBottom}
        aria-label="Scroll to bottom"
        className={cn(
          "absolute left-1/2 z-20 h-8 w-8 -translate-x-1/2 rounded-full shadow-md transition-all",
          showContinue ? "bottom-16" : "bottom-4",
          pinnedToBottom ? "pointer-events-none opacity-0" : "opacity-100"
        )}
      >
        <ArrowDown className="h-4 w-4" />
      </Button>
    </div>
  );
}
