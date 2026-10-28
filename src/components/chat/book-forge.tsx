"use client";

import * as React from "react";
import {
  BookOpen,
  CheckCircle2,
  Download,
  FlaskConical,
  Loader2,
  Play,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

type BookSummary = {
  bookId: string;
  title: string;
  logline: string;
  phase: "idle" | "bible" | "outline" | "chapters" | "done";
  running: boolean;
  chaptersDone: number;
  totalWords: number;
  updatedAt: string;
  deliverable: boolean;
};

const fmt = (n: number) => n.toLocaleString("en-US");

const PHASE_LABEL: Record<BookSummary["phase"], string> = {
  idle: "queued",
  bible: "story bible",
  outline: "outlining",
  chapters: "writing chapters",
  done: "complete",
};

function BookCard({
  book,
  onResume,
  resuming,
}: {
  book: BookSummary;
  onResume: (bookId: string) => void;
  resuming: boolean;
}) {
  const done = book.phase === "done";
  const active = book.running && !done;
  const stalled = !book.running && !done;
  const chapters = book.chaptersDone ?? 0;
  const pct = Math.min(100, Math.round((chapters / 100) * 100));
  const wpc = chapters > 0 ? Math.round(book.totalWords / chapters) : 0;

  return (
    <article
      className={cn(
        "rounded-2xl border bg-card/80 p-4 text-left backdrop-blur transition-shadow hover:shadow-lg",
        done ? "border-emerald-500/25" : active ? "border-violet-500/30" : "border-border/60"
      )}
      aria-label={`Book: ${book.title}`}
    >
      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-muted/50",
              active && "border-violet-500/40 bg-violet-500/10"
            )}
          >
            {done ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-hidden />
            ) : (
              <BookOpen className={cn("h-5 w-5", active ? "text-violet-500" : "text-foreground/70")} aria-hidden />
            )}
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-serif text-[15px] font-semibold leading-tight">{book.title}</h3>
            {book.logline && (
              <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                {book.logline}
              </p>
            )}
          </div>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
            done
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : active
                ? "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400"
                : "border-border bg-muted/60 text-muted-foreground"
          )}
        >
          {active && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
          {done ? "complete" : PHASE_LABEL[book.phase]}
        </span>
      </header>

      <div className="mt-3">
        <div className="flex items-baseline justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
          <span>
            {chapters}/100 chapters · {fmt(book.totalWords)} words
            {chapters > 0 && <span className="text-foreground/60"> · ~{fmt(wpc)} w/ch</span>}
          </span>
          <span className="text-foreground/70">{pct}%</span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-700",
              done ? "bg-emerald-500" : active ? "bg-violet-500" : "bg-muted-foreground/40"
            )}
            style={{ width: `${Math.max(pct, 1.5)}%` }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${book.title} progress`}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
          {active && <span className="text-violet-600 dark:text-violet-400">checkpointed · writing now</span>}
          {stalled && <span>paused — resumable, nothing is lost</span>}
          {book.updatedAt && <span>updated {new Date(book.updatedAt).toLocaleTimeString()}</span>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {done && book.deliverable && (
          <>
            <a
              href={`/deliverables/${book.bookId}.md`}
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:border-primary/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> .md
            </a>
            <a
              href={`/deliverables/${book.bookId}.pdf`}
              download
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] font-medium transition-colors hover:border-primary/40 hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> .pdf
            </a>
          </>
        )}
        {stalled && (
          <button
            type="button"
            onClick={() => onResume(book.bookId)}
            disabled={resuming}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
          >
            {resuming ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Resuming…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden /> Resume writing
              </>
            )}
          </button>
        )}
        {active && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <TriangleAlert className="h-3 w-3 text-amber-500" aria-hidden /> do not close the tab — it keeps
            running either way
          </span>
        )}
      </div>
    </article>
  );
}

export function BookForge() {
  const [books, setBooks] = React.useState<BookSummary[] | null>(null);
  const [resumingId, setResumingId] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/novel/books", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { books: BookSummary[] };
      setBooks(data.books);
    } catch {
      /* keep last state */
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  const resume = React.useCallback(
    async (bookId: string) => {
      setResumingId(bookId);
      setNotice(null);
      try {
        const res = await fetch("/api/novel/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bookId }),
        });
        const data = (await res.json()) as { message?: string; error?: string };
        setNotice(data.message ?? data.error ?? "Runner launched.");
        await load();
      } catch {
        setNotice("Could not start the runner. Check server logs.");
      } finally {
        setResumingId(null);
      }
    },
    [load]
  );

  const writing = books?.some((b) => b.running && b.phase !== "done") ?? false;

  return (
    <section
      aria-label="Book Forge library"
      className="mx-auto mt-8 w-full max-w-2xl text-left"
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-violet-500" aria-hidden />
          <h2 className="text-sm font-semibold tracking-tight">Book Forge Library</h2>
          {writing && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> writing live
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh library"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
        </button>
      </header>

      <p className="mt-1 px-1 text-left text-[11px] leading-relaxed text-muted-foreground">
        Every book the workspace has forged — 100 chapters × ~2,200 words each, written by the real
        pipeline (story bible → 10-part arc → outline briefs → parallel block-workers with rolling
        continuity), checkpointed after every chapter. Ask the agent to forge a new one anytime.
      </p>

      {notice && (
        <p className="mx-1 mt-2 rounded-lg bg-muted/60 px-2.5 py-1.5 text-[11px]">{notice}</p>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3">
        {books === null && (
          <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-card/60 p-4 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> loading library…
          </div>
        )}
        {books !== null && books.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border/60 bg-card/40 p-4 text-[11px] text-muted-foreground">
            No books yet — ask the agent to write a novel and it will appear here, live.
          </div>
        )}
        {books?.map((book) => (
          <BookCard key={book.bookId} book={book} onResume={resume} resuming={resumingId === book.bookId} />
        ))}
      </div>
    </section>
  );
}
