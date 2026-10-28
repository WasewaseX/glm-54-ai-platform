import "server-only";
import { forgeOrExisting, getBookDef, loadState, startBookRunner } from "@/lib/novel-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/novel/start
 *   {"premise": "...", "title": "optional"} → dedup against the library, then
 *                                             forge a NEW book and start writing it
 *   {"bookId": "..."}                       → (re)launch a known book's checkpointed runner
 */
export async function POST(req: Request) {
  let body: { bookId?: unknown; premise?: unknown; title?: unknown; forceNew?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body → fall through to validation error */
  }

  const premise = typeof body.premise === "string" ? body.premise : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
  const forceNew = body.forceNew === true;
  let bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";

  try {
    if (premise) {
      // Dedup: a re-sent premise returns the existing book instead of forging
      // a duplicate (unless the caller explicitly sets forceNew: true).
      const outcome = await forgeOrExisting({ premise, title, forceNew });
      const state = loadState(outcome.def.id);
      return Response.json({
        ok: true,
        bookId: outcome.def.id,
        title: outcome.def.title,
        message: outcome.note,
        forgeKind: outcome.kind,
        phase: state?.phase ?? "idle",
        chaptersDone: state?.chaptersDone ?? 0,
        totalWords: state?.totalWords ?? 0,
      });
    }
    if (!bookId || !getBookDef(bookId)) {
      return Response.json(
        { ok: false, error: "provide a known bookId, or a premise to forge a new book" },
        { status: 400 }
      );
    }
    const result = startBookRunner(bookId);
    const state = loadState(bookId);
    return Response.json({
      ok: true,
      bookId,
      title: state?.title ?? title ?? bookId,
      message: result.message,
      phase: state?.phase ?? "idle",
      chaptersDone: state?.chaptersDone ?? 0,
      totalWords: state?.totalWords ?? 0,
    });
  } catch (err) {
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
