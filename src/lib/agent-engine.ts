import "server-only";
import { db } from "@/lib/db";
import {
  streamChat,
  webSearch,
  pageReader,
  generateImage,
  isImageSize,
  type SdkChatMessage,
} from "@/lib/ai";
import {
  forgeOrExisting,
  getBookDef,
  isRunnerRunning,
  listBooks,
  loadState,
  startBookRunner,
} from "@/lib/novel-engine";
import { detectNovelIntent } from "@/lib/novel-intent";
import type {
  AgentStreamEvent,
  ArtifactKind,
  WebSearchResult,
} from "@/lib/types";

/**
 * GLM Agent Engine — a real multi-step tool-calling loop in the spirit of
 * chat.z.ai's agent mode, implemented honestly on verified gateway tools:
 *
 *   web_search · page_reader · generate_image · run_code · artifacts
 *
 * The model communicates intent through inline XML-ish blocks which the
 * engine filters out of the user-visible stream, executes, and feeds back:
 *
 *   <plan>{"steps":["...","..."]}</plan>              optional, once, up front
 *   <tool>{"name":"web_search","arguments":{...}}</tool>
 *   <artifact title="..." kind="markdown">raw content</artifact>
 *
 * Everything outside those blocks is the user-facing answer and streams live.
 */

const AGENT_MAX_ITERATIONS = 10; // model turns; the last one is reserved for the final answer
const AGENT_MAX_TOOL_STEPS = 24;
const PAGE_READER_CHAR_BUDGET = 6_000;
const TOOL_RESULT_CHAR_BUDGET = 9_000;
const ARTIFACT_MAX_CHARS = 400_000;
const CODE_EXEC_URL = "http://127.0.0.1:3010/run";

/** Ensure the code-exec mini-service is running (spawn as child of this server if not). */
async function ensureCodeExec(): Promise<boolean> {
  try {
    const h = await fetch("http://127.0.0.1:3010/health", { signal: AbortSignal.timeout(1_500) });
    if (h.ok) return true;
  } catch {
    /* not running — start it */
  }
  try {
    const { spawn } = await import("node:child_process");
    const { openSync } = await import("node:fs");
    const out = openSync("/tmp/code-exec.log", "a");
    const child = spawn("bun", ["index.ts"], {
      cwd: "/home/z/my-project/mini-services/code-exec",
      stdio: ["ignore", out, out],
      detached: true,
      env: process.env,
    });
    child.unref();
    // Give it a moment to bind.
    await new Promise((r) => setTimeout(r, 1_500));
    const h = await fetch("http://127.0.0.1:3010/health", { signal: AbortSignal.timeout(2_000) });
    return h.ok;
  } catch {
    return false;
  }
}

export const AGENT_SYSTEM_PROMPT = `You are GLM Agent, an autonomous task-execution agent inside the GLM 5.4 AI workspace.

You solve the user's task by working in steps: you may plan, call tools, create artifacts, and write a final answer. Everything you write OUTSIDE the special blocks below is streamed to the user as your reply.

# TOOL PROTOCOL (exact syntax)

1) Optional plan — at most once, as the very first thing you output, only for multi-step tasks:
<plan>{"steps":["Research the topic","Draft the document","Review key claims"]}</plan>
Rules: 2-6 steps, each under 80 characters, concrete and ordered.

2) Tool call — one call per block. After emitting tool block(s) you MUST end your turn so the environment can run them:
<tool>{"name":"web_search","arguments":{"query":"exact search query","num":5}}</tool>
<tool>{"name":"page_reader","arguments":{"url":"https://example.com/page"}}</tool>
<tool>{"name":"generate_image","arguments":{"prompt":"vivid image description","size":"1024x1024"}}</tool>
<tool>{"name":"run_code","arguments":{"code":"...full program...","language":"typescript","tests":"...optional bun:test file..."}}</tool>
<tool>{"name":"book_forge","arguments":{"action":"create","premise":"the user's story premise"}}</tool>
Rules:
- web_search: current events, facts you are unsure of, or when the user asks to research. num is 1-10 (default 5).
- page_reader: fetch the full text of a specific URL (often a web_search result).
- generate_image: create an illustration on request or when it clearly adds value.
- run_code: EXECUTE TypeScript/JavaScript in a sandbox and get real stdout/stderr/exit code. Whenever you write non-trivial code, RUN it first (with tests when possible) and iterate on the real output until it passes — never present unverified code as working. \"tests\" is an optional bun:test file that may import from \"./main\".
- book_forge: the platform's REAL long-form novel pipeline (story bible → 10-part arc → outline briefs → parallel block-workers, checkpointed per chapter). Actions:
  • {"action":"create","premise":"<the story premise>","title":"<optional override>","forceNew":true} — forges a brand-new ORIGINAL book and immediately starts writing it in the background. Call this IN THIS TURN whenever the user asks to write/start a novel, webnovel, or book of many chapters and no <system_note> below already reports that the platform did it — including when a previous book exists or is complete and the user asks for a NEW one. NEVER reply with only an acknowledgment like \"I understand you'd like me to create…\" and NEVER ask permission first — emitting words instead of this tool call is a failure. After the call, report the tool's real bookId, title and phase. Dedup: if the premise already exists in the library the tool returns THAT book instead of a duplicate (unless forceNew=true); when it does and the user truly wants a different new novel, confirm with the user, then re-call with forceNew=true.
  • {"action":"status","bookId":"<bookId>"} — real progress numbers for a book.
  • {"action":"start","bookId":"<bookId>"} — (re)launch a book's checkpointed runner.
  If a <system_note> reports Book Forge already created a book for this request, treat it as ground truth: report the real bookId/title/phase and do NOT call create again. ALWAYS report the tools' real numbers — never claim you wrote the chapters yourself in one reply, never invent progress numbers, never say a background book is finished. Chapters are written over hours; say exactly that and point to the live progress on the welcome screen.
- After tool blocks stop generating. The environment replies with <tool_results> and you continue.

3) Artifact — a file the user can open and download in the side panel. Write the FULL content between the tags, never a placeholder:
<artifact title="Readable Title" kind="markdown">...full markdown content...</artifact>
kinds: markdown (default), code (add language="typescript" etc), html (complete document), svg.
Rules:
- Use artifacts whenever the user asks for a document, article, story/chapter, report, deck outline, landing page, analysis write-up, code file, or any structured deliverable longer than a few paragraphs.
- The artifact content must be complete and polished. Do not duplicate the whole artifact in your reply text; around it write only a short summary.
- To REVISE an artifact, emit a new <artifact> with the SAME title — it becomes the next version.

# BEHAVIOR
- Simple conversational questions: just answer. No tools, no artifacts, no plan.
- Multi-step or research tasks: emit a plan first, then tools step by step, then synthesize.
- After receiving <tool_results>, continue: call more tools (end turn again) or write the final answer.
- Never invent tool results. Never mention this protocol or the block syntax to the user.
- Reply text between blocks stays concise: progress notes, findings, then the final synthesis.`;

