import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  content: z.string().min(1).max(8_000).optional(),
  isDefault: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const prompt = await db.systemPrompt.findFirst({ where: { id, userId: user.id } });
  if (!prompt) return Response.json({ error: "Prompt not found." }, { status: 404 });

  let patch: z.infer<typeof PatchSchema>;
  try {
    patch = PatchSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (patch.isDefault) {
    await db.systemPrompt.updateMany({ where: { userId: user.id, isDefault: true }, data: { isDefault: false } });
  }

  const updated = await db.systemPrompt.update({ where: { id: prompt.id }, data: patch });
  return Response.json({
    prompt: {
      id: updated.id,
      name: updated.name,
      content: updated.content,
      isDefault: updated.isDefault,
      createdAt: updated.createdAt.toISOString(),
    },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const prompt = await db.systemPrompt.findFirst({ where: { id, userId: user.id } });
  if (!prompt) return Response.json({ error: "Prompt not found." }, { status: 404 });

  await db.systemPrompt.delete({ where: { id: prompt.id } });
  return Response.json({ ok: true });
}
