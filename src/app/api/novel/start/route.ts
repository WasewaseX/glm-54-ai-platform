import "server-only";
import { startBookRunner, BOOKS } from "@/lib/novel-engine";

export const dynamic = "force-dynamic";

const BOOK_ID = "the-dreaming-vat";

export async function POST() {
  const def = BOOKS[BOOK_ID];
  if (!def) return Response.json({ error: "unknown book" }, { status: 404 });

  const result = startBookRunner(BOOK_ID);
  return Response.json({ ok: true, message: result.message });
}
