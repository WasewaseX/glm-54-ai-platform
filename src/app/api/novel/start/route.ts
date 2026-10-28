import "server-only";
import { createBook, getBookDef, loadState, startBookRunner } from "@/lib/novel-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/novel/start
 *   {"premise": "...", "title": "optional"} → forge a NEW book and start writing it
 *   {"bookId": "..."}                       → (re)launch a known book's checkpointed runner
 */
export async function POST(req: Request) {
  let body: { bookId?: unknown; premise?: unknown; title?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* empty body → fall through to validation error */
  }

  const premise = typeof body.premise === "string" ? body.premise : "";
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : undefined;
  let bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";

  try {
    if (premise) {
      const def = await createBook({ premise, title });
      bookId = def.id;
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
