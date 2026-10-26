"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  BookOpen,
  BrainCircuit,
  Code2,
  Download,
  FileSearch,
  Globe,
  LayoutTemplate,
  PenLine,
  Presentation,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useAppStore } from "@/lib/store";
import { AGENTS } from "@/lib/agents";
import { cn } from "@/lib/utils";

const AGENT_ICONS = [Code2, PenLine, FileSearch, Presentation, LayoutTemplate] as const;

const DELIVERABLES = [
  {
    href: "/deliverables/investor-update-deck.pptx",
    icon: Presentation,
    title: "Investor Update Deck",
    meta: "10 slides · .pptx · with speaker notes",
  },
  {
    href: "/deliverables/the-dark-genome.pdf",
    icon: BookOpen,
    title: "The Dark Genome",
    meta: "Original novel · 109-page PDF",
  },
];

const FEATURE_CHIPS = [
  { icon: Sparkles, label: "Streaming" },
  { icon: BrainCircuit, label: "Thinking mode" },
  { icon: Globe, label: "Web search" },
  { icon: FileSearch, label: "Long-doc RAG" },
  { icon: ShieldCheck, label: "Vision & files" },
];

export function Welcome() {
  const serverInfo = useAppStore((s) => s.serverInfo);
  const newConversation = useAppStore((s) => s.newConversation);
  const setActiveAgent = useAppStore((s) => s.setActiveAgent);
  const setComposerDraft = useAppStore((s) => s.setComposerDraft);

  const launchAgent = React.useCallback(
    (agentId: string, starter: string) => {
      newConversation();
      setActiveAgent(agentId);
      setComposerDraft(starter);
    },
    [newConversation, setActiveAgent, setComposerDraft]
  );

  return (
    <div className="relative flex min-h-0 flex-1 overflow-y-auto scrollbar-thin">
      {/* Halftone cloud backdrop */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden">
        <div className="halftone-cloud absolute -top-20 left-1/2 h-72 w-[44rem] max-w-none -translate-x-1/2" />
      </div>

      <div className="relative z-10 m-auto w-full max-w-3xl px-4 py-12 text-center sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <h1 className="font-serif text-4xl font-semibold tracking-tight sm:text-5xl">
            More than coding...
          </h1>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-[0.95rem]">
            A reverse-engineered Z.ai-style agent workspace — persistent conversations, five
            specialist agents, streaming answers.
            {serverInfo?.servedChatModel && (
              <span className="mt-1 block font-mono text-[11px] text-muted-foreground/70">
                serving {serverInfo.servedChatModel}
              </span>
            )}
          </p>
        </motion.div>

        {/* Agent cards */}
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {AGENTS.map((agent, i) => {
            const Icon = AGENT_ICONS[i % AGENT_ICONS.length];
            return (
              <motion.button
                key={agent.id}
                type="button"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.1 + i * 0.06, ease: "easeOut" }}
                onClick={() => launchAgent(agent.id, agent.starters[0])}
                aria-label={`Start a ${agent.name} session`}
                className="group flex flex-col items-center rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur transition-all hover:-translate-y-1 hover:border-primary/40 hover:bg-card hover:shadow-xl focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
              >
                <span
                  className={cn(
                    "flex h-20 w-full items-center justify-center rounded-xl border border-border/50 bg-gradient-to-br from-muted/60 via-card to-muted/30 transition-transform group-hover:scale-[1.03]",
                    i === 1 && "sm:col-span-1"
                  )}
                >
                  <Icon className="h-7 w-7 text-foreground/70 transition-colors group-hover:text-primary" />
                </span>
                <span className="mt-3 text-sm font-medium">{agent.name}</span>
                <span className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                  {agent.tagline}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* Deliverable downloads */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.4, ease: "easeOut" }}
          className="mx-auto mt-8 grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {DELIVERABLES.map((item) => (
            <a
              key={item.href}
              href={item.href}
              download
              className="group flex items-center gap-3 rounded-2xl border border-border/60 bg-card/70 px-4 py-3 text-left backdrop-blur transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/50">
                <item.icon className="h-5 w-5 text-foreground/70 transition-colors group-hover:text-primary" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{item.meta}</span>
              </span>
              <Download className="h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" />
            </a>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="mt-6 flex flex-wrap items-center justify-center gap-1.5"
        >
          {FEATURE_CHIPS.map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/50 px-2.5 py-1 text-[11px] text-muted-foreground"
            >
              <chip.icon className="h-3 w-3 text-primary/80" />
              {chip.label}
            </span>
          ))}
        </motion.div>
      </div>
    </div>
  );
}
