/**
 * Deterministic novel-intent detection — shared by the agent loop and plain chat.
 *
 * Why this exists: a chat model that only *talks about* writing a novel (asking
 * permission, offering options) fails the platform's core goal test. The engine
 * now detects novel-scale requests itself and the platform ACTS (Book Forge
 * creates the book and starts writing) before the model says a word.
 */

export const NOVEL_INTENT_RE =
  /\b(\d{2,}\s*[- ]?\s*chapters?|chapters?\s*[:\-]?\s*\d{2,}|serialized\s+web\s?novel|web\s?novel|whole\s+novel|entire\s+novel|full[- ]length\s+novel|complete\s+novel|\bnovel\b\s+of\s+\d{2,})\b/i;

export const CONFIRM_RE =
  /^(no\s+)?(yes|ok|okay|sure|go|go ahead|do it|start it|write it|write a new one|a new one|new one|another one|one more|again|please do|continue|keep going|start|begin)[\s!.?]*$/i;

/** Pull the story premise out of a novel-scale request. */
export function extractNovelPremise(msg: string): string {
  let s = msg.trim();
  const colon = s.indexOf(":");
  if (colon > 0 && colon < 200) s = s.slice(colon + 1);
  s = s
    .replace(/\bwrite\s+(all\s+)?\d+\s+chapters?[^.\n]*\.?/gi, " ")
    .replace(/\beach\s+(about\s+)?\d+\s+words?[^.\n]*\.?/gi, " ")
    .replace(/\b\d{2,}\s+chapters?(\s+each(\s+about)?\s+\d+\s+words?)?/gi, " ")
    .replace(
      /\b(start|create|write|begin|launch|give)\b\s+(me\s+)?(an?\s+)?(original\s+)?(serialized\s+)?(web\s?novel|novel)\b/gi,
      " "
    );
  const premise = s.replace(/\s+/g, " ").trim();
  return premise.length >= 20 ? premise : msg.trim();
}

export interface NovelIntent {
  premise: string;
}

/**
 * Detect a novel-scale request in the current message. Short confirmations
 * ("no write a new one", "ok go") reuse the most recent novel-scale request
 * earlier in the conversation — and always forge a NEW book.
 */
export function detectNovelIntent(current: string, earlierUserTexts: string[]): NovelIntent | null {
  const msg = current.trim();
  if (NOVEL_INTENT_RE.test(msg) && msg.length >= 30) {
    return { premise: extractNovelPremise(msg) };
  }
  if (msg.length <= 60 && CONFIRM_RE.test(msg)) {
    for (let i = earlierUserTexts.length - 1; i >= 0; i--) {
      if (NOVEL_INTENT_RE.test(earlierUserTexts[i]) && earlierUserTexts[i].length >= 30) {
        return { premise: extractNovelPremise(earlierUserTexts[i]) };
      }
    }
  }
  return null;
}
