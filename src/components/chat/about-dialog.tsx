"use client";

import * as React from "react";
import { CircleCheck, CircleDashed, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store";

export function AboutDialog() {
  const activeDialog = useAppStore((s) => s.activeDialog);
  const setActiveDialog = useAppStore((s) => s.setActiveDialog);
  const serverInfo = useAppStore((s) => s.serverInfo);

  return (
    <Dialog open={activeDialog === "about"} onOpenChange={(open) => !open && setActiveDialog(null)}>
      <DialogContent className="max-h-[85vh] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            About GLM 5.4 AI
          </DialogTitle>
          <DialogDescription>
            A production-ready AI workspace built on the official Z.ai gateway. Capabilities below
            are verified against the live API — nothing is claimed without evidence.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {serverInfo && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/30 bg-primary/[0.07] font-mono text-[11px] text-primary">
                chat: {serverInfo.servedChatModel ?? "probing…"}
              </Badge>
              <Badge variant="outline" className="border-primary/30 bg-primary/[0.07] font-mono text-[11px] text-primary">
                vision: {serverInfo.visionModel}
              </Badge>
            </div>
          )}

          <div className="max-h-[42vh] overflow-y-auto pr-2 scrollbar-thin">
            <div className="space-y-1.5">
              {serverInfo?.capabilities.map((cap) => (
                <div
                  key={cap.label}
                  className="flex items-start gap-2.5 rounded-lg border p-2.5"
                >
                  {cap.verified ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{cap.label}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{cap.note}</p>
                  </div>
                </div>
              ))}
              {!serverInfo && (
                <p className="py-6 text-center text-xs text-muted-foreground">Loading capability manifest…</p>
              )}
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Long-context strategy: this gateway does not publish a 200M-token context window, so
            GLM 5.4 AI ships verified RAG instead — chunked indexing, BM25 retrieval, and map-reduce
            summarization. Context budgets are enforced server-side for reliability.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