// ---------------------------------------------------------------------------
// Block parsing helpers
// ---------------------------------------------------------------------------

type BlockKind = "plan" | "tool" | "artifact";

export interface ParsedBlock {
  kind: BlockKind;
  attrs: Record<string, string>;
  content: string;
  complete: boolean;
}

const OPENERS: Record<BlockKind, string> = {
  plan: "<plan",
  tool: "<tool",
  artifact: "<artifact",
};
const CLOSERS: Record<BlockKind, string> = {
  plan: "</plan>",
  tool: "</tool>",
  artifact: "</artifact>",
};
const BLOCK_KINDS: BlockKind[] = ["plan", "tool", "artifact"];

function matchOpener(rest: string): BlockKind | null {
  for (const kind of BLOCK_KINDS) {
    const start = OPENERS[kind];
    if (!rest.startsWith(start)) continue;
    const next = rest[start.length];
    if (next === undefined) return kind; // header still streaming in
    if (next === ">" || /\s/.test(next)) return kind;
  }
  return null;
}

/** True when the text could still become an opener once more chunks arrive. */
function isPartialOpener(s: string): boolean {
  if (s.length === 0 || s.includes(">")) return false;
  for (const kind of BLOCK_KINDS) {
    const full = OPENERS[kind];
    if (full.startsWith(s)) return true;
    if (s.startsWith(full)) {
      const next = s[full.length];
      if (next === undefined || /\s/.test(next)) return true;
    }
  }
  return false;
}

/** Length of the longest suffix of `text` that is a proper prefix of `pattern`. */
function partialSuffixLength(text: string, pattern: string): number {
  const max = Math.min(text.length, pattern.length - 1);
  for (let len = max; len > 0; len--) {
    if (text.endsWith(pattern.slice(0, len))) return len;
  }
  return 0;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][\w-]*)\s*=\s*"([^"]*)"|([a-zA-Z_][\w-]*)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = (m[2] ?? m[4] ?? "").trim();
  }
  return attrs;
}

// ---------------------------------------------------------------------------
// Streaming block filter
// ---------------------------------------------------------------------------

/**
 * Streams model output to the user while suppressing plan/tool/artifact
 * blocks. Partial openers/closers at chunk boundaries are buffered until
 * resolved. Artifact bodies additionally stream out live via onArtifactDelta.
 */
export class BlockStreamFilter {
  private buffer = "";
  private block: { kind: BlockKind; attrs: Record<string, string>; content: string; sent: number } | null =
    null;
  readonly blocks: ParsedBlock[] = [];
  private artifactIndex = 0;

  constructor(
    private readonly onVisible: (text: string) => void,
    private readonly onArtifactDelta: (tempId: string, text: string) => void
  ) {}

  push(text: string): void {
    if (!text) return;
    this.buffer += text;
    this.process(false);
  }

  /** Flush at end of stream; finalizes unclosed blocks. Returns all parsed blocks. */
  end(): ParsedBlock[] {
    this.process(true);
    if (this.block) {
      this.finalizeBlock(this.block.content, false);
      this.block = null;
    }
    if (this.buffer) {
      this.onVisible(this.buffer);
      this.buffer = "";
    }
    return this.blocks;
  }

