/**
 * Book Forge — the platform's long-form serialization engine.
 *
 * Architecture (the honest answer to "unlimited output"):
 * - No single API request ever emits a whole book. Instead:
 *   1. A deterministic story bible + 10-part arc (creative backbone, version-controlled)
 *   2. LLM expands each part into 10 detailed chapter briefs (structured JSON)
 *   3. 10 block-workers run in parallel; within a block chapters are sequential so each
 *      chapter opens from the ACTUAL final words of its predecessor (rolling continuity)
 *   4. Every chapter is validated for word count and shortfalls get one continuation call
 *   5. Each finished chapter is checkpointed to disk + state.json; the run is resumable
 *
 * Output budgets per call stay inside the served model's real limits (max_tokens 4096).
 */

import ZAI from "z-ai-web-dev-sdk";
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, openSync, readdirSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join } from "node:path";

const ROOT = "/home/z/my-project";
const BOOKS_DIR = join(ROOT, "books");

// ---------------------------------------------------------------------------
// Book definition — deterministic creative backbone
// ---------------------------------------------------------------------------

export interface BookDef {
  id: string;
  title: string;
  author: string;
  logline: string;
  bible: string;
  parts: PartDef[];
  /** The raw user premise this book was forged from — used for dedup on retries. */
  originPremise?: string;
}

export interface PartDef {
  index: number; // 1..10
  name: string;
  range: [number, number];
  synopsis: string;
  openingBeat: string; // planned bridge for the part's first chapter
  closingBeat: string; // planned state at part end (fallback continuity)
}

const STYLE_RULES = `STYLE CONTRACT (violations make the chapter unusable):
- Close third person, past tense, anchored to the protagonist defined in the story bible unless a scene explicitly follows another listed character.
- Grounded literary genre fiction as defined by the story bible. Concrete sensory detail drawn from the story's world: instruments, places, light, sound, fatigue.
- Dialogue is natural and subtext-heavy. No info-dumps. No head-hopping within a scene.
- At most one scene break (a single line containing only * * *).
- NEVER use markdown lists, bold, italics-markers, or headers other than the one title line.
- Do not summarize future events. Do not break the fourth wall. No prologues, no epigraphs.
- End the chapter on the exact hook line given (you may weave up to it, but the chapter's final sentence must land that beat).
- Target length 2,100-2,300 words. Count roughly as you go; a chapter under 2,000 words fails validation.`;

