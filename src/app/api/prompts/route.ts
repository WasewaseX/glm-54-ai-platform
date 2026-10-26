import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import type { SystemPromptItem } from "@/lib/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  content: z.string().min(1).max(8_000),
  isDefault: z.boolean().optional(),
});

function toItem(p: { id: string; name: string; content: string; isDefault: boolean; createdAt: Date }): SystemPromptItem {
  return {
    id: p.id,
    name: p.name,
    content: p.content,
    isDefault: p.isDefault,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function GET() {
  const user = await requireUser();
  const prompts = await db.systemPrompt.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return Response.json({ prompts: prompts.map(toItem) });
}

export async function POST(req: Request) {
  const user = await requireUser();
  const rate = checkRate(`prompts:${user.id}`, RATE_LIMITS.prompts.limit, RATE_LIMITS.prompts.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Name (1-80 chars) and content (1-8000 chars) required." }, { status: 400 });
  }

  if (body.isDefault) {
    await db.systemPrompt.updateMany({ where: { userId: user.id, isDefault: true }, data: { isDefault: false } });
  }
  const prompt = await db.systemPrompt.create({
    data: { userId: user.id, name: body.name, content: body.content, isDefault: body.isDefault ?? false },
  });

  return Response.json({ prompt: toItem(prompt) }, { status: 201 });
}
