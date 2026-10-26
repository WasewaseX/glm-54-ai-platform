import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/documents/:id/raw — serve stored image bytes (for <img> rendering). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc || !doc.content) return new Response("Not found", { status: 404 });

  if (doc.kind === "image") {
    const buffer = Buffer.from(doc.content, "base64");
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": doc.mime || "image/png",
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  if (doc.kind === "text") {
    return new Response(doc.content, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  return new Response("Unsupported", { status: 415 });
}
