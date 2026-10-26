import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import type { ConversationSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser();
  const rate = checkRate(`read:${user.id}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";
  const archived = searchParams.get("archived") === "1";

  const conversations = await db.conversation.findMany({
    where: {
      userId: user.id,
      archived,
      ...(q
        ? {
            OR: [{ title: { contains: q } }],
          }
        : {}),
    },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    take: 200,
    include: {
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true },
      },
      _count: { select: { messages: true } },
    },
  });

  const summaries: ConversationSummary[] = conversations.map((c) => ({
    id: c.id,
    title: c.title,
    model: c.model,
    systemPrompt: c.systemPrompt,
    pinned: c.pinned,
    archived: c.archived,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    messageCount: c._count.messages,
    preview:
      c.messages[0]?.content
        ?.replace(/\[\[artifact:[^\]\n]+\]\]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 140) ?? null,
  }));

  return Response.json({ conversations: summaries });
}

export async function POST() {
  const user = await requireUser();
  const rate = checkRate(`read:${user.id}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  const conversation = await db.conversation.create({
    data: { userId: user.id },
  });

  const summary: ConversationSummary = {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    systemPrompt: conversation.systemPrompt,
    pinned: conversation.pinned,
    archived: conversation.archived,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messageCount: 0,
    preview: null,
  };
  return Response.json({ conversation: summary }, { status: 201 });
}

export async function DELETE() {
  const user = await requireUser();
  await db.conversation.deleteMany({ where: { userId: user.id } });
  return Response.json({ ok: true });
}
