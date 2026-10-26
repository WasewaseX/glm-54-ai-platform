"use client";

import * as React from "react";
import {
  AlertCircle,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Globe,
  ImagePlus,
  ListChecks,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentStepItem } from "@/lib/types";

/** Icon per step kind / tool (mirrors the backend tool names). */
function StepIcon({ step }: { step: AgentStepItem }) {
  if (step.kind === "plan") return <ListChecks className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  switch (step.tool) {
    case "web_search":
      return <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "page_reader":
      return <BookOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    case "generate_image":
      return <ImagePlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
    default:
      return <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
  }
}

function StatusIcon({ status }: { status: AgentStepItem["status"] }) {
  if (status === "running") {
    return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="Running" />;
  }
  if (status === "error") {
    return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Failed" />;
  }
  return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />;
}

/** Safe JSON parse — step details are JSON strings, but never trust them blindly. */
function parseDetail(detail: string | null): Record<string, unknown> | null {
  if (!detail) return null;
  try {
    const parsed: unknown = JSON.parse(detail);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

const DETAIL_LABELS: Record<string, string> = {
  query: "Query",
  url: "URL",
  count: "Results",
  chars: "Characters",
  size: "Size",
  prompt: "Prompt",
  title: "Title",
  version: "Version",
  kind: "Kind",
  error: "Error",
};

function StepDetail({ step }: { step: AgentStepItem }) {
  const parsed = React.useMemo(() => parseDetail(step.detail), [step.detail]);

  if (!parsed) return null;

  // Plan steps carry their checklist under detail.steps.
  if (step.kind === "plan" && Array.isArray(parsed.steps)) {
    const items = parsed.steps.filter((s): s is string => typeof s === "string");
    if (items.length === 0) return null;
    return (
      <ol className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <span
              className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary"
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="min-w-0">{item}</span>
          </li>
        ))}
      </ol>
    );
  }

  const entries = Object.entries(parsed).filter(
    ([, value]) => value !== null && value !== undefined && value !== ""
  );
  if (entries.length === 0) return null;
  return (
    <dl className="space-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs leading-relaxed">
          <dt className="shrink-0 font-medium text-muted-foreground/80">{DETAIL_LABELS[key] ?? key}:</dt>
          <dd className="min-w-0 break-all font-mono text-muted-foreground">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Live execution timeline for one agent run (plan / tool calls / artifacts),
 * rendered above the assistant message content like chat.z.ai's task card.
 * Expanded while streaming; auto-collapses to a one-line summary when done.
 */
export function AgentTimeline({ steps, streaming }: { steps: AgentStepItem[]; streaming: boolean }) {
  const [open, setOpen] = React.useState(streaming);
  const [expandedRows, setExpandedRows] = React.useState<ReadonlySet<string>>(() => new Set<string>());

  // Auto-collapse when the run finishes (fresh conversations hydrate collapsed).
  React.useEffect(() => {
    if (!streaming) setOpen(false);
  }, [streaming]);

  const doneCount = steps.filter((s) => s.status === "done").length;
  const errorCount = steps.filter((s) => s.status === "error").length;
  const runningCount = steps.filter((s) => s.status === "running").length;

  const summary = errorCount
    ? `${doneCount}/${steps.length} steps · ${errorCount} failed`
    : runningCount
      ? `Working — ${doneCount}/${steps.length} done`
      : `${steps.length} step${steps.length === 1 ? "" : "s"} completed`;

  const toggleRow = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? "Collapse agent activity" : "Expand agent activity"}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-card/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10"
          aria-hidden
        >
          <Bot className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="shrink-0 text-sm font-medium">Agent activity</span>
        <span
          className={cn(
            "min-w-0 truncate text-xs text-muted-foreground",
            streaming && runningCount > 0 && "shimmer-text"
          )}
        >
          {summary}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
          aria-hidden
        />
      </button>

      {open && (
        <ul className="border-t border-border/60 px-1.5 py-1.5">
          {steps.map((step) => {
            const expanded = expandedRows.has(step.id);
            const hasDetail = parseDetail(step.detail) !== null;
            return (
              <li key={step.id}>
                <button
                  type="button"
                  onClick={() => hasDetail && toggleRow(step.id)}
                  aria-expanded={hasDetail ? expanded : undefined}
                  disabled={!hasDetail}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
                    hasDetail
                      ? "hover:bg-background/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                      : "cursor-default"
                  )}
                >
                  <StepIcon step={step} />
                  <span className={cn("min-w-0 flex-1 truncate", step.status === "running" && "shimmer-text")}>
                    {step.title}
                  </span>
                  <StatusIcon status={step.status} />
                </button>
                {expanded && hasDetail && (
                  <div className="mb-1 ml-8 mr-2 rounded-lg border border-border/50 bg-background/50 px-3 py-2 scrollbar-thin">
                    <StepDetail step={step} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
