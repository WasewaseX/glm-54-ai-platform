import "server-only";

/**
 * Long-context support: chunking + keyword retrieval (BM25-style).
 *
 * The gateway does not publish a verified 200M-token context window, so instead
 * of claiming one we implement scalable long-document handling: documents are
 * chunked on ingest, and only the most relevant chunks are retrieved per query
 * and injected into the prompt. This is honest RAG — clearly labeled in the UI.
 */

export function estimateTokens(text: string): number {
  // ~4 chars per token is a good cross-lingual approximation for budgeting.
  return Math.max(1, Math.ceil(text.length / 4));
}

export interface TextChunk {
  idx: number;
  text: string;
  tokens: number;
}

/**
 * Chunk text on paragraph boundaries with overlap.
 * maxChars ~1200 keeps chunks semantically coherent and retrieval-granular.
 */
export function chunkText(text: string, maxChars = 1200, overlapChars = 150): TextChunk[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    const t = current.trim();
    if (t) chunks.push(t);
    current = "";
  };

  for (const para of paragraphs) {
    const p = para.trim();
    if (!p) continue;

    // Hard-split oversized paragraphs on sentence boundaries.
    if (p.length > maxChars) {
      pushCurrent();
      const sentences = p.split(/(?<=[.!?。！？])\s+/);
      let piece = "";
      for (const s of sentences) {
        if ((piece + " " + s).length > maxChars) {
          if (piece.trim()) chunks.push(piece.trim());
          piece = s;
        } else {
          piece = piece ? piece + " " + s : s;
        }
      }
      if (piece.trim()) chunks.push(piece.trim());
      continue;
    }

    if ((current + "\n\n" + p).length > maxChars) {
      pushCurrent();
    }
    current = current ? current + "\n\n" + p : p;
  }
  pushCurrent();

  // Add overlap: prepend the tail of the previous chunk.
  return chunks.map((text, idx) => {
    let withOverlap = text;
    if (idx > 0 && overlapChars > 0) {
      const prevTail = chunks[idx - 1].slice(-overlapChars);
      withOverlap = `${prevTail}\n${text}`;
    }
    return { idx, text: withOverlap, tokens: estimateTokens(withOverlap) };
  });
}

// ---------- BM25-lite retrieval ----------

const STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","but","by","for","if","in","into","is","it",
  "of","on","or","such","that","the","their","then","there","these","they","this",
  "to","was","will","with","what","about","when","how","why","which","who","whom",
  "from","has","have","had","do","does","did","can","could","should","would","you",
  "your","we","our","i","me","my","please","tell","give","me","show","explain",
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

export interface ScoredChunk {
  chunk: TextChunk;
  score: number;
}

/**
 * Retrieve top-k chunks for a query using BM25 scoring.
 * Pure JS — no external index needed at this scale (chunks per user are bounded).
 */
export function retrieveChunks(
  query: string,
  chunks: TextChunk[],
  k = 6
): ScoredChunk[] {
  if (chunks.length === 0) return [];
  const queryTerms = [...new Set(tokenize(query))].slice(0, 32);
  if (queryTerms.length === 0) return chunks.slice(0, k).map((chunk) => ({ chunk, score: 0 }));

  const docTokens = chunks.map((c) => tokenize(c.text));
  const docLength = docTokens.map((t) => t.length || 1);
  const avgLen = docTokens.reduce((a, t) => a + t.length, 0) / docTokens.length || 1;

  // Document frequency per term
  const df = new Map<string, number>();
  for (const tokens of docTokens) {
    const seen = new Set(tokens);
    for (const term of queryTerms) {
      if (seen.has(term)) df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const N = chunks.length;
  const k1 = 1.5;
  const b = 0.75;

  const scored: ScoredChunk[] = chunks.map((chunk, i) => {
    const tf = new Map<string, number>();
    for (const t of docTokens[i]) tf.set(t, (tf.get(t) ?? 0) + 1);

    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term);
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (docLength[i] / avgLen))));
    }
    return { chunk, score };
  });

  return scored
    .sort((a, b2) => b2.score - a.score)
    .filter((s) => s.score > 0)
    .slice(0, k);
}

export function formatRagContext(
  results: ScoredChunk[],
  docNameById: Map<string, string>
): string {
  if (results.length === 0) return "";
  const parts = results.map(({ chunk }, i) => {
    // chunk.idx is per-document; callers pass docNameById for provenance only.
    const name = docNameById.get(String(chunk.idx)) ?? `excerpt ${i + 1}`;
    return `[${name}]\n${chunk.text}`;
  });
  return parts.join("\n\n---\n\n");
}
