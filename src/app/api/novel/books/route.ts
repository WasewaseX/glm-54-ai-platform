import "server-only";
import { listBooks } from "@/lib/novel-engine";

export const dynamic = "force-dynamic";

/** GET /api/novel/books — every known book with live progress (for the Library UI). */
export async function GET() {
  return Response.json({ books: listBooks() });
}