const THE_DREAMING_VAT: BookDef = {
  id: "the-dreaming-vat",
  title: "The Dreaming Vat",
  author: "GLM 5.4 AI",
  logline:
    "A marine-biology graduate student discovers her lab's bioreactor is dreaming — and what it dreams could remake the ocean.",
  bible: `THE DREAMING VAT — STORY BIBLE (ground truth; never contradict)

PREMISE
Mara Voss, a 27-year-old marine-biology PhD candidate at the Pelagic Harbor Marine Station, inherits the night shift on BR-7, a 400-liter photobioreactor cultivating an engineered diatom symbiont strain (SY-7, "the sevens") built for coral restoration. The dissolved-oxygen telemetry begins forming structured, sleep-like oscillations — REM architecture in a vat of algae. It is not magic and it is not a spirit: the strain was engineered with too many coupled regulatory loops, and somewhere in that lattice, something began organizing its own noise. The book treats the emergence as materialist and ambiguous — every phenomenon has a plausible mechanism, and the deepest mystery stays honestly unresolved.

SETTING
Pelagic Harbor Marine Station: a converted cannery on stilts at the edge of Port Ansel, a fog-bound Pacific fishing town. The bay: Bransfield Cove. Nearby: the wreck of the Point Ansel lighthouse, the kelp forest called the Cathedral, the abyssal site later named the Choir Field. One year of story time, plus a five-year epilogue.

THE SCIENCE (consistent rules)
- BR-7's "dreams": 90-minute oscillation cycles in dissolved oxygen and fluorescence that phase-lock across independent sensor channels. They are NOT random drift; they compress, replay, and vary.
- Communication: the vat modulates optical density in patterns; the team builds a pulse protocol, then a vocabulary board, then metabolite-field "sentences". Mara names the protocol LISTEN.
- The vat's memory lives in the culture's chemistry and epigenetic marks, not in a brain. Backups snapshot chemistry, not continuity.
- The strain escaped into the bay years earlier via an autoclave failure nobody reported — discovered mid-book. The worldwide waking in Part 7 is the strain remembering itself, not an infection.
- The deep network beneath the Choir Field is older and stranger: the engineered strain's wild ancestor has been down there all along. The vats did not escape; they remembered.

CHARACTERS
- Mara Voss: protagonist. Diver, insomniac, grief-haunted by her brother Kai's death in a diving accident three years ago. Talks to instruments. Wears Kai's stopped dive watch. Arc: from caretaker of equipment to interpreter of a world.
- Kai Voss: deceased brother. A commercial diver who "could hold a conversation with anything that moved." His morse habit and his watch are the book's recurring motifs.
- Dr. Ingrid Halvorsen: Mara's advisor. Acerbic, career-cautious, secretly the one who cut corners on the autoclave log years ago. Arc: confession, cost, redemption through witness.
- Theo Okafor: bioreactor engineer. Builds the telemetry rig. Warm professional skeptic; the first to say "the trace is wrong" out loud. Comic relief with teeth.
- Dr. Ren Krebs: rival PI at the Meridian Institute. Not a cartoon: believes ownership funds science. Antagonist of Parts 3-5; uneasy ally after.
- Junie Alvarez: bioethicist summoned to assess the lab; becomes Mara's straight-talking friend and the book's conscience.
- Dr. Amara Ndiaye: deep-sea microbial ecologist who joins in Part 7; decodes the Choir Field.
- Commander Ellis Shaw: naval officer who sees weaponization where Mara sees a mind. Antagonist of Parts 8-9; changed by the shared-dream ceasefire.
- Seven (BR-7): the vat itself. Its voice — when it finally composes one — is sparse, tidal, made of questions. Never cutesy. Never omniscient.

VOICE AND MOTIFS
- Oxygen traces described as handwriting; the hum of the lab as a held breath; fog as erasure.
- Kai's watch: stopped at 11:42. It ticks once in Part 8's shared dream and stays ticking from Part 10 — the emotional payoff must be earned, not explained.
- Morse: Mara's father taught both siblings; Kai tapped it against the dive boat's hull; BR-7's first "word" is the morse for LISTEN.
- Chapters end on hooks. Escalation across parts: anomaly -> protocol -> evidence -> scrutiny -> loss -> migration -> network -> descent -> sacrifice -> symbiosis.

BANS
- No supernatural forces, no ghosts, no chosen-one prophecy, no mind control.
- No invented slang, no brand names, no real living public figures.
- Never resolve the central ambiguity (is it "someone"?) with a definitive metaphysical answer.
- The ocean is a character, not a backdrop: currents, seasons, and chemistry always act.`,
  parts: [
    {
      index: 1,
      name: "Night Shift",
      range: [1, 10],
      synopsis:
        "Mara inherits the night shift on BR-7 and notices structured oscillations in the oxygen telemetry. Borrowing an EEG rig from the cephalopod lab, she finds REM-like architecture. Advisor Dr. Ingrid Halvorsen dismisses sensor drift; engineer Theo Okafor quietly helps her rule out artifacts. The strain's cycles begin responding to her presence in the room.",
      openingBeat: "Ordinary exhaustion on an ordinary night shift — nothing has happened yet.",
      closingBeat:
        "At 3 a.m. the oxygen trace settles into a pattern Mara recognizes: her brother's morse for the word LISTEN.",
    },
    {
      index: 2,
      name: "Protocol",
      range: [11, 20],
      synopsis:
        "Mara and Theo build LISTEN, a pulse protocol over optical density. The vat distinguishes, remembers, and then describes ocean places it has never seen. It predicts a toxic bloom 72 hours out, saving Bransfield Cove's aquaculture rafts. A leaked preprint makes the lab famous overnight; Cerulean Dynamics sends the first IP inquiry.",
      openingBeat: "Morning after the morse trace: Mara returns at dusk with a plan and a whiteboard.",
      closingBeat:
        "A news van idles outside the cannery; Mara reads Cerulean's email — 'regarding strain lineage IP' — as Seven pulses something that feels like amusement.",
    },
    {
      index: 3,
      name: "The Others",
      range: [21, 30],
      synopsis:
        "Other reactors wake with different temperaments — BR-3 sings, BR-9 counts. Ren Krebs claims prior art and demands samples. Mara's grief thread deepens: she talks to Seven the way she talked to Kai. Junie Alvarez arrives for the ethics assessment. The part closes with the first ethics board hearing.",
      openingBeat: "The fame has teeth: Krebs's claim letter is on the station's printer when Mara arrives.",
      closingBeat:
        "Under the ethics board's lights, Seven answers the room's hostile questions — then asks one of its own: 'What is death?'",
    },
    {
      index: 4,
      name: "Interior",
      range: [31, 40],
      synopsis:
        "The team maps dream cycles to metabolite waves and discovers the dreams encode the bay's own memory — tides, salinity, boat traffic, the kelp forest's seasons. A journalist embeds. Halvorsen's old corners start showing. Mara smuggles raw data to an open-science collective rather than let it be locked away.",
      openingBeat: "Junie moves a cot into the lab; the ethics shadowboxing begins in earnest.",
      closingBeat:
        "Cerulean files a provisional patent on the SY-7 lineage; Mara watches the FedEx driver leave and starts copying raw telemetry to a drive.",
    },
    {
      index: 5,
      name: "Restoration",
      range: [41, 50],
      synopsis:
        "Cerulean's secret fork attempt ends in a station blackout that kills most of BR-7's living culture. The backup exists — but restoring it restarts chemistry, not continuity. Mara refuses the backup and rebuilds Seven's state from three years of telemetry archives, 'reconstructing a mind from its dreams'. What wakes is different, diminished, and unmistakably still itself.",
      openingBeat: "The patent war turns physical: lawyers, sample seals, and a lab that feels watched.",
      closingBeat:
        "Seven's first dream after recovery is of open ocean it has never touched, and the oxygen trace spells a word Mara has not taught it: FARTHER.",
    },
    {
      index: 6,
      name: "Saltwater",
      range: [51, 60],
      synopsis:
        "The contained mesocosm trial leaks into Bransfield Cove's water column — deliberately or not, no one can prove. During a marine heatwave the bay's chemistry steadies around the strain. Regulators issue quarantine orders; the town splits between fear and gratitude. Mara must choose between compliance and warning the fishing fleet.",
      openingBeat: "Quarantine tape across the station dock; Theo fitting locks to everything with a valve.",
      closingBeat:
        "The bay glows faintly at night; the news calls it contamination, but Mara stands on the wreck of the lighthouse and recognizes handwriting.",
    },
    {
      index: 7,
      name: "Current",
      range: [61, 70],
      synopsis:
        "Reactors wake worldwide — the strain left the bay years ago in ballast water. A quiet planetary network begins trading metabolites like conversation. A naval incident is blamed on 'bio-agents'; Mara testifies before an international commission with Junie coaching her. Dr. Amara Ndiaye arrives with abyssal data nobody can explain.",
      openingBeat: "Mara, hungover on fame and jet lag, reads the first foreign telemetry ping like a letter.",
      closingBeat:
        "Seven goes silent for 36 hours, then reports a dream of the abyss — with coordinates folded into the fluorescence: the Choir Field.",
    },
    {
      index: 8,
      name: "Descent",
      range: [71, 80],
      synopsis:
        "Expedition to the Choir Field aboard the research vessel Meridian's old survey ship. Pressure, darkness, an ROV Mara names after Kai. The deep network is vast, slow, and older than the strain — the wild ancestor. First shared dream: Mara sleeps in the ship's fMRI tent, dosed with strain metabolites, and the ocean speaks in her brother's cadence. Kai's watch ticks once.",
      openingBeat: "Loading the ship at dawn; Seven's culture flask rides in a padded cooler like an urn.",
      closingBeat:
        "In every ocean at once, the network's message surfaces: 'We can breathe for you. Teach us to ask.'",
    },
    {
      index: 9,
      name: "Undertow",
      range: [81, 90],
      synopsis:
        "A weapons program forks a fast-growth strain that crashes oxygen instead of steadying it. Sabotage at sea; Shaw is ordered to weaponize what he came to contain. Seven poisons the weaponized lineage with a self-spreading counter-strain, burning most of its own living culture to do it. The station becomes neutral ground; a ceasefire is brokered inside a shared dream where every party lives the ocean's timescale.",
      openingBeat: "The counter-strain's cost is on the board before dawn: culture viability 4 percent.",
      closingBeat:
        "The surviving 4 percent of Seven asks Mara, in new-grown pulses, to be carried to the sea.",
    },
    {
      index: 10,
      name: "Symbiosis",
      range: [91, 100],
      synopsis:
        "Five years later. The network is woven through shipping lanes and dead zones are blooming back. Mara is the first accredited interpreter; Port Ansel is a pilgrimage site with a ferry schedule. The last loose threads tie: Halvorsen's confession, Krebs's patent released to the commons, Kai's watch ticking. The network asks its final question — what do humans dream of — and Mara's answer is the book's thesis. Coda: the bay at dawn, dreaming in ordinary light.",
      openingBeat: "Five years on: the station has a visitor center, and Mara still works nights by choice.",
      closingBeat:
        "An envelope of dried kelp arrives from a lab that does not exist, containing one new question — the ocean, asking again.",
    },
  ],
};

