// Chapter extender — bring every chapter of a book up to the word target.
// For each chapter under TARGET, asks the model to rewrite it expanded,
// keeping every event/beat and landing the same final hook. Checkpointed,
// resumable, and patient with rate limits (infinite retry on 429).
//
// Usage: bun scripts/extend-chapters.ts <bookId> [target=2200]
import ZAI from "z-ai-web-dev-sdk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { countWords, getBookDef, loadState, saveState } from "../src/lib/novel-engine";

const ROOT = "/home/z/my-project";
const bookId = process.argv[2] ?? "the-dreaming-vat";
const TARGET = Number(process.argv[3] ?? 2_200);
const MIN_ACCEPT = TARGET; // never accept a chapter still under the stated target

const def = getBookDef(bookId);
if (!def) {
  console.error(`unknown book: ${bookId}`);
  process.exit(1);
}
const dir = join(ROOT, "books", bookId);
const manuscript = join(dir, "manuscript");
const state = loadState(bookId);
if (!state) {
  console.error("no state.json");
  process.exit(1);
}

const chapterFile = (n: number) => join(manuscript, `ch${String(n).padStart(3, "0")}.md`);

const outlinePath = join(dir, "outline.json");
const outline = existsSync(outlinePath)
  ? (JSON.parse(readFileSync(outlinePath, "utf8")) as Record<string, Array<{ n: number; title: string; brief: string; hook: string }>>)
  : {};

const STYLE_RULES = `STYLE CONTRACT (violations make the chapter unusable):
- Close third person, past tense, anchored to the protagonist defined in the story bible unless a scene explicitly follows another listed character.
- Grounded literary genre fiction as defined by the story bible. Concrete sensory detail drawn from the story's world.
- Dialogue is natural and subtext-heavy. No info-dumps. No head-hopping within a scene.
- At most one scene break (a single line containing only * * *).
- NEVER use markdown lists, bold, italics-markers, or headers other than the one title line.
- Do not summarize future events. Do not break the fourth wall.
- The chapter's final sentence must land the hook beat exactly as the original does.`;

let zai: ZAI | null = null;
async function callLLM(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>, maxTokens: number): Promise<string> {
  if (!zai) zai = await ZAI.create();
  let attempt = 0;
  let hardFails = 0;
  while (true) {
    attempt++;
    try {
      const res = (await zai.chat.completions.create({ messages, stream: false, max_tokens: maxTokens })) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = res?.choices?.[0]?.message?.content ?? "";
      if (!content.trim()) throw new Error("empty completion");
      return content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("429") || msg.toLowerCase().includes("too many requests")) {
        const backoff = Math.min(30_000 * 2 ** (attempt - 1), 480_000);
        const waitMs = backoff + Math.random() * 30_000;
        console.log(`rate-limited (retry #${attempt}) — waiting ${Math.round(waitMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, waitMs));
      } else {
        hardFails++;
        if (hardFails >= 5) throw err;
        console.log(`call failed (${hardFails}/5 hard): ${msg}`);
        await new Promise((r) => setTimeout(r, 5_000 * hardFails));
      }
    }
  }
}

interface Brief {
  n: number;
  title: string;
  brief: string;
  hook: string;
}
function briefFor(n: number): Brief | null {
  const part = outline[String(Math.ceil(n / 10))];
  return part?.find((c) => c.n === n) ?? null;
}

async function extendChapter(n: number, original: string, words: number): Promise<void> {
  const firstLine = original.split("\n")[0].trim();
  const m = firstLine.match(/^Chapter\s+(\d+)\s*[—–-]\s*(.+)$/);
  const title = m?.[2] ?? `Chapter ${n}`;
  const brief = briefFor(n);
  const hook = brief?.hook ?? "(keep the original final beat)";

  const prompt = `Below is a chapter of the novel "${def!.title}" that is too short (${words} words). Rewrite it EXPANDED to 2,300-2,600 words.

STORY BIBLE (ground truth):
${def!.bible}

${STYLE_RULES}

${brief ? `OUTLINE BRIEF for this chapter: ${brief.brief}` : ""}
The chapter must END on this beat (final sentence lands it): ${hook}

RULES:
- Keep every event, character beat, piece of dialogue intent, and the order of scenes from the original.
- Deepen: sensory detail, interiority, dialogue texture, pacing breath — never pad with repetition or summary.
- Preserve the original first line exactly: "${firstLine}"
- Output the COMPLETE rewritten chapter only — first line "${firstLine}" then the prose. No commentary, no markdown.

ORIGINAL CHAPTER:
"""${original}"""`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    const text = await callLLM(
      [
        { role: "system", content: `You are the novelist writing "${def!.title}". You follow story-bible ground truth exactly.` },
        { role: "user", content: prompt },
      ],
      4096
    );
    const clean = text.replace(/^\s*```(?:markdown)?/i, "").replace(/```\s*$/i, "").trim();
    const newWords = countWords(clean);
    if (newWords >= MIN_ACCEPT && clean.startsWith(firstLine.split(/[—–-]/)[0].trim())) {
      writeFileSync(chapterFile(n), clean + "\n");
      const cs = state.chapters[n];
      if (cs) cs.words = newWords;
      state.totalWords = Object.values(state.chapters)
        .filter((c) => c.status === "done")
        .reduce((a, c) => a + c.words, 0);
      saveState(state);
      console.log(`ch${n}: ${words} -> ${newWords} words (attempt ${attempt})`);
      return;
    }
    console.log(`ch${n} attempt ${attempt}: got ${newWords} words or wrong format — retrying`);
  }
  console.log(`ch${n}: SKIPPED after 3 attempts (still ${words} words)`);
}

const short: Array<{ n: number; words: number }> = [];
for (let n = 1; n <= 100; n++) {
  const cs = state.chapters[n];
  if (cs?.status !== "done") continue;
  const raw = readFileSync(chapterFile(n), "utf8");
  const body = raw.split("\n").slice(1).join("\n");
  const words = countWords(body);
  if (words < TARGET) short.push({ n, words });
}

console.log(`extend-chapters ${bookId}: target=${TARGET}, ${short.length} chapter(s) under target`);
for (const { n, words } of short) {
  const original = readFileSync(chapterFile(n), "utf8");
  try {
    await extendChapter(n, original, words);
  } catch (err) {
    console.log(`ch${n} FAILED: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// Final tally + reassembly of deliverables.
let all = 0;
let done = 0;
let stillShort: number[] = [];
for (let n = 1; n <= 100; n++) {
  const cs = state.chapters[n];
  if (cs?.status !== "done") continue;
  done++;
  all += cs.words;
  if (cs.words < TARGET) stillShort.push(n);
}
state.chaptersDone = done;
state.totalWords = all;
saveState(state);
console.log(`DONE: ${done}/100 chapters, ${all} words, still under ${TARGET}: [${stillShort.join(", ") || "none"}]`);
