import "server-only";
import { requireUser } from "@/lib/auth";
import { webSearch } from "@/lib/ai";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const BodySchema = z.object({ query: z.string().min(1).max(400), num: z.number().int().min(1).max(10).optional() });

/** POST /api/search — standalone web search (used by the docs helper). */
export async function POST(req: Request) {
  const user = await requireUser();
  const rate = checkRate(`search:${user.id}`, RATE_LIMITS.search.limit, RATE_LIMITS.search.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Query required." }, { status: 400 });
  }

  try {
    const results = await webSearch(body.query, body.num ?? 6);
    return Response.json({ results });
  } catch (err) {
    console.error("[search] failed:", err);
    return Response.json({ error: "Web search is temporarily unavailable." }, { status: 502 });
  }
}
