# GLM 5.4 AI — Next-Generation AI Workspace

A production-ready, full-stack AI workspace built on **Next.js 16 (App Router) + TypeScript + Tailwind CSS 4 + shadcn/ui + Prisma (SQLite)**, powered by the official **Z.ai gateway** through `z-ai-web-dev-sdk` (server-side only).

> **Naming honesty:** "GLM 5.4 AI" is the product name. The actual served model is whatever the Z.ai gateway routes (currently `glm-4-plus`, captured live at runtime and displayed in the UI). Vision requests are served by `glm-5v-turbo`. We never hardcode or invent model IDs or capabilities — the in-app **About dialog** shows a capability manifest with per-capability verification status.

---

## ✨ Features

| Area | What you get |
| --- | --- |
| **Streaming chat** | Token-by-token SSE streaming, live caret, stop/resume, regenerate, auto-titling |
| **Thinking mode** | Toggleable chain-of-thought requests (`thinking.enabled`), collapsible reasoning trace when the model emits one |
| **Web search tool** | Optional per-message grounding via the gateway's `web_search` function; results rendered as a status chip and cited context |
| **Vision & files** | Drag-and-drop or picker uploads: images (PNG/JPEG/WebP/GIF/BMP) and PDF/DOCX analyzed by the vision model via data URLs |
| **Long documents (RAG)** | Text files are chunked on ingest (paragraph-aware, overlapping) and retrieved per-query with BM25 scoring; AI map-reduce summarization |
| **Conversations** | Persistent history, pin/archive/rename, full-text-ish search, per-conversation system prompt, Markdown/JSON export, last-conversation auto-restore on reload |
| **Agent workspace** | chat.z.ai-style shell: Z-brand sidebar (Home / Scheduled / Cloud / Recents), "More than coding..." hero with agent cards — Full-Stack, Writing (long-form serialized fiction with one-click **Continue**), Data Insight, PPT, Web Site — plus model dropdown, Web/Think toggles, and an attach "" composer |
| **System prompts** | Reusable prompt library with a default prompt for new chats, layered under per-agent prompts |
| **Settings** | Theme (dark default / light / system), send-on-enter, thinking & web-search defaults, usage stats, danger-zone data wipe |
| **Auth** | **Iframe-proof anonymous sessions**: identity travels in the `X-Session-Token` header (localStorage-backed) with an httpOnly cookie fallback — identical visitor identity survives reloads, new tabs, and cross-site preview iframes where `SameSite=Lax` cookies are stripped. Clean upgrade path to NextAuth/OAuth |
| **Rate limiting** | Sliding-window limits per route (chat 30/min, uploads 12/min, search 20/min) with `429 + Retry-After` |
| **UX** | Dark/light themes, aurora hero, glass composer, syntax-highlighted code with copy buttons, mobile sheet sidebar, sticky status footer, full keyboard/ARIA accessibility |

---

## 🚀 Quick start

```bash
# 1. Install
bun install        # or npm install / pnpm install

# 2. Environment
cp .env.example .env
#   DATABASE_URL is preconfigured for ./db/custom.db

# 3. Database
bun run db:push    # creates tables from prisma/schema.prisma

# 4. AI credentials (server-side only — never exposed to the browser)
#    The SDK reads a .z-ai-config JSON file from the project root:
#    { "baseUrl": "https://...", "apiKey": "..." }

# 5. Run
bun run dev        # http://localhost:3000
```

`bun run lint` verifies code quality. There is no separate build step needed for local dev; for production use `bun run build && bun run start` (standalone output).

---

## 🔄 Durability — GitHub backup (survives session resets)

All code is continuously pushed to the private repo **`WasewaseX/glm-54-ai-platform`**.

```bash
# One-off setup (already configured in this workspace)
#   .env → GITHUB_BACKUP_TOKEN=<GitHub PAT>   (gitignored, never committed)

# Push any new work:
bash scripts/backup-to-github.sh "what changed"

# Restore into a fresh environment:
#   git clone https://github.com/WasewaseX/glm-54-ai-platform
#   bun install && bun run db:push && cp .env.example .env  # then fill .env
```

