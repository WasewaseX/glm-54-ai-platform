import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import type { AgentStepItem, ArtifactItem, ArtifactKind, ChatMessage, ConversationDetail } from "@/lib/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  systemPrompt: z.string().max(8_000).nullable().optional(),
});

async function getOwnedConversation(id: string, userId: string) {
  return db.conversation.findFirst({ where: { id, userId } });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const conversation = await getOwnedConversation(id, user.id);
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });

  const rows = await db.message.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: "asc" },
  });

  const [artifactRows, stepRows] = await Promise.all([
    db.artifact.findMany({
      where: { conversationId: conversation.id },
      orderBy: { updatedAt: "desc" },
    }),
    db.agentStep.findMany({
      where: { conversationId: conversation.id },
      orderBy: { idx: "asc" },
    }),
  ]);

  const artifacts: ArtifactItem[] = artifactRows.map((a) => ({
    id: a.id,
    conversationId: a.conversationId,
    messageId: a.messageId,
    title: a.title,
    kind: a.kind as ArtifactKind,
    language: a.language,
    content: a.content,
    version: a.version,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  }));

  const steps: AgentStepItem[] = stepRows.map((s) => ({
    id: s.id,
    messageId: s.messageId,
    idx: s.idx,
    kind: s.kind as AgentStepItem["kind"],
    tool: s.tool,
    title: s.title,
    detail: s.detail,
    status: s.status as AgentStepItem["status"],
    createdAt: s.createdAt.toISOString(),
  }));

  const messages: ChatMessage[] = rows.map((m) => {
    let attachments = null;
    if (m.attachments) {
      try {
        attachments = JSON.parse(m.attachments);
      } catch {
        attachments = null;
      }
    }
    return {
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content,
      thinking: m.thinking,
      attachments,
      model: m.model,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      latencyMs: m.latencyMs,
      webSearchUsed: m.webSearchUsed,
      status: m.status as ChatMessage["status"],
      error: m.error,
      createdAt: m.createdAt.toISOString(),
    };
  });

  const detail: ConversationDetail = {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    systemPrompt: conversation.systemPrompt,
    pinned: conversation.pinned,
    archived: conversation.archived,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messages,
    artifacts,
    steps,
  };

  return Response.json({ conversation: detail });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const rate = checkRate(`read:${user.id}`, RATE_LIMITS.authedRead.limit, RATE_LIMITS.authedRead.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  const { id } = await ctx.params;
  const conversation = await getOwnedConversation(id, user.id);
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });

  let patch: z.infer<typeof PatchSchema>;
  try {
    patch = PatchSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid update payload." }, { status: 400 });
  }

  const updated = await db.conversation.update({ where: { id: conversation.id }, data: patch });

  return Response.json({
    conversation: {
      id: updated.id,
      title: updated.title,
      pinned: updated.pinned,
      archived: updated.archived,
      systemPrompt: updated.systemPrompt,
      updatedAt: updated.updatedAt.toISOString(),
    },
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const conversation = await getOwnedConversation(id, user.id);
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });

  await db.conversation.delete({ where: { id: conversation.id } });
  return Response.json({ ok: true });
}
