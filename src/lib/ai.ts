import "server-only";
import ZAI from "z-ai-web-dev-sdk";
import type {
  CreateChatCompletionBody,
  CreateChatCompletionVisionBody,
  VisionMessage,
} from "z-ai-web-dev-sdk/dist/index";

/**
 * Thin, verified wrapper around z-ai-web-dev-sdk.
 *
 * Verified against the live gateway (see README "Verified capabilities"):
 * - chat.completions.create({ stream: true })  -> ReadableStream of SSE frames,
 *   terminated by `data: [DONE]`, final frame carries usage.
 * - chat.completions.createVision(...)         -> vision model (served: glm-5v-turbo)
 *   accepting data-URL image_url / file_url content items.
 * - functions.invoke("web_search", { query, num }) -> ranked results.
 *
 * The gateway normalizes requested model ids and echoes the actually-served
 * model in each response; we always surface that served id as ground truth.
 */

export type SdkChatMessage = CreateChatCompletionBody["messages"][number];

let zaiPromise: Promise<ZAI> | null = null;

export function getZAI(): Promise<ZAI> {
  if (!zaiPromise) {
    zaiPromise = ZAI.create().catch((err) => {
      zaiPromise = null; // allow retry on next request
      throw err;
    });
  }
  return zaiPromise;
}

// ---------------------------------------------------------------------------
// Transient-failure retry — the shared gateway 429s/502s under load, so every
// LLM touchpoint retries patiently instead of failing the user's turn.
// ---------------------------------------------------------------------------

const TRANSIENT_ERROR_RE =
  /status 429|status 5\d\d|ENOTFOUND|ECONNREFUSED|ECONNRESET|fetch failed|timeout|empty completion/i;

export function isTransientAiError(err: unknown): boolean {
  return TRANSIENT_ERROR_RE.test(err instanceof Error ? err.message : String(err));
}

function retryDelayMs(attempt: number, baseMs: number, capMs: number): number {
  return Math.min(capMs, baseMs * 2 ** attempt) + Math.random() * 800;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseMs?: number; capMs?: number; label?: string } = {}
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 1_200;
  const capMs = opts.capMs ?? 12_000;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === retries || !isTransientAiError(err)) throw err;
      const wait = retryDelayMs(attempt, baseMs, capMs);
      console.warn(
        `[ai] ${opts.label ?? "call"} failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${Math.round(
          wait
        )}ms: ${err instanceof Error ? err.message : String(err)}`
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

export interface UpstreamChunk {
  text: string;
  thinking: string;
  model: string | null;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
  finished: boolean;
}

/** Parse an SSE byte stream from the gateway into normalized chunks. */
async function* parseSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal
): AsyncGenerator<UpstreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // keep incomplete tail

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") {
          yield { text: "", thinking: "", model: null, usage: null, finished: true };
          return;
        }
        let json: Record<string, unknown>;
        try {
          json = JSON.parse(payload);
        } catch {
          continue; // skip malformed frame
        }
        const model = typeof json.model === "string" ? json.model : null;
        const usage = (json.usage as UpstreamChunk["usage"] | undefined) ?? null;
        const choices = json.choices as Array<Record<string, unknown>> | undefined;
        const delta = choices?.[0]?.delta as
          | { content?: string; reasoning_content?: string }
          | undefined;
        const finishReason = choices?.[0]?.finish_reason;
        yield {
          text: delta?.content ?? "",
          thinking: delta?.reasoning_content ?? "",
          model,
          usage,
          finished: finishReason === "stop" || finishReason === "length",
        };
      }
    }
  } finally {
    try {
      reader.cancel();
    } catch {
      /* noop */
    }
  }
}

export interface StreamOptions {
  thinking?: boolean;
  signal?: AbortSignal;
}

/** Stream a (text) chat completion. Yields normalized deltas; resolves model/usage at end. */
export async function* streamChat(
  messages: SdkChatMessage[],
  opts: StreamOptions = {}
): AsyncGenerator<UpstreamChunk> {
  const zai = await getZAI();
  const body: CreateChatCompletionBody = {
    messages,
    stream: true,
    thinking: { type: opts.thinking ? "enabled" : "disabled" },
  };
  const stream = (await withRetry(() => zai.chat.completions.create(body), {
    retries: 3,
    label: "streamChat",
  })) as ReadableStream<Uint8Array> | Response;

  if (stream instanceof Response || !(stream instanceof ReadableStream)) {
    // Gateway answered non-streaming despite stream:true — degrade gracefully.
    const json = (stream as unknown as { json: () => Promise<Record<string, unknown>> }).json
      ? await (stream as Response).json()
      : (stream as unknown as Record<string, unknown>);
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const msg = choices?.[0]?.message as { content?: string } | undefined;
    yield {
      text: msg?.content ?? "",
      thinking: "",
      model: (json.model as string) ?? null,
      usage: (json.usage as UpstreamChunk["usage"]) ?? null,
      finished: true,
    };
    yield { text: "", thinking: "", model: null, usage: null, finished: true };
    return;
  }
  yield* parseSseStream(stream, opts.signal);
}

export interface VisionStreamOptions extends StreamOptions {
  model?: string;
}