> **Security note:** the PAT used during initial setup was pasted into a chat in plaintext — treat it as compromised and rotate it (GitHub → Settings → Developer settings → Fine-grained tokens) once a replacement is in `.env`.

---

## 🔍 Verified capabilities (evidence-based)

Every claim below was probed against the live gateway during development (see `/api/health`, which surfaces the same manifest in-app):

| Capability | Status | Evidence |
| --- | --- | --- |
| Chat completions (OpenAI-compatible) | ✅ Verified | `POST /api/chat` round-trips; served model echoed as `glm-4-plus` |
| SSE streaming | ✅ Verified | `stream: true` → `data:` frames with `delta.content`, final frame carries `usage`, terminated by `[DONE]` |
| Usage telemetry | ✅ Verified | `prompt_tokens` / `completion_tokens` persisted per message and aggregated in `/api/stats` |
| Vision (image understanding) | ✅ Verified | `createVision` with data-URL images; served model `glm-5v-turbo` correctly described generated test images |
| Web search tool | ✅ Verified | `functions.invoke("web_search")` returns ranked results (url/name/snippet/host/date) |
| Document analysis (PDF/DOCX) | ✅ Verified | `file_url` content items accepted by the vision endpoint |
| Thinking mode | ✅ Requestable | Accepted via `thinking.enabled`; visible reasoning trace depends on the served model |
| RAG long-document handling | ✅ Implemented | Chunking + BM25 retrieval verified: facts planted in an uploaded file were retrieved and answered correctly |
| 200M-token context window | ⚠️ **Not claimed** | Not published by this gateway. We ship RAG instead and cap replayed history conservatively (40 msgs / ~30k chars) |
| 150M-token output | ⚠️ **Not claimed** | Not verifiable through this integration |

### Honest long-context strategy

Rather than claiming an unverifiable context window, GLM 5.4 AI implements scalable long-document handling:

1. **Ingest** — text files are split on paragraph/sentence boundaries (~1,200 chars, 150-char overlap) and stored as `DocumentChunk` rows.
2. **Retrieve** — per user query, chunks are scored with BM25 (IDF-weighted term matching with length normalization); the top 6 excerpts (≤12k chars) are injected as clearly-labeled context.
3. **Summarize** — on demand, long docs are summarized via map-reduce over chunks (16-chunk cap) then reduced into a brief.

The UI labels retrieved context explicitly ("Retrieved N excerpts…") so users always know when RAG is in play.

---

## 🏗 Architecture

```
src/
├── app/
│   ├── page.tsx                    # Single-page workspace (the only user-visible route)
│   ├── layout.tsx                  # Fonts, ThemeProvider (next-themes), Toaster (sonner)
│   ├── globals.css                 # Design system: tokens, aurora, glass, prose-chat, scrollbars
│   └── api/
│       ├── chat/route.ts           # POST — SSE streaming orchestrator (tools, RAG, vision, cancel)
│       ├── conversations/route.ts  # GET list (q filter) · POST create · DELETE all
│       ├── conversations/[id]/     # GET detail · PATCH (title/pin/archive/prompt) · DELETE
│       ├── conversations/[id]/export/  # GET ?format=md|json
│       ├── upload/route.ts         # POST multipart — classify, chunk, index
│       ├── documents/route.ts      # GET list
│       ├── documents/[id]/route.ts     # GET detail · POST summarize · DELETE
│       ├── documents/[id]/raw/route.ts # GET raw bytes (image preview)
│       ├── prompts/route.ts + [id]/    # System prompt library CRUD
│       ├── settings/route.ts       # GET/PUT user settings
│       ├── stats/route.ts          # Usage aggregates
│       ├── search/route.ts         # Standalone web search
│       └── health/route.ts         # Liveness + verified capability manifest
├── components/chat/                # sidebar, header, message list/item, composer, markdown,
│                                   # welcome, settings/docs/about dialogs
├── lib/
│   ├── ai.ts                       # SDK wrapper: stream parser, vision, search, error normalization
│   ├── auth.ts                     # Session cookie ↔ User row
│   ├── rate-limit.ts               # Sliding window limiter
│   ├── rag.ts                      # Chunker + BM25 retrieval
│   ├── context-builder.ts          # History windowing, budgets, message assembly
│   ├── store.ts                    # Zustand store (streaming orchestration client-side)
│   ├── api-client.ts               # Typed fetch helpers + SSE client parser
│   └── types.ts                    # Shared wire types
└── components/ui/                  # shadcn/ui (New York)
```

