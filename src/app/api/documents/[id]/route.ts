import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { chatOnce, normalizeAiError } from "@/lib/ai";
import { estimateTokens } from "@/lib/rag";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET /api/documents/:id — full detail (content + summary). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) return Response.json({ error: "Document not found." }, { status: 404 });

  return Response.json({
    document: {
      id: doc.id,
      name: doc.name,
      mime: doc.mime,
      size: doc.size,
      kind: doc.kind,
      chunkCount: doc.chunkCount,
      hasSummary: Boolean(doc.summary),
      createdAt: doc.createdAt.toISOString(),
      content: doc.kind === "text" ? doc.content : null,
      summary: doc.summary,
      isImage: doc.kind === "image",
      isBinary: doc.kind === "binary",
    },
  });
}

/** POST /api/documents/:id — actions: { action: "summarize" } (AI map-reduce summary). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) return Response.json({ error: "Document not found." }, { status: 404 });

  let action = "summarize";
  try {
    const body = (await req.json()) as { action?: string };
    if (body.action) action = body.action;
  } catch {
    /* default action */
  }

  if (action !== "summarize") {
    return Response.json({ error: "Unknown action." }, { status: 400 });
  }
  if (doc.kind !== "text" || !doc.content) {
    return Response.json(
      { error: "Summaries are available for text documents. Images and PDFs can be analyzed by attaching them to a message." },
      { status: 400 }
    );
  }

  const startedAt = Date.now();
  try {
    let summary: string;

    if (doc.content.length <= 6_000) {
      const { text } = await chatOnce(
        [
          { role: "assistant", content: "Summarize the document in a compact Markdown brief: 2-3 sentence overview, then key points as bullets. Keep it under 200 words." },
          { role: "user", content: doc.content.slice(0, 6_000) },
        ],
        { maxChars: 1_200 }
      );
      summary = text;
    } else {
      // Map-reduce over chunks (max 16 chunks sampled across the document).
      const chunks = await db.documentChunk.findMany({
        where: { documentId: doc.id },
        orderBy: { idx: "asc" },
        take: 16,
      });
      const partials: string[] = [];
      for (const chunk of chunks) {
        const { text } = await chatOnce(
          [
            { role: "assistant", content: "Summarize this excerpt in 2-3 bullet points. Preserve key facts, names, and numbers. Bullets only." },
            { role: "user", content: chunk.text.slice(0, 4_000) },
          ],
          { maxChars: 600 }
        );
        partials.push(text);
      }
      const { text: combined } = await chatOnce(
        [
          { role: "assistant", content: "Combine these section summaries into one compact Markdown brief: 2-3 sentence overview, then key points as bullets. Under 250 words. Deduplicate." },
          { role: "user", content: partials.join("\n\n").slice(0, 12_000) },
        ],
        { maxChars: 1_500 }
      );
      summary = combined;
    }

    await db.document.update({
      where: { id: doc.id },
      data: { summary },
    });
    await db.usageEvent.create({
      data: {
        userId: user.id,
        kind: "summarize",
        promptTokens: estimateTokens(doc.content.slice(0, 12_000)),
        completionTokens: estimateTokens(summary),
        latencyMs: Date.now() - startedAt,
      },
    });

    return Response.json({ summary });
  } catch (err) {
    const normalized = normalizeAiError(err);
    return Response.json({ error: normalized.message }, { status: normalized.status });
  }
}

/** DELETE /api/documents/:id */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const doc = await db.document.findFirst({ where: { id, userId: user.id } });
  if (!doc) return Response.json({ error: "Document not found." }, { status: 404 });

  await db.document.delete({ where: { id: doc.id } });
  return Response.json({ ok: true });
}
