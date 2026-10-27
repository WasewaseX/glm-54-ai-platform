"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { Activity, Database, RefreshCw } from "lucide-react";

type Platform = {
  conversations: number;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  avgLatencyMs: number;
  searches: number;
  documents: number;
  artifacts: number;
  agentSteps: number;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function RealMetrics() {
  const [platform, setPlatform] = React.useState<Platform | null>(null);
  const [error, setError] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch("/api/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { platform: Platform };
      setPlatform(data.platform);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const cells = platform
    ? [
        { value: fmt(platform.conversations), label: "Conversations in DB" },
        { value: fmt(platform.messages), label: "Messages persisted" },
        { value: fmt(platform.promptTokens + platform.completionTokens), label: "Tokens served" },
        { value: `${(platform.avgLatencyMs / 1000).toFixed(1)}s`, label: "Avg latency" },
        { value: fmt(platform.searches), label: "Web searches" },
        { value: fmt(platform.artifacts), label: "Artifacts built" },
      ]
    : [];

  return (
    <section
      aria-label="Real platform metrics from the live database"
      className="mx-auto mt-8 w-full max-w-xl rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-emerald-500" aria-hidden />
          <h2 className="text-sm font-semibold">Real metrics — live DB</h2>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            platform-wide · not demo data
          </span>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh metrics"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
        >
          <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} aria-hidden />
        </button>
      </header>

      {error && (
        <p className="mt-3 text-xs text-destructive">
          Could not load stats. Check that the server is running and try again.
        </p>
      )}

      {loading && !platform && (
        <div className="mt-3 grid grid-cols-3 gap-2" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      )}

      {platform && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="mt-3 grid grid-cols-3 gap-2"
        >
          {cells.map((c) => (
            <div
              key={c.label}
              className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2.5 text-left"
            >
              <div className="font-mono text-lg font-semibold leading-tight tabular-nums">
                {c.value}
              </div>
              <div className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{c.label}</div>
            </div>
          ))}
        </motion.div>
      )}

      <p className="mt-3 flex items-start gap-1.5 text-left text-[10px] leading-relaxed text-muted-foreground">
        <Activity className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
        Every value is queried live from the platform&apos;s SQLite database via <code className="font-mono">/api/stats</code> —
        unlike the earlier investor deck (demo outline by glm-4-plus), nothing here is invented.
        Full audit: <code className="font-mono">scripts/collect-real-metrics.ts</code> · repo: github.com/WasewaseX/glm-54-ai-platform.
      </p>
    </section>
  );
}
