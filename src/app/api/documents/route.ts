import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import type { DocumentItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await requireUser();
  const rate = checkRate(`read:${user.id}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  const docs = await db.document.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const items: DocumentItem[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    mime: d.mime,
    size: d.size,
    kind: d.kind as DocumentItem["kind"],
    chunkCount: d.chunkCount,
    hasSummary: Boolean(d.summary),
    createdAt: d.createdAt.toISOString(),
    excerpt: d.content && d.kind === "text" ? d.content.slice(0, 220) : undefined,
  }));

  return Response.json({ documents: items });
}
