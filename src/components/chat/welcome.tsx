"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { BrainCircuit, FileSearch, Globe, Sparkles, ShieldCheck, Code2, PenLine } from "lucide-react";
import { useAppStore } from "@/lib/store";

const SUGGESTIONS = [
  {
    icon: Code2,
    title: "Ship some code",
    prompt: "Write a TypeScript debounce hook for React with cancel support, and explain the tricky parts.",
  },
  {
    icon: BrainCircuit,
    title: "Think it through",
    prompt: "Think step by step: I have 3 boxes. Box A has twice as many apples as Box B. Box C has 5 fewer than A. Together they have 45 apples. How many in each box?",
  },
  {
    icon: PenLine,
    title: "Draft & polish",
    prompt: "Draft a friendly launch announcement for an AI workspace app. Keep it under 120 words, confident but not hypey.",
  },
  {
    icon: FileSearch,
    title: "Analyze a document",
    prompt: "I'll attach a document next. Summarize the key risks and open questions.",
  },
];

const FEATURE_CHIPS = [
  { icon: Sparkles, label: "Streaming chat" },
  { icon: BrainCircuit, label: "Thinking mode" },
  { icon: Globe, label: "Web search" },
  { icon: FileSearch, label: "Long-doc RAG" },
  { icon: ShieldCheck, label: "Vision & files" },
];

export function Welcome() {
  const sendMessage = useAppStore((s) => s.sendMessage);
  const serverInfo = useAppStore((s) => s.serverInfo);

  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto aurora scrollbar-thin">
      <div className="relative z-10 mx-auto w-full max-w-2xl px-4 py-10 text-center sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 glow-primary">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>

          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            <span className="text-gradient">GLM 5.4 AI</span>
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">
            Your futuristic AI workspace — streaming answers, deep reasoning, vision, and long-document understanding.
            {serverInfo?.servedChatModel && (
              <span className="mt-1 block font-mono text-[11px] text-muted-foreground/70">
                serving {serverInfo.servedChatModel}
              </span>
            )}
          </p>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-1.5">
            {FEATURE_CHIPS.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground"
              >
                <chip.icon className="h-3 w-3 text-primary/80" />
                {chip.label}
              </span>
            ))}
          </div>
        </motion.div>

        <div className="mt-8 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {SUGGESTIONS.map((s, i) => (
            <motion.button
              key={s.title}
              type="button"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, delay: 0.08 + i * 0.06, ease: "easeOut" }}
              onClick={() => sendMessage(s.prompt, { webSearch: false, thinking: false, systemPrompt: null })}
              className="group flex items-start gap-3 rounded-xl border border-border/70 bg-card/60 p-3.5 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lg"
            >
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/25 bg-primary/10 text-primary transition-transform group-hover:scale-105">
                <s.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{s.title}</span>
                <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                  {s.prompt}
                </span>
              </span>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
