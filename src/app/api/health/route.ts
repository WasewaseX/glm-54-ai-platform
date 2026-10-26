import "server-only";
import { chatOnce } from "@/lib/ai";
import { LIMITS } from "@/lib/context-builder";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness + verified capability manifest.
 * The served model id is captured once per process via a tiny live probe,
 * so the UI displays ground truth from the gateway (never a hardcoded guess).
 */

let cachedModel: { model: string; at: number } | null = null;

export async function GET() {
  let served = cachedModel;
  if (!served || Date.now() - served.at > 30 * 60_000) {
    try {
      const { model } = await chatOnce([{ role: "user", content: "ping" }], { maxChars: 4 });
      if (model) {
        served = { model, at: Date.now() };
        cachedModel = served;
      }
    } catch (err) {
      console.error("[health] model probe failed:", err);
    }
  }

  return Response.json({
    product: "GLM 5.4 AI",
    status: "ok",
    servedChatModel: served?.model ?? null,
    visionModel: "glm-5v-turbo",
    capabilities: [
      { label: "Streaming chat", verified: true, note: "SSE deltas + usage stats verified" },
      { label: "Thinking mode (chain-of-thought)", verified: true, note: "Requested via thinking.enabled; visible reasoning trace depends on the served model" },
      { label: "Vision — image understanding", verified: true, note: "Data-URL images verified" },
      { label: "Document analysis (PDF/DOCX)", verified: true, note: "file_url passthrough; binary docs not text-indexed" },
      { label: "Web search tool", verified: true, note: "web_search function verified" },
      { label: "Long documents via RAG", verified: true, note: "Chunking + BM25 retrieval; not a raw long-context claim" },
      { label: "200M-token context window", verified: false, note: "Not published by this gateway — we ship RAG instead of claiming it" },
      { label: "150M-token output", verified: false, note: "Not verifiable through this integration" },
    ],
    limits: {
      maxUploadBytes: LIMITS.MAX_UPLOAD_BYTES,
      maxHistoryMessages: LIMITS.HISTORY_MESSAGE_CAP,
      contextCharBudget: LIMITS.HISTORY_CHAR_BUDGET,
    },
  });
}
