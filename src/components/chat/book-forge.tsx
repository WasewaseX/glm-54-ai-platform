"use client";

import * as React from "react";
import { BookOpen, CheckCircle2, Loader2, Play, RefreshCw, TriangleAlert } from "lucide-react";

type NovelStatus = {
  bookId: string;
  title: string;
  phase: "idle" | "bible" | "outline" | "chapters" | "done";
  running?: boolean;
  chaptersDone?: number;
  totalChapters?: number;
  totalWords?: number;
  wordsPerChapterTarget?: number;
  errorCount?: number;
  failedChapters?: number[];
  updatedAt?: string;
};

const fmt = (n: number) => n.toLocaleString("en-US");

export function BookForge() {
  const [status, setStatus] = React.useState<NovelStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/novel/status", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setStatus((await res.json()) as NovelStatus);
    } catch {
      /* keep last state */
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const start = React.useCallback(async () => {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/novel/start", { method: "POST" });
      const data = (await res.json()) as { message?: string };
      setNotice(data.message ?? "Book Forge started.");
      await load();
    } catch {
      setNotice("Could not start the runner. Check server logs.");
    } finally {
      setBusy(false);
    }
  }, [load]);

  const done = status?.phase === "done";
  const running = status?.running && !done;
  const chapters = status?.chaptersDone ?? 0;
  const total = status?.totalChapters ?? 100;
  const pct = Math.round((chapters / total) * 100);

  return (
    <section
      aria-label="Book Forge — long-form novel pipeline"
      className="mx-auto mt-4 w-full max-w-xl rounded-2xl border border-border/60 bg-card/70 p-4 backdrop-blur"
    >
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <BookOpen className="h-4 w-4 shrink-0 text-violet-500" aria-hidden />
          <h2 className="truncate text-sm font-semibold">Book Forge — “{status?.title ?? "The Dreaming Vat"}”</h2>
        </div>
        {running && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" aria-hidden />}
        {done && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />}
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh Book Forge status"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      <p className="mt-2 text-left text-[11px] leading-relaxed text-muted-foreground">
        100 chapters × ~2,200 words — written by the platform&apos;s own pipeline: story bible → 10-part
        outline → 10 parallel block-workers with rolling continuity, checkpointed after every chapter.
        This is how the platform handles outputs far beyond a single model response.
      </p>

      {status && status.phase !== "idle" && (
        <div className="mt-3">
          <div className="flex items-baseline justify-between font-mono text-xs tabular-nums">
            <span>
              {chapters}/{total} chapters
            </span>
            <span>{fmt(status.totalWords ?? 0)} words</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-500"
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Novel generation progress"
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
            <span>phase: {status.phase}</span>
            {status.errorCount ? (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <TriangleAlert className="h-3 w-3" aria-hidden /> {status.errorCount} retries logged
              </span>
            ) : null}
            {status.updatedAt ? <span>updated {new Date(status.updatedAt).toLocaleTimeString()}</span> : null}
          </div>
        </div>
      )}

      {notice && <p className="mt-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px]">{notice}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!done && (
          <button
            type="button"
            onClick={() => void start()}
            disabled={busy || running}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
          >
            {running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Writing…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden /> {chapters > 0 ? "Resume run" : "Start writing"}
              </>
            )}
          </button>
        )}
        {done && (
          <a
            href="/deliverables/the-dreaming-vat.md"
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden /> Download full manuscript (.md)
          </a>
        )}
        {(running || done) && (
          <a
            href="/deliverables/the-dreaming-vat.pdf"
            download
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
          >
            PDF
          </a>
        )}
      </div>
    </section>
  );
}