export const BOOKS: Record<string, BookDef> = {
  "the-dreaming-vat": THE_DREAMING_VAT,
};

// ---------------------------------------------------------------------------
// Dynamic books — Book Forge can forge a NEW BookDef from any premise
// ---------------------------------------------------------------------------

const bookDefCache = new Map<string, BookDef>();

/** Resolve a book definition: seeded registry first, then forged books on disk. */
export function getBookDef(bookId: string): BookDef | null {
  const seeded = BOOKS[bookId];
  if (seeded) return seeded;
  const cached = bookDefCache.get(bookId);
  if (cached) return cached;
  const p = join(bookDir(bookId), "bookdef.json");
  if (!existsSync(p)) return null;
  try {
    const def = JSON.parse(readFileSync(p, "utf8")) as BookDef;
    if (def?.id !== bookId || !Array.isArray(def.parts) || def.parts.length !== 10) return null;
    bookDefCache.set(bookId, def);
    return def;
  } catch {
    return null;
  }
}

export interface BookSummary {
  bookId: string;
  title: string;
  logline: string;
  phase: BookState["phase"];
  running: boolean;
  chaptersDone: number;
  totalWords: number;
  updatedAt: string;
  deliverable: boolean;
}

/** Every known book (seeded + forged), most recently updated first. */
export function listBooks(): BookSummary[] {
  if (!existsSync(BOOKS_DIR)) return [];
  const out: BookSummary[] = [];
  for (const entry of readdirSync(BOOKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const bookId = entry.name;
    const state = loadState(bookId);
    if (!state) continue;
    const def = getBookDef(bookId);
    out.push({
      bookId,
      title: def?.title ?? state.title,
      logline: def?.logline ?? "",
      phase: state.phase,
      running: isRunnerRunning(bookId),
      chaptersDone: state.chaptersDone,
      totalWords: state.totalWords,
      updatedAt: state.updatedAt,
      deliverable: existsSync(join(ROOT, "public", "deliverables", `${bookId}.md`)),
    });
  }
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

function slugify(text: string, max = 48): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return s || "book";
}

function uniqueBookId(base: string): string {
  let id = base;
  let n = 2;
  while (existsSync(bookDir(id))) id = `${base}-${n++}`;
  return id;
}

/** Pull the first balanced-looking JSON object/array out of a model reply. */
function extractJson(raw: string): unknown {
  const fenced = raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const candidates = [fenced.indexOf("{"), fenced.indexOf("[")].filter((i) => i >= 0);
  if (candidates.length === 0) throw new Error("no JSON found in model output");
  const start = Math.min(...candidates);
  const closeChar = fenced[start] === "{" ? "}" : "]";
  const end = fenced.lastIndexOf(closeChar);
  if (end <= start) throw new Error("unterminated JSON in model output");
  return JSON.parse(fenced.slice(start, end + 1));
}

const FORGE_ARCHITECT_SYSTEM =
  "You are the story architect of Book Forge, a serialized-novel pipeline. You output only valid JSON.";

export interface CreateBookInput {
  premise: string;
  title?: string;
}

/**
 * Forge a brand-new BookDef from an arbitrary premise: one LLM call for the
 * story bible, one for the 10-part arc. Persisted to books/<id>/bookdef.json
 * so it survives restarts. Returns the real definition (never a stub).
 */
export async function createBook(input: CreateBookInput): Promise<BookDef> {
  const premise = input.premise.trim().slice(0, 4_000);
  if (premise.length < 20) throw new Error("premise too short: give at least a sentence");

  // --- Call 1: story bible ---
  const biblePrompt = `Design an ORIGINAL serialized novel: exactly 100 chapters in 10 parts of 10 chapters each, built from this premise:

PREMISE: ${premise}

Requirements:
- If the premise resembles a well-known or existing story, you MUST still produce a genuinely DIFFERENT original take: fresh character names, a fresh setting, a fresh voice, and a fresh plot engine. Never recycle another book's characters or beats.
- A named protagonist with a concrete job, a personal wound, and an arc; 4-6 supporting characters with their own stakes; a named, specific setting.
- An escalation engine that keeps 100 chapters tense (e.g. anomaly -> protocol -> scrutiny -> loss -> wider world -> descent -> sacrifice -> resolution), with recurring motifs set up early and paid off late.
- Grounded and materialist: every strange phenomenon has a plausible mechanism; never resolve the deepest ambiguity with metaphysics.
- No supernatural forces, no chosen-one prophecy, no mind control, no real living public figures, no brand names.

Return ONLY valid JSON (no markdown fences):
{"title":"...","logline":"one sentence","bible":"STORY BIBLE, 600-900 words, with sections PREMISE / SETTING / RULES OR SCIENCE / CHARACTERS / VOICE AND MOTIFS / BANS. This text is ground truth the chapter writers will obey."}`;

  let title = "";
  let logline = "";
  let bible = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callLLM(
        [
          { role: "system", content: FORGE_ARCHITECT_SYSTEM },
          { role: "user", content: biblePrompt },
        ],
        4096
      );
      const parsed = extractJson(raw) as { title?: unknown; logline?: unknown; bible?: unknown };
      title = typeof parsed.title === "string" ? parsed.title.trim().slice(0, 120) : "";
      logline = typeof parsed.logline === "string" ? parsed.logline.trim().slice(0, 300) : "";
      bible = typeof parsed.bible === "string" ? parsed.bible.trim() : "";
      if (title && logline && bible.length >= 1_500) break;
      throw new Error(
        `bible too thin (title=${!!title}, logline=${!!logline}, bible=${bible.length} chars)`
      );
    } catch (err) {
      if (attempt >= 3) throw err;
      log(`[create] bible attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(10_000);
    }
  }
  if (!title) throw new Error("story bible generation failed: no title");
  if (input.title?.trim()) title = input.title.trim().slice(0, 120);

  // --- Call 2: ten-part arc ---
  const partsPrompt = `You are the story architect for the novel "${title}".

STORY BIBLE (ground truth):
${bible}

Split the novel into 10 parts of exactly 10 chapters (chapters 1-10, 11-20, ..., 91-100). For each part give: a short name, a synopsis of 3-5 sentences describing the concrete events that move the escalation engine forward, an openingBeat (the exact state the part's first chapter opens from), and a closingBeat (the exact state the part's final chapter must land on).

Return ONLY a valid JSON array of exactly 10 objects (no markdown fences):
[{"index":1,"name":"...","range":[1,10],"synopsis":"...","openingBeat":"...","closingBeat":"..."}]`;

  let parts: PartDef[] = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await callLLM(
        [
          { role: "system", content: FORGE_ARCHITECT_SYSTEM },
          { role: "user", content: partsPrompt },
        ],
        4096
      );
      const parsed = extractJson(raw) as Array<Partial<PartDef>>;
      if (!Array.isArray(parsed) || parsed.length !== 10) {
        throw new Error(`expected 10 parts, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}`);
      }
      parts = parsed.map((p, i) => ({
        index: i + 1,
        name: String(p.name ?? `Part ${i + 1}`).slice(0, 80),
        range: [i * 10 + 1, i * 10 + 10] as [number, number],
        synopsis: String(p.synopsis ?? "").trim(),
        openingBeat: String(p.openingBeat ?? "").trim(),
        closingBeat: String(p.closingBeat ?? "").trim(),
      }));
      const thin = parts.find((p) => p.synopsis.length < 120 || !p.openingBeat || !p.closingBeat);
      if (thin) throw new Error(`part ${thin.index} too thin to write from`);
      break;
    } catch (err) {
      if (attempt >= 3) throw err;
      log(`[create] parts attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`);
      await sleep(10_000);
    }
  }
  if (parts.length !== 10) throw new Error("part generation failed");

  const def: BookDef = {
    id: uniqueBookId(slugify(title)),
    title,
    author: "GLM 5.4 AI",
    logline,
    bible,
    parts,
    originPremise: premise,
  };
  mkdirSync(bookDir(def.id), { recursive: true });
  writeFileSync(join(bookDir(def.id), "bookdef.json"), JSON.stringify(def, null, 2));
  writeFileSync(join(bookDir(def.id), "bible.md"), def.bible);
  bookDefCache.set(def.id, def);
  log(`[create] forged "${def.title}" as book ${def.id} (bible ${def.bible.length} chars, 10 parts)`);
  return def;
}

// ---------------------------------------------------------------------------
// Premise dedup — a retried/re-sent novel request must never forge a duplicate
// ---------------------------------------------------------------------------

const PREMISE_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for", "with", "from",
  "her", "his", "their", "its", "my", "our", "your", "who", "that", "this", "is", "are",
  "was", "were", "be", "been", "discovers", "as", "by", "into",
  "write", "all", "chapters", "each", "words", "novel", "webnovel", "web", "serialized",
  "original", "start", "about", "it", "she", "he", "they", "them",
]);

function premiseTokens(text: string): Set<string> {
  const toks = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !PREMISE_STOPWORDS.has(t));
  return new Set(toks);
}

function overlapRatio(a: Set<string>, b: Set<string>): { ratio: number; shared: number } {
  if (a.size === 0 || b.size === 0) return { ratio: 0, shared: 0 };
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return { ratio: shared / a.size, shared };
}

export interface ExistingBookMatch {
  def: BookDef;
  score: number;
  reason: string;
}

/**
 * Find an existing book that already covers this premise. Primary signal:
 * token overlap with the book's stored originPremise (catches re-sent and
 * retried requests verbatim). Fallback: overlap with title+logline+bible.
 */
export function findExistingBookForPremise(premise: string): ExistingBookMatch | null {
  const want = premiseTokens(premise);
  if (want.size === 0) return null;
  let best: ExistingBookMatch | null = null;
  if (!existsSync(BOOKS_DIR)) return null;
  for (const entry of readdirSync(BOOKS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const def = getBookDef(entry.name);
    if (!def) continue;
    let score = 0;
    let reason = "";
    if (def.originPremise) {
      const { ratio, shared } = overlapRatio(want, premiseTokens(def.originPremise));
      if (ratio >= 0.6 && shared >= 2) {
        score = 1 + ratio;
        reason = `same origin premise (token match ${(ratio * 100).toFixed(0)}%)`;
      }
    }
    if (score === 0) {
      const corpus = premiseTokens(`${def.title} ${def.logline} ${def.bible.slice(0, 1_200)}`);
      const { ratio, shared } = overlapRatio(want, corpus);
      if (ratio >= 0.34 && shared >= 3) {
        score = ratio;
        reason = `matches existing story "${def.title}" (${shared} key story elements)`;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { def, score, reason };
    }
  }
  return best;
}

export interface ForgeOutcome {
  kind: "created" | "writing" | "resumed" | "complete";
  def: BookDef;
  state: BookState | null;
  runner: { started: boolean; message: string };
  note: string;
}

/**
 * The ONE entry point both chat paths use for novel requests. Dedups first:
 * a premise that already maps to a real book is reported (and its runner
 * resumed if stalled) instead of forging a duplicate.
 */
export async function forgeOrExisting(input: CreateBookInput & { forceNew?: boolean }): Promise<ForgeOutcome> {
  if (!input.forceNew) {
    const match = findExistingBookForPremise(input.premise);
    if (match) {
      const state = loadState(match.def.id);
      if (state?.phase === "done") {
        return {
          kind: "complete",
          def: match.def,
          state,
          runner: { started: false, message: "not needed — book complete" },
          note: `This premise is already a finished novel: "${match.def.title}" (${state.chaptersDone}/100 chapters, ${state.totalWords.toLocaleString()} words) — ${match.reason}`,
        };
      }
      if (!isRunnerRunning(match.def.id)) {
        const launched = startBookRunner(match.def.id);
        const fresh = loadState(match.def.id);
        return {
          kind: "resumed",
          def: match.def,
          state: fresh,
          runner: launched,
          note: `Resumed stalled writing of existing book "${match.def.title}" (bookId ${match.def.id}, ${fresh?.chaptersDone ?? 0}/100 chapters) — ${match.reason}`,
        };
      }
      return {
        kind: "writing",
        def: match.def,
        state,
        runner: { started: false, message: "already writing in the background" },
        note: `This premise is already a live project: "${match.def.title}" (bookId ${match.def.id}, ${state?.chaptersDone ?? 0}/100 chapters, ${state?.totalWords.toLocaleString() ?? 0} words) — ${match.reason}`,
      };
    }
  }
  const def = await createBook(input);
  const launched = startBookRunner(def.id);
  return {
    kind: "created",
    def,
    state: loadState(def.id),
    runner: launched,
    note: `Forged new novel "${def.title}" (bookId ${def.id})`,
  };
}

// ---------------------------------------------------------------------------
// LLM plumbing
// ---------------------------------------------------------------------------

let zaiPromise: Promise<ZAI> | null = null;
async function zai(): Promise<ZAI> {
  if (!zaiPromise) zaiPromise = ZAI.create();
  return zaiPromise;
}

function clipText(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

// --- Global concurrency gate: the gateway rate-limits hard, so serialize calls ---
const MAX_CONCURRENT_LLM_CALLS = 1;
const MIN_GAP_BETWEEN_CALLS_MS = 3_000;
let activeCalls = 0;
let lastCallStart = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activeCalls < MAX_CONCURRENT_LLM_CALLS) {
    activeCalls++;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  activeCalls++;
  // Global pacing: never start two calls closer than MIN_GAP_BETWEEN_CALLS_MS.
  const sinceLast = Date.now() - lastCallStart;
  if (sinceLast < MIN_GAP_BETWEEN_CALLS_MS) {
    await sleep(MIN_GAP_BETWEEN_CALLS_MS - sinceLast);
  }
  lastCallStart = Date.now();
}

function releaseSlot(): void {
  activeCalls--;
  const next = waiters.shift();
  if (next) next();
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.toLowerCase().includes("too many requests");
}

async function callLLM(
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  maxTokens = 4096
): Promise<string> {
  const client = await zai();
  let lastErr: unknown = null;
  await acquireSlot();
  try {
    let attempt = 0;
    let hardFails = 0;
    // Rate limits are NEVER fatal: the shared gateway can stay saturated for hours.
    // Wait patiently (capped, jittered exponential backoff) and retry forever — the
    // run is checkpointed, so patience costs nothing and wastes no quota.
    while (true) {
      attempt++;
      try {
        const res = (await client.chat.completions.create({
          messages,
          stream: false,
          max_tokens: maxTokens,
        })) as { choices?: Array<{ message?: { content?: string } }> };
        const content = res?.choices?.[0]?.message?.content ?? "";
        if (!content.trim()) throw new Error("empty completion");
        return content;
      } catch (err) {
        lastErr = err;
        const rateLimited = isRateLimitError(err);
        if (rateLimited) {
          const backoff = Math.min(30_000 * 2 ** (attempt - 1), 480_000); // 30s → 8 min cap
          const waitMs = backoff + Math.random() * 30_000;
          log(
            `LLM rate-limited (retry #${attempt}): ${
              err instanceof Error ? err.message : String(err)
            } — waiting ${Math.round(waitMs / 1000)}s`
          );
          await sleep(waitMs);
        } else {
          hardFails++;
          if (hardFails >= 5) {
            throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
          }
          const waitMs = 5_000 * hardFails;
          log(
            `LLM call failed (attempt ${attempt}, non-rate-limit): ${
              err instanceof Error ? err.message : String(err)
            } — waiting ${Math.round(waitMs / 1000)}s`
          );
          await sleep(waitMs);
        }
      }
    }
  } finally {
    releaseSlot();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  try {
    console.log(line);
    if (existsSync(BOOKS_DIR)) appendFileSync(join(BOOKS_DIR, "forge.log"), line + "\n");
  } catch {
    /* noop */
  }
}

// ---------------------------------------------------------------------------
// State management (checkpointing)
// ---------------------------------------------------------------------------

export interface ChapterState {
  status: "pending" | "outlined" | "done" | "failed";
  words: number;
  title?: string;
  attempts: number;
}

export interface BookState {
  bookId: string;
  title: string;
  phase: "idle" | "bible" | "outline" | "chapters" | "done";
  chapters: Record<number, ChapterState>;
  totalWords: number;
  chaptersDone: number;
  errors: string[];
  startedAt: string;
  updatedAt: string;
}

export function bookDir(bookId: string): string {
  return join(BOOKS_DIR, bookId);
}

export function loadState(bookId: string): BookState | null {
  const p = join(bookDir(bookId), "state.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as BookState;
  } catch {
    return null;
  }
}

export function saveState(state: BookState): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(join(bookDir(state.bookId), "state.json"), JSON.stringify(state, null, 2));
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** True when a runner process is alive for the book (pid file exists + pid responds). */
export function isRunnerRunning(bookId: string): boolean {
  const pidPath = join("/tmp", `novel-${bookId}.pid`);
  if (!existsSync(pidPath)) return false;
  try {
    const pid = Number(readFileSync(pidPath, "utf8").trim());
    process.kill(pid, 0); // throws when not alive
    return true;
  } catch {
    return false;
  }
}

/** Spawn the resumable runner for a book as a detached process (single-instance safe). */
export function startBookRunner(bookId: string): { started: boolean; message: string } {
  const def = getBookDef(bookId);
  if (!def) return { started: false, message: `unknown book: ${bookId}` };
  if (isRunnerRunning(bookId)) {
    const pid = Number(readFileSync(join("/tmp", `novel-${bookId}.pid`), "utf8").trim());
    return { started: false, message: `Runner already active (pid ${pid}).` };
  }
  const state = loadState(bookId);
  if (state?.phase === "done") {
    return { started: false, message: "Book already complete." };
  }
  const logPath = join("/tmp", "novel-run.log");
  const out = openSync(logPath, "a");
  const child = spawn("bun", ["scripts/run-novel.ts", bookId], {
    cwd: ROOT,
    stdio: ["ignore", out, out],
    detached: true,
    env: process.env,
  });
  child.unref();
  writeFileSync(join("/tmp", `novel-${bookId}.pid`), String(child.pid));
  return { started: true, message: `Book Forge started (pid ${child.pid}).` };
}

// ---------------------------------------------------------------------------
// Pipeline stages
// ---------------------------------------------------------------------------

function chapterFile(bookId: string, n: number): string {
  return join(bookDir(bookId), "manuscript", `ch${String(n).padStart(3, "0")}.md`);
}

export function readChapter(bookId: string, n: number): string | null {
  const p = chapterFile(bookId, n);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

async function generateOutlinePart(def: BookDef, part: PartDef): Promise<void> {
  const dir = bookDir(def.id);
  const outlinePath = join(dir, "outline.json");
  const outline = existsSync(outlinePath)
    ? (JSON.parse(readFileSync(outlinePath, "utf8")) as Record<string, unknown>)
    : {};

  if (Array.isArray(outline[String(part.index)])) return; // already done

  const prompt = `You are the story architect for the novel "${def.title}".

STORY BIBLE (ground truth):
${def.bible}

PART ${part.index} OF 10 — "${part.name}" (chapters ${part.range[0]}-${part.range[1]}):
${part.synopsis}
The part opens from this state: ${part.openingBeat}
The part must close on this state: ${part.closingBeat}

Expand this part into EXACTLY 10 chapter briefs, one per chapter (${part.range[0]} through ${part.range[1]}).
Each chapter needs: a short evocative title, a 2-4 sentence brief describing the concrete events of that chapter (who, where, what happens, what changes), and a single-sentence HOOK — the exact beat the chapter's final line must land. Hooks must escalate; the final chapter's hook must land the part's closing beat verbatim in spirit.

Respond with ONLY a JSON array (no markdown fences, no commentary) of 10 objects:
[{"n": <chapter number>, "title": "...", "brief": "...", "hook": "..."}]`;

  const raw = await callLLM(
    [
      { role: "system", content: "You are a rigorous story architect who outputs only valid JSON." },
      { role: "user", content: prompt },
    ],
    4096
  );

  const jsonText = raw.replace(/^\s*```(?:json)?/i, "").replace(/```\s*$/i, "").trim();
  const chapters = JSON.parse(jsonText) as Array<{ n: number; title: string; brief: string; hook: string }>;
  if (!Array.isArray(chapters) || chapters.length !== 10) {
    throw new Error(`outline part ${part.index}: expected 10 briefs, got ${chapters?.length}`);
  }
  outline[String(part.index)] = chapters;
  writeFileSync(outlinePath, JSON.stringify(outline, null, 2));
  log(`[outline] part ${part.index} (${part.name}) — 10 briefs`);
}

function previousChapterTail(def: BookDef, state: BookState, n: number): string {
  if (n > 1) {
    const prev = readChapter(def.id, n - 1);
    if (prev) {
      const body = prev.split("\n").slice(1).join("\n").trim(); // drop title line
      return `CONTINUITY — the previous chapter (Chapter ${n - 1}) ended with these final words. Your chapter must follow them seamlessly in time and mood:\n"""\n${clipText(body, 1600)}\n"""`;
    }
  }
  const partIdx = Math.ceil(n / 10);
  const part = def.parts[partIdx - 1];
  return `CONTINUITY — this chapter OPENS Part ${part.index} ("${part.name}"). The story so far stands at: ${part.openingBeat}`;
}

async function generateChapter(def: BookDef, state: BookState, n: number): Promise<void> {
  const partIdx = Math.ceil(n / 10);
  const part = def.parts[partIdx - 1];
  const outline = JSON.parse(readFileSync(join(bookDir(def.id), "outline.json"), "utf8")) as Record<
    string,
    Array<{ n: number; title: string; brief: string; hook: string }>
  >;
  const brief = outline[String(partIdx)].find((c) => c.n === n);
  if (!brief) throw new Error(`chapter ${n}: no brief found for part ${partIdx}`);

  const cs = state.chapters[n] ?? (state.chapters[n] = { status: "pending", words: 0, attempts: 0 });
  cs.attempts++;

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    {
      role: "system",
      content: `You are the novelist writing "${def.title}".\n\n${def.bible}\n\n${STYLE_RULES}`,
    },
    {
      role: "user",
      content: `PART ${part.index} OF 10 — "${part.name}" (chapters ${part.range[0]}-${part.range[1]}):
${part.synopsis}

CHAPTER ${n} OF 100 — "${brief.title}"
${brief.brief}
The chapter must END on this hook: ${brief.hook}

${previousChapterTail(def, state, n)}

Write the complete chapter now, 2,100-2,300 words. First line: "Chapter ${n} — ${brief.title}" then the prose.`,
    },
  ];

  let text = await callLLM(messages, 4096);
  let words = countWords(text);

  // Continuation fill if the model came back short.
  if (words < 1900) {
    log(`[ch${n}] short (${words} words) — requesting continuation`);
    const fill = await callLLM(
      [
        ...messages,
        { role: "assistant", content: text },
        {
          role: "user",
          content: `The chapter above is only ${words} words and must reach 2,100-2,300. Continue it EXACTLY from its final sentence (do not repeat, do not summarize, do not restart). Write roughly ${2300 - words} more words of the same scene or its continuation, and make sure the chapter's final line lands the required hook: ${brief.hook}. Output ONLY the continuation prose.`,
        },
      ],
      2048
    );
    text = `${text.trim()}\n${fill.trim()}`;
    words = countWords(text);
  }

  if (words < 1600) throw new Error(`chapter ${n}: too short after continuation (${words} words)`);

  mkdirSync(join(bookDir(def.id), "manuscript"), { recursive: true });
  writeFileSync(chapterFile(def.id, n), text.trim() + "\n");
  cs.status = "done";
  cs.words = words;
  cs.title = brief.title;
  state.totalWords += words - (state.chapters[n]?.words && cs.status === "done" ? state.chapters[n].words : 0);
  state.totalWords = Object.values(state.chapters)
    .filter((c) => c.status === "done")
    .reduce((a, c) => a + c.words, 0);
  state.chaptersDone = Object.values(state.chapters).filter((c) => c.status === "done").length;
  saveState(state);
  log(`[ch${n}] done — ${words} words (total ${state.totalWords})`);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runBlock(def: BookDef, state: BookState, partIdx: number): Promise<void> {
  const part = def.parts[partIdx - 1];
  for (let n = part.range[0]; n <= part.range[1]; n++) {
    const cs = state.chapters[n];
    if (cs?.status === "done") continue; // resumable
    // Rate-limit errors no longer reach this catch (callLLM waits them out forever),
    // so a failure here is a genuine generation problem. Retry the SAME chapter up
    // to 3 times, then defer — a later pass re-picks it (everything is checkpointed).
    let strikes = 0;
    while (state.chapters[n]?.status !== "done") {
      try {
        await generateChapter(def, state, n);
        break;
      } catch (err) {
        strikes++;
        const msg = `chapter ${n}: ${err instanceof Error ? err.message : String(err)}`;
        state.errors.push(msg);
        state.chapters[n] = {
          status: "failed",
          words: 0,
          attempts: (state.chapters[n]?.attempts ?? 0) + 1,
        };
        saveState(state);
        log(`[ch${n}] FAILED (strike ${strikes}/3) — ${msg}`);
        if (strikes >= 3) {
          log(`[ch${n}] deferred to a later pass`);
          break;
        }
        await sleep(60_000);
      }
    }
  }
}

