import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { runAgent, AGENT_SYSTEM_PROMPT } from "@/lib/agent-engine";
import { AGENT_BY_ID } from "@/lib/agents";
import { historyWindow, LIMITS } from "@/lib/context-builder";
import { retrieveChunks, estimateTokens } from "@/lib/rag";
import { normalizeAiError, chatOnce, type SdkChatMessage } from "@/lib/ai";
import type { AgentStreamEvent } from "@/lib/types";
import type { Conversation } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().max(64_000).optional(),
  attachmentIds: z.array(z.string()).max(LIMITS.MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  thinking: z.boolean().optional(),
  agentId: z.string().max(40).optional(),
});

function sseFrame(event: AgentStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

export async function POST(req: Request) {
  const user = await requireUser();

  const rate = checkRate(`agent:${user.id}`, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const userText = body.message?.trim() ?? "";
  const attachmentIds = body.attachmentIds ?? [];
  if (!userText && attachmentIds.length === 0) {
    return Response.json({ error: "Message or attachment required." }, { status: 400 });
  }

  // ---------- Resolve conversation ----------
  let conversation: Conversation | null = null;
  if (body.conversationId) {
    conversation = await db.conversation.findFirst({
      where: { id: body.conversationId, userId: user.id },
    });
    if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
  }
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { userId: user.id, title: "New conversation" },
    });
  }

  // ---------- Resolve attachments ----------
  const documents = attachmentIds.length
    ? await db.document.findMany({ where: { id: { in: attachmentIds }, userId: user.id } })
    : [];
  const textDocs = documents.filter((d) => d.kind === "text" && d.content);
  const visualDocs = documents.filter((d) => d.kind === "image" || d.kind === "binary");
  if (visualDocs.length > 0) {
    return Response.json(
      { error: "Agent mode currently supports text documents. Use standard chat for images and PDFs." },
      { status: 400 }
    );
  }

  const attachmentMeta = documents.map((d) => ({
    id: d.id,
    name: d.name,
    mime: d.mime,
    size: d.size,
    kind: d.kind as "text" | "image" | "binary",
    documentId: d.id,
  }));

  // ---------- Persist the user turn ----------
  const userMessage = await db.message.create({
    data: {
      conversationId: conversation.id,
      role: "user",
      content: userText,
      attachments: attachmentMeta.length ? JSON.stringify(attachmentMeta) : null,
    },
  });
  const assistantMessage = await db.message.create({
    data: {
      conversationId: conversation.id,
      role: "assistant",
      content: "",
      status: "streaming",
      webSearchUsed: false,
    },
  });

  const convId = conversation.id;
  const startedAt = Date.now();

  const upstreamAbort = new AbortController();
  req.signal.addEventListener("abort", () => upstreamAbort.abort());

  // ---------- Compose base messages ----------
  const persona = body.agentId ? AGENT_BY_ID[body.agentId]?.systemPrompt : undefined;
  const systemPrompt = AGENT_SYSTEM_PROMPT + (persona ? `\n\n# ACTIVE MODE\n${persona}` : "");

  const historyRows = await db.message.findMany({
    where: { conversationId: convId, id: { notIn: [assistantMessage.id] } },
    orderBy: { createdAt: "asc" },
  });
  const history = historyWindow(
    historyRows
      .filter((m) => m.id !== userMessage.id)
      .map((m) => ({
        id: m.id,
        role: m.role as "user" | "assistant",
        content: m.content,
        status: "complete" as const,
        createdAt: m.createdAt.toISOString(),
      }))
  );

  // RAG over attached text documents
  let ragContext = "";
  if (textDocs.length > 0 && userText) {
    const docNameById = new Map<string, string>();
    const allChunks: Array<{ idx: number; text: string; tokens: number }> = [];
    for (const doc of textDocs) {
      const rows = await db.documentChunk.findMany({
        where: { documentId: doc.id },
        orderBy: { idx: "asc" },
      });
      for (const row of rows) {
        docNameById.set(String(allChunks.length), doc.name);
        allChunks.push({ idx: allChunks.length, text: row.text, tokens: row.tokens });
      }
    }
    const top = retrieveChunks(userText, allChunks, 6);
    if (top.length > 0) {
      ragContext = top
        .map(({ chunk }) => {
          const name = docNameById.get(String(chunk.idx));
          return name ? `[${name}]\n${chunk.text}` : chunk.text;
        })
        .join("\n\n---\n\n")
        .slice(0, LIMITS.RAG_CHAR_BUDGET);
    }
  }

  const userTurn =
    (userText || "(see attached documents)") +
    (ragContext
      ? "\n\nAttached document excerpts are provided in the context message above; use them when relevant."
      : "");

  const baseMessages: SdkChatMessage[] = [{ role: "assistant", content: systemPrompt }];
  for (const m of history) {
    baseMessages.push({ role: m.role, content: clip(m.content, 8_000) });
  }
  if (ragContext) {
    baseMessages.push({
      role: "assistant",
      content:
        "Context for the next user message (retrieved document excerpts):\n\n" +
        ragContext +
        "\n\nUse this context when relevant; do not fabricate beyond it.",
    });
  }
  baseMessages.push({ role: "user", content: clip(userTurn, 16_000) });

  // ---------- Stream ----------
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: AgentStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(event));
        } catch {
          closed = true;
        }
      };

      try {
        send({
          type: "meta",
          conversationId: convId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
        });

        const stats = await runAgent(
          {
            userId: user.id,
            conversationId: convId,
            assistantMessageId: assistantMessage.id,
            baseMessages,
            thinking: Boolean(body.thinking),
            signal: upstreamAbort.signal,
          },
          send
        );

        const latencyMs = Date.now() - startedAt;
        await db.message.update({
          where: { id: assistantMessage.id },
          data: {
            content: stats.fullText || "(no output)",
            thinking: stats.thinkingText || null,
            model: stats.model,
            promptTokens: stats.usage?.prompt_tokens ?? null,
            completionTokens: stats.usage?.completion_tokens ?? estimateTokens(stats.fullText),
            latencyMs,
            status: stats.status,
            webSearchUsed: stats.toolsUsed.includes("web_search"),
          },
        });
        await db.usageEvent.create({
          data: {
            userId: user.id,
            kind: "agent",
            promptTokens: stats.usage?.prompt_tokens ?? 0,
            completionTokens: stats.usage?.completion_tokens ?? estimateTokens(stats.fullText),
            latencyMs,
          },
        });
        await db.conversation.update({ where: { id: convId }, data: { model: stats.model } });

        // ----- Auto-title on first exchange -----
        const msgCount = await db.message.count({ where: { conversationId: convId } });
        if (msgCount <= 2 && !upstreamAbort.signal.aborted) {
          try {
            const { text: title } = await chatOnce(
              [
                {
                  role: "assistant",
                  content:
                    "Generate a concise conversation title (max 6 words) for the exchange. Reply with the title only, no quotes.",
                },
                {
                  role: "user",
                  content: `User: ${userText.slice(0, 500)}\nAssistant: ${stats.fullText.slice(0, 500)}`,
                },
              ],
              { maxChars: LIMITS.TITLE_MAX_CHARS }
            );
            const clean = title.replace(/^["'#\s]+|["'\s]+$/g, "").slice(0, LIMITS.TITLE_MAX_CHARS);
            if (clean) {
              await db.conversation.update({ where: { id: convId }, data: { title: clean } });
              send({ type: "title", title: clean });
            }
          } catch (err) {
            console.error("[agent] title generation failed:", err);
          }
        }

        send({
          type: "done",
          assistantMessageId: assistantMessage.id,
          model: stats.model,
          promptTokens: stats.usage?.prompt_tokens ?? null,
          completionTokens: stats.usage?.completion_tokens ?? null,
          latencyMs,
          status: stats.status,
          iterations: stats.iterations,
        });
      } catch (err) {
        const normalized = normalizeAiError(err);
        console.error("[agent] run error:", err);
        try {
          await db.message.update({
            where: { id: assistantMessage.id },
            data: { status: "error", error: normalized.message, latencyMs: Date.now() - startedAt },
          });
        } catch (dbErr) {
          console.error("[agent] failed to persist error state:", dbErr);
        }
        send({ type: "error", message: normalized.message, fatal: true });
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* noop */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