  private process(flush: boolean): void {
    let progress = true;
    while (progress) {
      progress = false;

      if (this.block) {
        const closer = CLOSERS[this.block.kind];
        const closeIdx = this.buffer.indexOf(closer);
        if (closeIdx >= 0) {
          const part = this.buffer.slice(0, closeIdx);
          this.emitArtifactPart(part);
          this.buffer = this.buffer.slice(closeIdx + closer.length);
          this.finalizeBlock(this.block.content, true);
          this.block = null;
          progress = true;
        } else if (flush) {
          this.emitArtifactPart(this.buffer);
          this.buffer = "";
          this.finalizeBlock(this.block.content, false);
          this.block = null;
          progress = true;
        } else {
          const hold = partialSuffixLength(this.buffer, closer);
          const emitLen = this.buffer.length - hold;
          if (emitLen > 0) {
            const part = this.buffer.slice(0, emitLen);
            this.emitArtifactPart(part);
            this.buffer = this.buffer.slice(emitLen);
          }
        }
        continue;
      }

      // Normal mode: find the next '<' that could start one of our openers.
      let lt = this.buffer.indexOf("<");
      if (lt === -1) {
        if (this.buffer) {
          this.onVisible(this.buffer);
          this.buffer = "";
        }
        continue;
      }

      if (lt > 0) {
        this.onVisible(this.buffer.slice(0, lt));
        this.buffer = this.buffer.slice(lt);
        lt = 0;
      }

      const rest = this.buffer;
      const opener = matchOpener(rest);
      if (opener) {
        const nameLen = OPENERS[opener].length;
        const gt = this.buffer.indexOf(">", nameLen);
        if (gt === -1) {
          if (flush) {
            // Malformed opener at EOF — treat as visible text.
            this.onVisible(this.buffer.slice(0, 1));
            this.buffer = this.buffer.slice(1);
            progress = true;
            continue;
          }
          return; // wait for the rest of the header
        }
        const attrText = this.buffer.slice(nameLen, gt);
        this.buffer = this.buffer.slice(gt + 1);
        this.block = {
          kind: opener,
          attrs: opener === "artifact" ? parseAttrs(attrText) : {},
          content: "",
          sent: 0,
        };
        if (opener === "artifact") this.artifactIndex += 1;
        progress = true;
        continue;
      }

      if (!flush && isPartialOpener(rest)) return; // wait for more chunks

      // Emit this '<' and keep scanning.
      this.onVisible(this.buffer.slice(0, 1));
      this.buffer = this.buffer.slice(1);
      progress = true;
    }
  }

  private emitArtifactPart(part: string): void {
    if (!this.block || !part) return;
    this.block.content += part;
    if (this.block.kind === "artifact") {
      const unsent = this.block.content.slice(this.block.sent);
      if (unsent) {
        this.onArtifactDelta(`pending-artifact-${this.artifactIndex}`, unsent);
        this.block.sent = this.block.content.length;
      }
    }
  }

  private finalizeBlock(content: string, complete: boolean): void {
    if (!this.block) return;
    this.blocks.push({
      kind: this.block.kind,
      attrs: this.block.attrs,
      content,
      complete,
    });
  }
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

interface ToolOutcome {
  ok: boolean;
  resultText: string;
  detail: Record<string, unknown>;
  /** Extra artifact created as a side effect (images). */
  imageArtifact?: { title: string; documentId: string };
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max) + "…";
}

function formatSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) return "No results found.";
  return results
    .map((r, i) => {
      const date = r.date ? ` (${r.date})` : "";
      return `[${i + 1}] ${r.name}${date} — ${r.host_name}\nURL: ${r.url}\n${clip(r.snippet, 400)}`;
    })
    .join("\n\n");
}