### Streaming protocol (`POST /api/chat` → SSE)

```
data: {"type":"meta","conversationId":…,"assistantMessageId":…}
data: {"type":"tool","tool":"web_search","status":"start"|"done", …}
data: {"type":"context","message":"Retrieved 6 excerpts…"}
data: {"type":"thinking","text":…}        # when the model emits a trace
data: {"type":"delta","text":…}
data: {"type":"title","title":"…"}        # auto-generated after first exchange
data: {"type":"done","model":…,"promptTokens":…,"completionTokens":…,"latencyMs":…,"status":"complete"|"cancelled"}
data: {"type":"error","message":"…","fatal":boolean}
```

Client disconnects are detected server-side (`request.signal`) and partial outputs are persisted with `status: "cancelled"` — nothing is lost.

### Data model (Prisma / SQLite)

`User` → `Conversation` → `Message` (roles, tokens, latency, model, status) · `SystemPrompt` · `Document` → `DocumentChunk` · `UsageEvent`. All relations cascade on delete; indexes on hot query paths (`userId+updatedAt`, `conversationId+createdAt`, `documentId`).

---

## 🔐 Security notes

- The AI gateway credentials live **only** in `.z-ai-config` (server-side). No key ever reaches the browser.
- All request bodies are validated with **Zod**; uploads are type- and size-checked (8 MB, 6 files/message) and classified before persistence.
- Session cookies are `httpOnly`, `sameSite=lax`, `secure` in production.
- Rate limits protect every expensive route; upstream errors are normalized to user-safe messages (no stack traces or config leaked).
- Ownership checks on every conversation/document/prompt access (`userId` scoping).

## 📏 Verified limits

| Limit | Value |
| --- | --- |
| Max upload size | 8 MB / file, 6 files / message |
| Replayed history | ≤ 40 messages and ≤ 30,000 chars per request |
| RAG context injection | ≤ 12,000 chars per turn |
| Rate limits | chat 30/min · upload 12/min · search 20/min · prompts 60/min |
| Conversation list | 200 most recent, searchable |

## 🧪 Manual verification checklist (performed via agent-browser)

1. Fresh session → welcome hero renders → suggestion click streams a code answer with syntax highlighting.
2. Composer: text + attachment chip → RAG excerpt note → correct fact extraction from the uploaded document.
3. Web toggle → tool chip "Searching the web…" → grounded answer with "Grounded with web search" badge.
4. Stop button mid-stream → partial answer persisted as `cancelled`; regenerate replaces it.
5. Theme toggle → light/dark both styled; no hydration warnings (Next devtools: 0 issues).
6. Mobile (390px) → sheet sidebar, responsive composer, no horizontal overflow.
7. Export endpoints return downloadable Markdown/JSON.
8. 31 rapid chat calls → 429s with `Retry-After`.

## ⚠️ Known limitations

- SQLite (single-node) — swap Prisma datasource to Postgres for horizontal scale; rate limiter is in-memory (swap for Redis).
- PDF/DOCX are analyzed by the vision model but not text-indexed for RAG (only UTF-8 text files are).
- The gateway does not expose model listings or context-window specs; the UI displays the *served* model echoed per response.
- Thinking traces render only when the upstream model emits `reasoning_content`.

## 📦 Deployment

The app targets Node ≥ 20 / Bun ≥ 1.3. Set `DATABASE_URL`, provide `.z-ai-config`, run `bun run db:push`, then `bun run build && bun run start`. Behind a proxy, ensure SSE buffering is disabled (`X-Accel-Buffering: no` is already sent).
