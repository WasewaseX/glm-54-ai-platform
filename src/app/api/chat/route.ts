import "server-only";
import { db } from "@/lib/db";
import {
  streamChat,
  streamVision,
  webSearch,
  chatOnce,
  normalizeAiError,
  type SdkChatMessage,
} from "@/lib/ai";
import type { VisionMessage } from "z-ai-web-dev-sdk/dist/index";
import {
  buildTextMessages,
  formatWebContext,
  historyWindow,
  DEFAULT_SYSTEM_PROMPT,
  LIMITS,
} from "@/lib/context-builder";
import { estimateTokens, retrieveChunks } from "@/lib/rag";
import { requireUser } from "@/lib/auth";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import type { ChatStreamEvent, WebSearchResult } from "@/lib/types";
import type { Conversation } from "@prisma/client";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BodySchema = z.object({
  conversationId: z.string().min(1).optional(),
  message: z.string().max(64_000).optional(),
  attachmentIds: z.array(z.string()).max(LIMITS.MAX_ATTACHMENTS_PER_MESSAGE).optional(),
  webSearch: z.boolean().optional(),
  thinking: z.boolean().optional(),
  systemPrompt: z.string().max(8_000).nullable().optional(),
  regenerate: z.boolean().optional(),
});

function sseFrame(event: ChatStreamEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

export async function POST(req: Request) {
  const user = await requireUser();

  const rate = checkRate(`chat:${user.id}`, RATE_LIMITS.chat.limit, RATE_LIMITS.chat.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  // ---------- Resolve conversation ----------
  let conversation: Conversation | null = null;
  if (body.conversationId) {
    conversation = await db.conversation.findFirst({
      where: { id: body.conversationId, userId: user.id },
    });
    if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });
  }

  // ---------- Resolve the user turn ----------
  let userText = body.message?.trim() ?? "";
  let attachmentIds = body.attachmentIds ?? [];

  if (body.regenerate) {
    if (!conversation) return Response.json({ error: "Nothing to regenerate." }, { status: 400 });
    const history = await db.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "asc" },
    });
    // Drop trailing assistant messages, find the last user message.
    while (history.length > 0 && history[history.length - 1].role === "assistant") history.pop();
    const lastUser = history[history.length - 1];
    if (!lastUser || lastUser.role !== "user") {
      return Response.json({ error: "Nothing to regenerate." }, { status: 400 });
    }
    userText = lastUser.content;
    let atts: { id: string }[] = [];
    try {
      atts = lastUser.attachments ? JSON.parse(lastUser.attachments) : [];
    } catch {
      atts = [];
    }
    attachmentIds = atts.map((a) => a.id);
    await db.message.deleteMany({
      where: {
        conversationId: conversation.id,
        role: "assistant",
        createdAt: { gte: lastUser.createdAt },
      },
    });
  } else {
    if (!userText && attachmentIds.length === 0) {
      return Response.json({ error: "Message or attachment required." }, { status: 400 });
    }
  }

  if (!conversation) {
    conversation = await db.conversation.create({
      data: {
        userId: user.id,
        title: "New conversation",
        systemPrompt: body.systemPrompt ?? null,
      },
    });
  } else if (body.systemPrompt !== undefined) {
    await db.conversation.update({
      where: { id: conversation.id },
      data: { systemPrompt: body.systemPrompt },
    });
  }

  // ---------- Persist the user message ----------
  const documents = attachmentIds.length
    ? await db.document.findMany({ where: { id: { in: attachmentIds }, userId: user.id } })
    : [];

  const attachmentMeta = documents.map((d) => ({
    id: d.id,
    name: d.name,
    mime: d.mime,
    size: d.size,
    kind: d.kind as "text" | "image" | "binary",
    documentId: d.id,
  }));

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
      webSearchUsed: Boolean(body.webSearch),
    },
  });

  // ---------- Stream ----------
  const startedAt = Date.now();
  const convId = conversation.id;
  const wantWebSearch = Boolean(body.webSearch);
  const wantThinking = Boolean(body.thinking);
  const systemPrompt =
    (body.systemPrompt ?? conversation.systemPrompt ?? DEFAULT_SYSTEM_PROMPT) || DEFAULT_SYSTEM_PROMPT;

  const upstreamAbort = new AbortController();
  req.signal.addEventListener("abort", () => upstreamAbort.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const ping = new TextEncoder().encode(": ping\n\n");
      const send = (event: ChatStreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(sseFrame(event));
        } catch {
          closed = true;
        }
      };
      // SSE heartbeat: keep proxies from killing the connection during long
      // upstream stalls (the "Error in input stream" class of failures).
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(ping);
        } catch {
          closed = true;
        }
      }, 15_000);

      let fullText = "";
      let thinkingText = "";
      let servedModel: string | null = null;
      let usage: { prompt_tokens: number; completion_tokens: number } | null = null;
      let searchResults: WebSearchResult[] = [];

      try {
        send({
          type: "meta",
          conversationId: convId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
        });

        // ----- Web search tool -----
        let webContext = "";
        if (wantWebSearch && userText) {
          send({ type: "tool", tool: "web_search", status: "start", message: "Searching the web…" });
          try {
            searchResults = await webSearch(userText, 6);
            webContext = formatWebContext(searchResults);
            send({
              type: "tool",
              tool: "web_search",
              status: "done",
              message: `Found ${searchResults.length} results`,
              results: searchResults,
            });
            await db.usageEvent.create({
              data: { userId: user.id, kind: "search", latencyMs: 0 },
            });
          } catch (err) {
            send({
              type: "tool",
              tool: "web_search",
              status: "done",
              message: "Web search unavailable — answering without it.",
            });
            console.error("[chat] web_search failed:", err);
          }
        }

        // ----- History + RAG -----
        const historyRows = await db.message.findMany({
          where: { conversationId: convId, id: { notIn: [assistantMessage.id] } },
          orderBy: { createdAt: "asc" },
        });
        const historyForContext = historyWindow(
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

        const textDocs = documents.filter((d) => d.kind === "text" && d.content);
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
            send({
              type: "context",
              message: `Retrieved ${top.length} excerpt${top.length === 1 ? "" : "s"} from ${textDocs.length} document${textDocs.length === 1 ? "" : "s"}`,
            });
          }
        }

        // ----- Vision path (images / binary docs attached) -----
        const visualDocs = documents.filter((d) => d.kind === "image" || d.kind === "binary");
        const hasVision = visualDocs.length > 0;

        let finalText = userText;
        if (ragContext) {
          finalText =
            (userText ? userText + "\n\n" : "") +
            "Answer using the retrieved document context provided above if relevant.";
        }

        const contentItems: Array<
          | { type: "text"; text: string }
          | { type: "image_url"; image_url: { url: string } }
          | { type: "file_url"; file_url: { url: string } }
        > = [];
        if (finalText) contentItems.push({ type: "text", text: finalText });
        if (ragContext) {
          contentItems.push({
            type: "text",
            text: "Retrieved document context:\n\n" + ragContext,
          });
        }
        if (webContext) {
          contentItems.push({ type: "text", text: "Web search results:\n\n" + webContext });
        }
        for (const doc of visualDocs) {
          if (!doc.content) continue;
          const url = `data:${doc.mime};base64,${doc.content}`;
          if (doc.kind === "image") {
            contentItems.push({ type: "image_url", image_url: { url } });
          } else {
            contentItems.push({ type: "file_url", file_url: { url } });
          }
        }

        type UpstreamGen = AsyncGenerator<{
          text: string;
          thinking: string;
          model: string | null;
          usage: { prompt_tokens: number; completion_tokens: number } | null;
          finished: boolean;
        }>;

        let gen: UpstreamGen;

        if (hasVision) {
          const visionMessages: VisionMessage[] = [
            { role: "system", content: systemPrompt },
            ...historyForContext.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            { role: "user", content: contentItems },
          ];
          gen = streamVision(visionMessages, {
            thinking: wantThinking,
            signal: upstreamAbort.signal,
          });
        } else {
          const sdkMessages: SdkChatMessage[] = buildTextMessages({
            systemPrompt,
            history: historyForContext,
            userText: finalText,
            ragContext,
            webContext,
          });
          gen = streamChat(sdkMessages, {
            thinking: wantThinking,
            signal: upstreamAbort.signal,
          });
        }

        // ----- Relay deltas (with one-shot mid-stream recovery) -----
        type RelayOutcome = "done" | "aborted" | "broken";
        let relayErr: unknown = null;
        const relay = async (g: UpstreamGen): Promise<RelayOutcome> => {
          try {
            for await (const chunk of g) {
              if (chunk.model) servedModel = chunk.model;
              if (chunk.usage) usage = chunk.usage;
              if (chunk.thinking) {
                thinkingText += chunk.thinking;
                send({ type: "thinking", text: chunk.thinking });
              }
              if (chunk.text) {
                fullText += chunk.text;
                send({ type: "delta", text: chunk.text });
              }
              if (chunk.finished) return "done";
              if (req.signal.aborted) return "aborted";
            }
            return "done";
          } catch (err) {
            relayErr = err;
            return "broken";
          }
        };

        let outcome = await relay(gen);

        // If the upstream stream died mid-answer but we already have substantial
        // text, resume ONCE from the partial — the client sees a seamless reply.
        if (outcome === "broken" && fullText.length >= 200 && !req.signal.aborted) {
          console.warn("[chat] upstream stream broke mid-answer — resuming from partial text");
          send({
            type: "context",
            message: "Stream interrupted — resuming from where the answer stopped…",
          });
          const recoveryMessages: SdkChatMessage[] = [
            { role: "assistant", content: systemPrompt },
            {
              role: "user",
              content:
                "The text below is your answer so far; it was cut off mid-stream. Continue it EXACTLY from where it stops — same style and register, no repetition, no recap, no preamble. Output ONLY the continuation.\n\n<answer_so_far>\n" +
                fullText.slice(-4000) +
                "\n</answer_so_far>",
            },
          ];
          outcome = await relay(
            streamChat(recoveryMessages, {
              thinking: false,
              signal: upstreamAbort.signal,
            })
          );
        }

        if (outcome === "broken") throw relayErr ?? new Error("upstream stream failed");

        const latencyMs = Date.now() - startedAt;
        const status = req.signal.aborted ? "cancelled" : "complete";

        await db.message.update({
          where: { id: assistantMessage.id },
          data: {
            content: fullText || (status === "cancelled" ? "" : "(empty response)"),
            thinking: thinkingText || null,
            model: servedModel,
            promptTokens: usage?.prompt_tokens ?? null,
            completionTokens: usage?.completion_tokens ?? estimateTokens(fullText),
            latencyMs,
            status,
          },
        });
        await db.usageEvent.create({
          data: {
            userId: user.id,
            kind: hasVision ? "vision" : "chat",
            promptTokens: usage?.prompt_tokens ?? 0,
            completionTokens: usage?.completion_tokens ?? estimateTokens(fullText),
            latencyMs,
          },
        });
        await db.conversation.update({ where: { id: convId }, data: { model: servedModel } });

        // ----- Auto-title on first exchange -----
        const msgCount = await db.message.count({ where: { conversationId: convId } });
        if (msgCount <= 2 && !req.signal.aborted) {
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
                  content: `User: ${userText.slice(0, 500)}\nAssistant: ${fullText.slice(0, 500)}`,
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
            console.error("[chat] title generation failed:", err);
          }
        }

        send({
          type: "done",
          assistantMessageId: assistantMessage.id,
          model: servedModel,
          promptTokens: usage?.prompt_tokens ?? null,
          completionTokens: usage?.completion_tokens ?? null,
          latencyMs,
          status,
        });
      } catch (err) {
        const normalized = normalizeAiError(err);
        console.error("[chat] stream error:", err);
        try {
          await db.message.update({
            where: { id: assistantMessage.id },
            data: {
              content: fullText,
              thinking: thinkingText || null,
              model: servedModel,
              status: "error",
              error: normalized.message,
              latencyMs: Date.now() - startedAt,
            },
          });
        } catch (dbErr) {
          console.error("[chat] failed to persist error state:", dbErr);
        }
        send({ type: "error", message: normalized.message, fatal: fullText.length === 0 });
      } finally {
        closed = true;
        clearInterval(heartbeat);
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
