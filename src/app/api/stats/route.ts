import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { UsageStats } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();

  const [totalMessages, totalConversations, events, last24h, searches] = await Promise.all([
    db.message.count({ where: { conversation: { userId: user.id } } }),
    db.conversation.count({ where: { userId: user.id } }),
    db.usageEvent.findMany({
      where: { userId: user.id, kind: { in: ["chat", "vision", "summarize"] } },
      select: { promptTokens: true, completionTokens: true, latencyMs: true },
    }),
    db.message.count({
      where: {
        conversation: { userId: user.id },
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    db.usageEvent.count({ where: { userId: user.id, kind: "search" } }),
  ]);

  const promptTokens = events.reduce((a, e) => a + e.promptTokens, 0);
  const completionTokens = events.reduce((a, e) => a + e.completionTokens, 0);
  const avgLatencyMs =
    events.length > 0 ? Math.round(events.reduce((a, e) => a + e.latencyMs, 0) / events.length) : 0;

  const stats: UsageStats = {
    totalMessages,
    totalConversations,
    promptTokens,
    completionTokens,
    avgLatencyMs,
    last24hMessages: last24h,
    searches,
  };

  return Response.json({ stats });
}