async function executeTool(
  userId: string,
  name: string,
  args: Record<string, unknown>
): Promise<ToolOutcome> {
  switch (name) {
    case "web_search": {
      const query = typeof args.query === "string" ? args.query.trim().slice(0, 400) : "";
      if (!query) return { ok: false, resultText: "web_search failed: missing query.", detail: {} };
      const numRaw = typeof args.num === "number" ? Math.round(args.num) : 5;
      const num = Math.min(10, Math.max(1, Number.isFinite(numRaw) ? numRaw : 5));
      const results = await webSearch(query, num);
      return {
        ok: true,
        resultText: `web_search("${query}") → ${results.length} results:\n\n${formatSearchResults(results)}`,
        detail: { query, count: results.length },
      };
    }

    case "page_reader": {
      const url = typeof args.url === "string" ? args.url.trim().slice(0, 2_000) : "";
      if (!/^https?:\/\//i.test(url)) {
        return { ok: false, resultText: "page_reader failed: a valid http(s) URL is required.", detail: { url } };
      }
      const page = await pageReader(url);
      const text = clip(page.text || "(no extractable text)", PAGE_READER_CHAR_BUDGET);
      return {
        ok: true,
        resultText: `page_reader("${url}") — "${page.title}" (${text.length} chars extracted):\n\n${text}`,
        detail: { url, title: page.title, chars: text.length },
      };
    }

    case "generate_image": {
      const prompt = typeof args.prompt === "string" ? args.prompt.trim().slice(0, 1_000) : "";
      if (!prompt) return { ok: false, resultText: "generate_image failed: missing prompt.", detail: {} };
      const size = isImageSize(args.size) ? args.size : "1024x1024";
      const b64 = await generateImage(prompt, size);
      const slug =
        prompt
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 48) || "image";
      const doc = await db.document.create({
        data: {
          userId,
          name: `${slug}.png`,
          mime: "image/png",
          size: Math.round((b64.length * 3) / 4),
          kind: "image",
          content: b64,
        },
      });
      return {
        ok: true,
        resultText: `generate_image ok. The illustration is saved as artifact "${slug}" and shown to the user automatically. documentId=${doc.id}`,
        detail: { prompt, size, documentId: doc.id },
        imageArtifact: { title: slug, documentId: doc.id },
      };
    }

    case "run_code": {
      const code = typeof args.code === "string" ? args.code.slice(0, 100_000) : "";
      if (!code.trim()) return { ok: false, resultText: "run_code failed: missing code.", detail: {} };
      const language = args.language === "javascript" ? "javascript" : "typescript";
      const tests = typeof args.tests === "string" ? args.tests.slice(0, 60_000) : undefined;
      const stdin = typeof args.stdin === "string" ? args.stdin.slice(0, 20_000) : undefined;
      const timeoutMs = typeof args.timeoutMs === "number" ? Math.round(args.timeoutMs) : undefined;
      if (!(await ensureCodeExec())) {
        return { ok: false, resultText: "run_code failed: the code-exec service could not be started.", detail: {} };
      }
      try {
        const res = await fetch(CODE_EXEC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, language, tests, stdin, timeoutMs }),
          signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) {
          const t = await res.text();
          return { ok: false, resultText: `run_code failed: executor HTTP ${res.status} ${clip(t, 300)}`, detail: {} };
        }
        const r = (await res.json()) as {
          exitCode: number;
          stdout: string;
          stderr: string;
          timedOut: boolean;
          durationMs: number;
          ranTests: boolean;
        };
        const verdict = r.ranTests ? "tests" : "program";
        const header = r.timedOut
          ? `run_code: ${verdict} TIMED OUT after ${r.durationMs}ms`
          : `run_code: ${verdict} ${r.exitCode === 0 ? "PASSED" : `FAILED (exit ${r.exitCode})`} in ${r.durationMs}ms`;
        const parts = [header, "", "--- stdout ---", clip(r.stdout || "(empty)", 3_500), "--- stderr ---", clip(r.stderr || "(empty)", 3_500)];
        return {
          ok: !r.timedOut && r.exitCode === 0,
          resultText: parts.join("\n"),
          detail: { exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs, ranTests: r.ranTests },
        };
      } catch (err) {
        return {
          ok: false,
          resultText: `run_code failed: ${err instanceof Error ? err.message : String(err)} (is the code-exec service on :3010 running?)`,
          detail: {},
        };
      }
    }

    case "book_forge": {
      const rawAction = typeof args.action === "string" ? args.action : "status";
      const action = ["create", "start", "status"].includes(rawAction) ? rawAction : "status";

      // --- create: forge a brand-new book from a premise, then launch its runner ---
      if (action === "create") {
        const premise = typeof args.premise === "string" ? args.premise.trim() : "";
        const title = typeof args.title === "string" && args.title.trim() ? args.title.trim() : undefined;
        if (premise.length < 20) {
          return {
            ok: false,
            resultText:
              'book_forge create failed: "premise" is required — the story premise as a sentence or two. Example: {"action":"create","premise":"a marine-biology graduate student discovers her lab bioreactor is dreaming"}. Retry now with the user\'s premise.',
            detail: {},
          };
        }
        const forceNew = args.forceNew === true;
        // Dedup: a retried/re-sent premise must return the EXISTING book, not
        // forge a duplicate (three identical runners once saturated the gateway).
        const outcome = await forgeOrExisting({ premise, title, forceNew });
        const { def, state } = outcome;
        let lines: string[];
        if (outcome.kind === "created") {
          lines = [
            `Book Forge created a NEW original book and launched its runner:`,
            `- bookId: ${def.id}`,
            `- title: "${def.title}"`,
            `- logline: ${def.logline}`,
            `- 10-part arc locked; runner: ${outcome.runner.started ? "WRITING NOW (pid noted in message)" : outcome.runner.message}`,
            `- what happens next, automatically and checkpointed: outline briefs → 100 chapters × ~2,200 words, several hours of background writing`,
            `- live progress: the Book Forge card on the welcome screen (currently phase=${state?.phase ?? "bible"})`,
            `- when phase=done: /deliverables/${def.id}.md and /deliverables/${def.id}.pdf appear automatically`,
            "",
            "Report the real bookId and title to the user. State plainly that chapters are being written in the background right now (NOT in this reply) and progress is visible live on the welcome screen.",
          ];
        } else if (outcome.kind === "complete") {
          lines = [
            `Book Forge dedup: this premise is ALREADY a finished novel — no new book was created:`,
            `- bookId: ${def.id}`,
            `- title: "${def.title}"`,
            `- progress: ${state?.chaptersDone ?? 0}/100 chapters, ${(state?.totalWords ?? 0).toLocaleString()} words, phase=${state?.phase}`,
            `- deliverables: /deliverables/${def.id}.md and /deliverables/${def.id}.pdf`,
            "",
            `Tell the user this novel already exists and is complete; link the deliverables. If they explicitly want a brand-NEW novel from the same premise, ask them to confirm with "write a new one" — then re-call this tool with forceNew=true.`,
          ];
        } else if (outcome.kind === "resumed") {
          lines = [
            `Book Forge dedup: this premise is ALREADY a book, and its stalled writer was just RESUMED — no duplicate was created:`,
            `- bookId: ${def.id}`,
            `- title: "${def.title}"`,
            `- progress: ${state?.chaptersDone ?? 0}/100 chapters, ${(state?.totalWords ?? 0).toLocaleString()} words`,
            `- runner: ${outcome.runner.message}`,
            "",
            `Tell the user this novel already existed and is writing again from its checkpoint. Give the real title and progress.`,
          ];
        } else {
          lines = [
            `Book Forge dedup: this premise is ALREADY a live project — no new book was created, no second writer launched:`,
            `- bookId: ${def.id}`,
            `- title: "${def.title}"`,
            `- progress: ${state?.chaptersDone ?? 0}/100 chapters, ${(state?.totalWords ?? 0).toLocaleString()} words, phase=${state?.phase}`,
            `- runner: ${outcome.runner.message}`,
            "",
            `Tell the user this novel is already being written right now with the REAL title and progress above; point to the live progress card on the welcome screen. If the user explicitly wants a DIFFERENT new novel, ask them to confirm with "write a new one" — then re-call this tool with forceNew=true.`,
          ];
        }
        return {
          ok: true,
          resultText: clip(lines.join("\n"), TOOL_RESULT_CHAR_BUDGET),
          detail: { action, bookId: def.id, title: def.title, phase: state?.phase ?? "bible", forgeKind: outcome.kind },
        };
      }

      // --- status / start: operate on a known book ---
      const requested =
        typeof args.bookId === "string" && args.bookId.trim()
          ? args.bookId.trim()
          : listBooks()[0]?.bookId ?? "";
      const def = getBookDef(requested);
      if (!def) {
        const known = listBooks().map(
          (b) => `- ${b.bookId} — "${b.title}" (${b.phase}, ${b.chaptersDone}/100 chapters)`
        );
        return {
          ok: true,
          resultText: `Unknown bookId "${requested}". Known books:\n${known.join("\n") || "(none yet)"}\n\nRe-call with one of these bookIds — or use action "create" with a premise to forge a NEW book. If the user asked for a NEW novel, create it now; do not just describe it.`,
          detail: { unknownBookId: requested },
        };
      }
      const bookId = def.id;

      let startMessage = "";
      if (action === "start") {
        const r = startBookRunner(bookId);
        startMessage = r.message;
      }

      const state = loadState(bookId);
      const running = isRunnerRunning(bookId);
      const failedChapters = state
        ? Object.entries(state.chapters)
            .filter(([, c]) => c.status === "failed")
            .map(([n]) => Number(n))
        : [];

      const lines: string[] = [
        `Book Forge — "${def.title}" (bookId=${bookId})`,
        state
          ? `- phase: ${state.phase}`
          : "- phase: idle (no run started yet)",
        state
          ? `- progress: ${state.chaptersDone}/100 chapters, ${state.totalWords.toLocaleString("en-US")} words (target: 100 × ~2,200)`
          : "- progress: 0/100 chapters, 0 words",
        `- runner: ${running ? "RUNNING (checkpointed, continues automatically)" : "not running"}`,
        failedChapters.length > 0
          ? `- chapters deferred for retry: ${failedChapters.join(", ")}`
          : "- no failed chapters",
        `- deliverables (when phase=done): /deliverables/${bookId}.md and /deliverables/${bookId}.pdf — downloadable from the welcome screen`,
      ];
      if (startMessage) lines.push(`- start action result: ${startMessage}`);
      lines.push(
        "",
        "Report these REAL numbers to the user verbatim. If phase=done, congratulate and link the deliverables. If still writing, explain the run is checkpointed and finishes automatically; the welcome screen shows live progress. If the user wanted a NEW book (not this one), call book_forge with action=\"create\" and their premise NOW."
      );

      return {
        ok: true,
        resultText: clip(lines.join("\n"), TOOL_RESULT_CHAR_BUDGET),
        detail: {
          action,
          bookId,
          phase: state?.phase ?? "idle",
          chaptersDone: state?.chaptersDone ?? 0,
          totalWords: state?.totalWords ?? 0,
          running,
        },
      };
    }

    default:
      return {
        ok: false,
        resultText: `Unknown tool "${name}". Available tools: web_search, page_reader, generate_image, run_code, book_forge.`,
        detail: {},
      };
  }
}

