import "server-only";
import { loadState, BOOKS } from "@/lib/novel-engine";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const BOOK_ID = "the-dreaming-vat";

export async function GET() {
  const def = BOOKS[BOOK_ID];
  if (!def) return Response.json({ error: "unknown book" }, { status: 404 });

  const state = loadState(BOOK_ID);
  if (!state) {
    return Response.json({ phase: "idle", bookId: BOOK_ID, title: def.title });
  }

  // A run is "live" if a runner process has the book's PID file and it's alive.
  let running = false;
  const pidPath = join("/tmp", `novel-${BOOK_ID}.pid`);
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