/** Stream a vision/multimodal completion (images, PDFs via data URLs). */
export async function* streamVision(
  messages: VisionMessage[],
  opts: VisionStreamOptions = {}
): AsyncGenerator<UpstreamChunk> {
  const zai = await getZAI();
  const body: CreateChatCompletionVisionBody = {
    model: opts.model ?? "glm-4-plus",
    messages,
    stream: true,
    thinking: { type: opts.thinking ? "enabled" : "disabled" },
  };
  const stream = (await withRetry(() => zai.chat.completions.createVision(body), {
    retries: 3,
    label: "streamVision",
  })) as ReadableStream<Uint8Array> | Response;

  if (stream instanceof Response || !(stream instanceof ReadableStream)) {
    const json = await (stream as Response).json();
    const choices = json.choices as Array<Record<string, unknown>> | undefined;
    const msg = choices?.[0]?.message as { content?: string } | undefined;
    yield {
      text: msg?.content ?? "",
      thinking: "",
      model: (json.model as string) ?? null,
      usage: (json.usage as UpstreamChunk["usage"]) ?? null,
      finished: true,
    };
    return;
  }
  yield* parseSseStream(stream, opts.signal);
}

/** Non-streaming one-shot completion (titles, summaries). */
export async function chatOnce(
  messages: SdkChatMessage[],
  opts: { thinking?: boolean; maxChars?: number } = {}
): Promise<{ text: string; model: string | null; usage: { prompt_tokens: number; completion_tokens: number } | null }> {
  const zai = await getZAI();
  const completion = (await withRetry(
    () =>
      zai.chat.completions.create({
        messages,
        thinking: { type: opts.thinking ? "enabled" : "disabled" },
      }),
    { retries: 3, label: "chatOnce" }
  )) as {
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number };
    choices?: Array<{ message?: { content?: string } }>;
  };
  let text = completion.choices?.[0]?.message?.content ?? "";
  if (opts.maxChars && text.length > opts.maxChars) text = text.slice(0, opts.maxChars);
  return { text, model: completion.model ?? null, usage: completion.usage ?? null };
}

/** Web search via the gateway's built-in tool. */
export async function webSearch(
  query: string,
  num = 6
): Promise<
  Array<{ url: string; name: string; snippet: string; host_name: string; rank: number; date: string; favicon: string }>
> {
  const zai = await getZAI();
  const res = (await withRetry(() => zai.functions.invoke("web_search", { query, num }), {
    retries: 2,
    label: "webSearch",
  })) as Array<Record<string, unknown>>;
  if (!Array.isArray(res)) return [];
  return res.slice(0, num).map((r, i) => ({
    url: r.url ?? "",
    name: r.name ?? "",
    snippet: r.snippet ?? "",
    host_name: r.host_name ?? "",
    rank: r.rank ?? i,
    date: r.date ?? "",
    favicon: r.favicon ?? "",
  }));
}

/** Read a web page and extract readable text via the gateway's page_reader tool. */
export async function pageReader(url: string): Promise<{ title: string; text: string; tokens: number }> {
  const zai = await getZAI();
  const res = (await withRetry(() => zai.functions.invoke("page_reader", { url }), {
    retries: 2,
    label: "pageReader",
  })) as {
    code?: number;
    data?: { html?: string; title?: string; url?: string; usage?: { tokens?: number } };
  };
  const html = res?.data?.html ?? "";
  return {
    title: res?.data?.title ?? url,
    text: htmlToText(html),
    tokens: res?.data?.usage?.tokens ?? 0,
  };
}

/** Very small HTML → text converter (no deps): drops scripts/styles/tags, decodes common entities. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const IMAGE_SIZES = ["1024x1024", "768x1344", "864x1152", "1344x768", "1152x864", "1440x720", "720x1440"] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export function isImageSize(size: unknown): size is ImageSize {
  return typeof size === "string" && (IMAGE_SIZES as readonly string[]).includes(size);
}

/** Generate an image; resolves to base64 PNG data (no data: prefix). */
export async function generateImage(prompt: string, size: ImageSize = "1024x1024"): Promise<string> {
  const zai = await getZAI();
  const res = (await withRetry(() => zai.images.generations.create({ prompt, size }), {
    retries: 2,
    baseMs: 2_000,
    label: "generateImage",
  })) as { data?: Array<{ base64?: string }> };
  const b64 = res?.data?.[0]?.base64;
  if (!b64) throw new Error("Image generation returned no data.");
  return b64;
}

/** Normalize SDK errors into user-safe messages (never leak config/keys). */
export function normalizeAiError(err: unknown): { message: string; status: number } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/status 401|403/.test(raw)) {
    return { message: "The AI gateway rejected credentials. Check server .z-ai-config.", status: 502 };
  }
  if (/status 429/.test(raw)) {
    return { message: "The AI gateway is rate-limiting requests. Please retry shortly.", status: 429 };
  }
  if (/status 5\d\d/.test(raw)) {
    return { message: "The AI gateway had an upstream error. Please retry.", status: 502 };
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|timeout/i.test(raw)) {
    return { message: "Could not reach the AI gateway. Check network connectivity.", status: 504 };
  }
  return { message: "Unexpected AI gateway error. Please retry.", status: 502 };
}