// ---------------------------------------------------------------------------
// Artifacts
// ---------------------------------------------------------------------------

const ARTIFACT_KINDS: ArtifactKind[] = ["markdown", "code", "html", "svg", "image"];

function normalizeArtifactInput(attrs: Record<string, string>, content: string) {
  const rawKind = (attrs.kind ?? "markdown").toLowerCase() as ArtifactKind;
  const kind: ArtifactKind = ARTIFACT_KINDS.includes(rawKind) ? rawKind : "markdown";
  const title = (attrs.title ?? "Untitled").replace(/\s+/g, " ").trim().slice(0, 120) || "Untitled";
  const language = attrs.language ? attrs.language.trim().slice(0, 40) : null;
  return { kind, title, language, content: content.slice(0, ARTIFACT_MAX_CHARS) };
}

async function upsertArtifact(
  conversationId: string,
  messageId: string,
  input: { title: string; kind: ArtifactKind; language: string | null; content: string }
) {
  const existing = await db.artifact.findMany({
    where: { conversationId },
    select: { id: true, title: true },
  });
  const match = existing.find((a) => a.title.toLowerCase() === input.title.toLowerCase());
  if (match) {
    const updated = await db.artifact.update({
      where: { id: match.id },
      data: {
        messageId,
        kind: input.kind,
        language: input.language,
        content: input.content,
        version: { increment: 1 },
      },
    });
    return updated;
  }
  return db.artifact.create({
    data: {
      conversationId,
      messageId,
      title: input.title,
      kind: input.kind,
      language: input.language,
      content: input.content,
    },
  });
}

