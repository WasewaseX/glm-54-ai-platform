import "server-only";
import { getBookDef, listBooks, loadState } from "@/lib/novel-engine";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

/** GET /api/novel/status?bookId=… — defaults to the most recently updated book. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  let bookId = (url.searchParams.get("bookId") ?? "").trim();
  if (!bookId) {
    bookId = listBooks()[0]?.bookId ?? "the-dreaming-vat";
  }

  const def = getBookDef(bookId);
  if (!def) return Response.json({ error: "unknown book" }, { status: 404 });

  const state = loadState(bookId);
  if (!state) {
    return Response.json({
      bookId,
      title: def.title,
      phase: "idle",
      running: false,
      chaptersDone: 0,
      totalChapters: 100,
      totalWords: 0,
    });
  }

  // A run is "live" if a runner process holds the book's PID file and is alive.
  let running = false;
  const pidPath = join("/tmp", `novel-${bookId}.pid`);
  if (existsSync(pidPath)) {
    try {
      const pid = Number(readFileSync(pidPath, "utf8").trim());
      process.kill(pid, 0); // throws if not alive
      running = true;
    } catch {
      running = false;
    }
  }

  const failedChapters = Object.entries(state.chapters)
    .filter(([, c]) => c.status === "failed")
    .map(([n]) => Number(n));

  return Response.json({
    bookId: state.bookId,
    title: state.title,
    phase: state.phase,
    running,
    chaptersDone: state.chaptersDone,
    totalChapters: 100,
    totalWords: state.totalWords,
    wordsPerChapterTarget: 2200,
    errors: state.errors.slice(-5),
    errorCount: state.errors.length,
    failedChapters,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
  });
}
