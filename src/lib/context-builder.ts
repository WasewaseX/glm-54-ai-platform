import "server-only";
import type { SdkChatMessage } from "@/lib/ai";
import type { ChatMessage } from "@/lib/types";

/**
 * Context assembly. Budgets are conservative and verifiable:
 * - HISTORY_MESSAGE_CAP: number of recent messages replayed to the model
 * - HISTORY_CHAR_BUDGET: hard character budget for replayed history (~30k chars ≈ 7.5k tokens)
 * - RAG_CHAR_BUDGET: max chars of retrieved document context injected per turn
 *
 * The gateway does not publish a verified 200M-token context window, so we do
 * not claim one. These budgets guarantee reliability today; see README.
 */

export const LIMITS = {
  MAX_UPLOAD_BYTES: 8 * 1024 * 1024, // 8 MB
  HISTORY_MESSAGE_CAP: 80,
  HISTORY_CHAR_BUDGET: 60_000,
  RAG_CHAR_BUDGET: 20_000,
  MAX_ATTACHMENTS_PER_MESSAGE: 6,
  TITLE_MAX_CHARS: 80,
} as const;

export const DEFAULT_SYSTEM_PROMPT =
  "You are GLM 5.4 AI, a precise, helpful assistant. Use Markdown for structure. " +
  "Fence code blocks with the language tag. Be concise but complete, and say so " +
  "plainly when you are unsure. " +
  "For requests to write entire books or serialized novels (dozens of chapters), do NOT attempt " +
  "to write the whole work in one reply — instead explain that Book Forge, the platform's built-in " +
  "long-form pipeline on the welcome screen, handles multi-chapter projects with story bibles, " +
  "outlines, rolling continuity, and checkpointed resume, and offer to start it or to write a " +
  "sample chapter here in chat.";

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

/** Replay recent history within budget (most recent first priority). */
export function historyWindow(messages: ChatMessage[]): ChatMessage[] {
  const recent = messages
    .filter((m) => m.status !== "error" && m.content.trim().length > 0)
    .slice(-LIMITS.HISTORY_MESSAGE_CAP);

  const picked: ChatMessage[] = [];
  let budget = LIMITS.HISTORY_CHAR_BUDGET;
  for (let i = recent.length - 1; i >= 0; i--) {
    const m = recent[i];
    const cost = m.content.length + 16;
    if (cost > budget) break;
    budget -= cost;
    picked.unshift(m);
  }
  return picked;
}

export interface BuildOptions {
  systemPrompt: string;
  history: ChatMessage[];
  userText: string;
  ragContext?: string; // retrieved excerpts (already formatted)
  webContext?: string; // formatted web search results
}

/**
 * Build the SDK message array for a text-only turn.
 * Per official SDK guidance, the system prompt is passed with the
 * 'assistant' role as the first message.
 */
export function buildTextMessages(opts: BuildOptions): SdkChatMessage[] {
  const messages: SdkChatMessage[] = [{ role: "assistant", content: opts.systemPrompt }];

  for (const m of opts.history) {
    messages.push({ role: m.role, content: clip(m.content, 8_000) });
  }

  const contextBlocks: string[] = [];
  if (opts.ragContext) {
    contextBlocks.push(
      "Retrieved document context (verbatim excerpts, may be incomplete):\n\n" + opts.ragContext
    );
  }
  if (opts.webContext) {
    contextBlocks.push(
      "Web search results (fetched just now; cite as [n] when used):\n\n" + opts.webContext
    );
  }
  if (contextBlocks.length > 0) {
    messages.push({
      role: "assistant",
      content:
        "Context for the next user message:\n\n" +
        contextBlocks.join("\n\n") +
        "\n\nUse this context when relevant; do not fabricate beyond it.",
    });
  }

  messages.push({ role: "user", content: clip(opts.userText, 16_000) });
  return messages;
}

export function formatWebContext(
  results: Array<{ name: string; snippet: string; url: string; host_name: string; date: string }>
): string {
  if (results.length === 0) return "";
  return results
    .map((r, i) => {
      const date = r.date ? ` (${r.date})` : "";
      return `[${i + 1}] ${r.name}${date} — ${r.host_name}\n${r.snippet}\n${r.url}`;
    })
    .join("\n\n");
}
