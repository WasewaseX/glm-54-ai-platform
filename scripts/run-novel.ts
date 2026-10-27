// Book Forge CLI runner — resumable marathon job for one book.
// Usage: bun scripts/run-novel.ts <bookId> [--restart]
import { runBook, loadState, BOOKS } from "../src/lib/novel-engine";
import { writeFileSync } from "node:fs";

const bookId = process.argv[2] ?? "the-dreaming-vat";
const restart = process.argv.includes("--restart");

if (!BOOKS[bookId]) {
  console.error(`Unknown book "${bookId}". Available: ${Object.keys(BOOKS).join(", ")}`);
  process.exit(1);
}

// Register PID so the API/UI can detect a live runner.
writeFileSync(`/tmp/novel-${bookId}.pid`, String(process.pid));

const existing = loadState(bookId);
if (existing && !restart) {
  console.log(`Resuming "${existing.title}" — ${existing.chaptersDone}/100 chapters, ${existing.totalWords} words`);
}

try {
  const state = await runBook(bookId, restart);
  console.log(
    `DONE PASS: ${state.chaptersDone}/100 chapters · ${state.totalWords.toLocaleString()} words · phase=${state.phase}` +
      (state.errors.length ? ` · errors=${state.errors.length}` : "")
  );
  process.exit(state.phase === "done" ? 0 : 2);
} catch (err) {
  console.error("FATAL:", err);
  process.exit(1);
}