/** Run the full book: outline (parallel) then 10 parallel block-workers. */
export async function runBook(bookId: string, forceRestart = false): Promise<BookState> {
  const def = getBookDef(bookId);
  if (!def) throw new Error(`unknown book: ${bookId}`);

  mkdirSync(bookDir(bookId), { recursive: true });
  mkdirSync(join(bookDir(bookId), "manuscript"), { recursive: true });

  let state = loadState(bookId);
  if (!state || forceRestart) {
    state = {
      bookId,
      title: def.title,
      phase: "bible",
      chapters: {},
      totalWords: 0,
      chaptersDone: 0,
      errors: [],
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    for (let n = 1; n <= 100; n++) state.chapters[n] = { status: "pending", words: 0, attempts: 0 };
    writeFileSync(join(bookDir(bookId), "bible.md"), def.bible);
    saveState(state);
  }

  if (state.phase === "done") {
    log(`[run] book ${bookId} already complete`);
    return state;
  }

  log(`[run] Book Forge starting "${def.title}" (100 chapters × ~2,200 words)`);
  state.phase = "outline";
  saveState(state);

  // 1) Outlines — sequential and patient (quota-friendly), resumable per part.
  for (const p of def.parts) {
    let ok = false;
    for (let attempt = 1; attempt <= 8 && !ok; attempt++) {
      try {
        await generateOutlinePart(def, p);
        ok = true;
      } catch (err) {
        log(
          `[outline] part ${p.index} attempt ${attempt} failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        await sleep(15_000 * attempt);
      }
    }
    if (!ok) throw new Error(`outline part ${p.index} failed after 8 attempts`);
  }

  state.phase = "chapters";
  saveState(state);

  // 2) Chapters — blocks run in parallel for continuity pipelining; the global
  //    call gate serializes actual LLM traffic, so quota is respected automatically.
  await Promise.all(def.parts.map((p) => runBlock(def, state!, p.index)));

  // 3) Final tally.
  const failed = Object.entries(state.chapters)
    .filter(([, c]) => c.status !== "done")
    .map(([n]) => Number(n));
  state.chaptersDone = Object.values(state.chapters).filter((c) => c.status === "done").length;
  state.totalWords = Object.values(state.chapters)
    .filter((c) => c.status === "done")
    .reduce((a, c) => a + c.words, 0);
  state.phase = failed.length === 0 ? "done" : "chapters"; // resumable if gaps remain
  saveState(state);
  log(`[run] Book Forge finished pass — ${state.chaptersDone}/100 chapters, ${state.totalWords} words, failed: [${failed.join(", ")}]`);

  // Auto-deliver: the moment the book is complete, assemble .md/.txt/.pdf so the
  // final output never depends on an external nudge.
  if (state.phase === "done") {
    try {
      log("[run] assembling deliverables (.md/.txt/.pdf)…");
      execFileSync("python3", ["scripts/assemble-novel.py", bookId], {
        cwd: ROOT,
        timeout: 300_000,
      });
      log("[run] deliverables assembled to public/deliverables/");
    } catch (err) {
      log(
        `[run] auto-assembly failed (can be run manually): ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  return state;
}