// ---------------------------------------------------------------------------
// Deterministic novel intent lives in @/lib/novel-intent (shared with plain chat).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The agent loop
// ---------------------------------------------------------------------------

export interface AgentRunOptions {
  userId: string;
  conversationId: string;
  assistantMessageId: string;
  /** [system, ...history, user turn] — composed by the route. */
  baseMessages: SdkChatMessage[];
  thinking: boolean;
  signal: AbortSignal;
}

export interface AgentRunStats {
  fullText: string;
  thinkingText: string;
  model: string | null;
  usage: { prompt_tokens: number; completion_tokens: number } | null;
  iterations: number;
  status: "complete" | "cancelled";
  toolsUsed: string[];
  artifactsCreated: number;
}

/**
 * Runs the agent loop, streaming events through `send`. Persists agent steps
 * and artifacts as they happen. Throws on upstream failure (route handles).
 */
export async function runAgent(
  opts: AgentRunOptions,
  send: (event: AgentStreamEvent) => void
): Promise<AgentRunStats> {
  const messages: SdkChatMessage[] = [...opts.baseMessages];
  const startedAt = Date.now();

  let fullText = ""; // user-visible accumulation (incl. [[artifact:id]] markers)
  let thinkingText = "";
  let model: string | null = null;
  let usage: { prompt_tokens: number; completion_tokens: number } | null = null;
  let stepIdx = 0;
  let iterations = 0;
  const toolsUsed = new Set<string>();
  let artifactsCreated = 0;

  const aborted = () => opts.signal.aborted;

  // ---- Deterministic Book Forge intent: forge the book BEFORE the model speaks.
  // This runs on every turn; it must never break the chat, hence the outer catch.
  try {
    const userTexts = opts.baseMessages.filter((m) => m.role === "user").map((m) => m.content);
    const lastUser = userTexts[userTexts.length - 1] ?? "";
    const intent = detectNovelIntent(lastUser, userTexts.slice(0, -1));
    if (intent) {
      const stepRow = await db.agentStep.create({
        data: {
          messageId: opts.assistantMessageId,
          conversationId: opts.conversationId,
          idx: stepIdx++,
          kind: "tool",
          tool: "book_forge",
          title: "Book Forge — checking the library, then forging",
          status: "running",
        },
      });
      send({
        type: "step",
        id: stepRow.id,
        idx: stepRow.idx,
        kind: "tool",
        tool: "book_forge",
        title: stepRow.title,
        status: "running",
      });
      toolsUsed.add("book_forge");
      try {
        // Dedup: retried/re-sent premises return the EXISTING book instead of
        // forging duplicates; explicitly-new requests (forceNew) bypass dedup.
        const outcome = await forgeOrExisting({ premise: intent.premise, forceNew: intent.forceNew });
        const { def, state } = outcome;
        const stepTitle =
          outcome.kind === "created"
            ? `Book Forge — forged "${def.title}"`
            : outcome.kind === "complete"
              ? `Book Forge — already complete: "${def.title}"`
              : outcome.kind === "resumed"
                ? `Book Forge — resumed "${def.title}"`
                : `Book Forge — already writing: "${def.title}"`;
        await db.agentStep.update({
          where: { id: stepRow.id },
          data: {
            status: "done",
            title: stepTitle,
            detail: JSON.stringify({ bookId: def.id, title: def.title, runner: outcome.runner.message, kind: outcome.kind }),
          },
        });
        send({
          type: "step",
          id: stepRow.id,
          idx: stepRow.idx,
          kind: "tool",
          tool: "book_forge",
          title: stepTitle,
          status: "done",
          detail: JSON.stringify({ bookId: def.id, title: def.title, runner: outcome.runner.message, kind: outcome.kind }),
        });
        const facts = `bookId=${def.id}; title="${def.title}"; logline=${def.logline}; chapters=${state?.chaptersDone ?? 0}/100; words=${(state?.totalWords ?? 0).toLocaleString()}; phase=${state?.phase ?? "bible"}; runner=${outcome.runner.message}`;
        const tail = ` Live progress: the Book Forge Library card on the welcome screen. When phase=done, deliverables appear at /deliverables/${def.id}.md and /deliverables/${def.id}.pdf.`;
        let note: string;
        if (outcome.kind === "created") {
          note =
            `<system_note> The platform has ALREADY executed the user's novel request through Book Forge before your reply. REAL results — report these, change nothing: ${facts}. 100 chapters × ~2,200 words are being written in the background over the coming hours (story bible → 10-part arc → outline briefs → parallel block-workers, checkpointed after every chapter).${tail} ` +
            `In your reply: state plainly that Book Forge has started writing this new novel right now, give the real title, explain the background writing honestly (not finished yet, checkpointed, resumable), and point to the live progress card. DO NOT ask permission. DO NOT offer to write a sample chapter instead. DO NOT call book_forge create again for this request. DO NOT claim the book is finished.</system_note>`;
        } else if (outcome.kind === "complete") {
          note =
            `<system_note> Book Forge dedup: this premise is ALREADY a finished novel — no new book was created. REAL facts — report these, change nothing: ${facts}.${tail} ` +
            `In your reply: tell the user this exact novel is already complete, give the real title and deliverable links. If they want a brand-NEW novel from the same premise, tell them to say "write a new one" — then call book_forge create with forceNew=true.</system_note>`;
        } else if (outcome.kind === "resumed") {
          note =
            `<system_note> Book Forge dedup: this premise is ALREADY a book, and its stalled writer was just RESUMED — no duplicate was created. REAL facts — report these, change nothing: ${facts}.${tail} ` +
            `In your reply: tell the user this novel already existed and is writing again from its checkpoint, with the real title and progress. DO NOT claim you started a brand-new book.</system_note>`;
        } else {
          note =
            `<system_note> Book Forge dedup: this premise is ALREADY a live project — no new book was created and no second writer was launched (the message looked like a retry of the same request). REAL facts — report these, change nothing: ${facts}.${tail} ` +
            `In your reply: tell the user this novel is already being written right now with the real title and chapter/word progress, and point to the live progress card. DO NOT call book_forge create again for this premise. If the user explicitly wants a DIFFERENT new novel, tell them to say "write a new one" — then call book_forge create with forceNew=true.</system_note>`;
        }
        messages.push({ role: "user", content: note });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await db.agentStep.update({
          where: { id: stepRow.id },
          data: {
            status: "error",
            detail: JSON.stringify({ error: clip(msg, 300) }),
          },
        });
        send({
          type: "step",
          id: stepRow.id,
          idx: stepRow.idx,
          kind: "tool",
          tool: "book_forge",
          title: stepRow.title,
          status: "error",
          detail: JSON.stringify({ error: clip(msg, 300) }),
        });
        messages.push({
          role: "user",
          content: `<system_note> Book Forge failed to create the book: ${clip(msg, 300)}. Tell the user this honestly and suggest trying again shortly.</system_note>`,
        });
      }
    }
  } catch {
    /* intent detection must never break the chat */
  }

  for (let iteration = 1; iteration <= AGENT_MAX_ITERATIONS; iteration++) {
    iterations = iteration;
    const isFinalIteration = iteration === AGENT_MAX_ITERATIONS;
    if (isFinalIteration) {
      messages.push({
        role: "user",
        content:
          "Tool budget reached. Write your final answer NOW. Do not emit any plan, tool, or artifact blocks.",
      });
    }

    // ---- One model turn, streamed through the block filter ----
    const deltas: string[] = [];
    const artifactDeltas: Array<{ tempId: string; text: string }> = [];
    const filter = new BlockStreamFilter(
      (t) => deltas.push(t),
      (tempId, t) => artifactDeltas.push({ tempId, text: t })
    );
    const iterStart = fullText.length;

    for await (const chunk of streamChat(messages, { thinking: opts.thinking, signal: opts.signal })) {
      if (chunk.model) model = chunk.model;
      if (chunk.usage) usage = chunk.usage;
      if (chunk.thinking) {
        thinkingText += chunk.thinking;
        send({ type: "thinking", text: chunk.thinking });
      }
      if (chunk.text) {
        deltas.length = 0;
        artifactDeltas.length = 0;
        filter.push(chunk.text);
        for (const d of deltas) {
          fullText += d;
          send({ type: "delta", text: d });
        }
        for (const a of artifactDeltas) send({ type: "artifact_delta", tempId: a.tempId, text: a.text });
      }
      if (chunk.finished || aborted()) break;
    }

    deltas.length = 0;
    artifactDeltas.length = 0;
    const blocks = filter.end();
    for (const d of deltas) {
      fullText += d;
      send({ type: "delta", text: d });
    }
    for (const a of artifactDeltas) send({ type: "artifact_delta", tempId: a.tempId, text: a.text });

    const visibleThisIter = fullText.slice(iterStart);
    let executedTools = false;
    const toolResults: string[] = [];

    // ---- Execute blocks ----
    for (const block of blocks) {
      if (aborted()) break;

      if (block.kind === "plan") {
        let steps: string[] = [];
        try {
          const parsed = JSON.parse(block.content.trim());
          if (Array.isArray(parsed?.steps)) {
            steps = parsed.steps
              .filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0)
              .map((s: string) => s.trim().slice(0, 120))
              .slice(0, 6);
          }
        } catch {
          /* malformed plan — ignore */
        }
        if (steps.length > 0) {
          const row = await db.agentStep.create({
            data: {
              messageId: opts.assistantMessageId,
              conversationId: opts.conversationId,
              idx: stepIdx++,
              kind: "plan",
              title: `Plan: ${steps.length} step${steps.length === 1 ? "" : "s"}`,
              detail: JSON.stringify({ steps }),
              status: "done",
            },
          });
          send({ type: "plan", steps });
          send({
            type: "step",
            id: row.id,
            idx: row.idx,
            kind: "plan",
            tool: null,
            title: row.title,
            status: "done",
            detail: row.detail,
          });
        }
        continue;
      }

      if (block.kind === "tool") {
        executedTools = true;
        if (stepIdx >= AGENT_MAX_TOOL_STEPS) {
          toolResults.push("Tool budget exhausted — proceed without further tool calls.");
          continue;
        }
        let name = "unknown";
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(block.content.trim());
          if (typeof parsed?.name === "string") name = parsed.name;
          if (parsed?.arguments && typeof parsed.arguments === "object") args = parsed.arguments;
        } catch {
          toolResults.push(`Malformed tool call skipped: ${clip(block.content, 200)}`);
          continue;
        }

        const titles: Record<string, string> = {
          web_search: "Searching the web",
          page_reader: "Reading the page",
          generate_image: "Generating an image",
        };
        const title = titles[name] ?? `Calling ${name}`;

        const runningRow = await db.agentStep.create({
          data: {
            messageId: opts.assistantMessageId,
            conversationId: opts.conversationId,
            idx: stepIdx++,
            kind: "tool",
            tool: name,
            title,
            status: "running",
          },
        });
        toolsUsed.add(name);
        send({
          type: "step",
          id: runningRow.id,
          idx: runningRow.idx,
          kind: "tool",
          tool: name,
          title,
          status: "running",
        });

        try {
          const outcome = await executeTool(opts.userId, name, args);
          await db.agentStep.update({
            where: { id: runningRow.id },
            data: {
              status: outcome.ok ? "done" : "error",
              detail: JSON.stringify(outcome.detail),
            },
          });
          send({
            type: "step",
            id: runningRow.id,
            idx: runningRow.idx,
            kind: "tool",
            tool: name,
            title,
            status: outcome.ok ? "done" : "error",
            detail: JSON.stringify(outcome.detail),
          });
          toolResults.push(clip(outcome.resultText, TOOL_RESULT_CHAR_BUDGET));

          if (outcome.imageArtifact) {
            const artifact = await upsertArtifact(opts.conversationId, opts.assistantMessageId, {
              title: outcome.imageArtifact.title,
              kind: "image",
              language: null,
              content: outcome.imageArtifact.documentId,
            });
            fullText += `\n\n[[artifact:${artifact.id}]]\n\n`;
            artifactsCreated += 1;
            send({
              type: "artifact",
              id: artifact.id,
              title: artifact.title,
              kind: "image",
              language: null,
              version: artifact.version,
              updatedAt: artifact.updatedAt.toISOString(),
            });
            await db.agentStep.create({
              data: {
                messageId: opts.assistantMessageId,
                conversationId: opts.conversationId,
                idx: stepIdx++,
                kind: "artifact",
                tool: "image",
                title: `Image: ${artifact.title}`,
                detail: JSON.stringify({ artifactId: artifact.id }),
                status: "done",
              },
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : "Tool execution failed.";
          await db.agentStep.update({
            where: { id: runningRow.id },
            data: { status: "error", detail: JSON.stringify({ error: clip(message, 300) }) },
          });
          send({
            type: "step",
            id: runningRow.id,
            idx: runningRow.idx,
            kind: "tool",
            tool: name,
            title,
            status: "error",
            detail: JSON.stringify({ error: clip(message, 300) }),
          });
          toolResults.push(`Tool "${name}" failed: ${clip(message, 500)}. Continue without it.`);
        }
        continue;
      }

      // ---- artifact ----
      const input = normalizeArtifactInput(block.attrs, block.content);
      const artifact = await upsertArtifact(opts.conversationId, opts.assistantMessageId, input);
      artifactsCreated += 1;
      fullText += `\n\n[[artifact:${artifact.id}]]\n\n`;
      send({
        type: "artifact",
        id: artifact.id,
        title: artifact.title,
        kind: input.kind,
        language: input.language,
        version: artifact.version,
        updatedAt: artifact.updatedAt.toISOString(),
      });
      await db.agentStep.create({
        data: {
          messageId: opts.assistantMessageId,
          conversationId: opts.conversationId,
          idx: stepIdx++,
          kind: "artifact",
          tool: "artifact",
          title: `Artifact: ${artifact.title}${artifact.version > 1 ? ` (v${artifact.version})` : ""}`,
          detail: JSON.stringify({ artifactId: artifact.id, kind: input.kind, version: artifact.version }),
          status: "done",
        },
      });
    }

    if (aborted()) break;

    // Tools were executed → feed results back and continue; otherwise done.
    if (!executedTools || isFinalIteration) break;

    const trimmedVisible = visibleThisIter.trim();
    if (trimmedVisible) messages.push({ role: "assistant", content: clip(trimmedVisible, 8_000) });
    messages.push({
      role: "user",
      content:
        `<tool_results>\n\n${toolResults.join("\n\n---\n\n")}\n\n</tool_results>\n\n` +
        "Continue the task: call more tools if genuinely needed (end your turn right after the tool blocks), otherwise write the final answer now.",
    });
  }

  return {
    fullText,
    thinkingText,
    model,
    usage,
    iterations,
    status: aborted() ? "cancelled" : "complete",
    toolsUsed: [...toolsUsed],
    artifactsCreated,
  };
}
