import "server-only";
import { getBookDef, loadState } from "@/lib/novel-engine";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const ROOT = "/home/z/my-project";

/**
 * POST /api/novel/extend {"bookId": "...", "target": 2200}
 * Spawns the chapter extender detached from the persistent dev server process
 * (shell-spawned children get reaped; server-spawned ones survive).
 */
export async function POST(req: Request) {
  let body: { bookId?: unknown; target?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* fall through */
  }
  const bookId = typeof body.bookId === "string" ? body.bookId.trim() : "";
  const target = typeof body.target === "number" ? Math.round(body.target) : 2_200;

  if (!bookId || !getBookDef(bookId)) {
    return Response.json({ ok: false, error: "unknown bookId" }, { status: 400 });
  }
  const state = loadState(bookId);
  if (!state || state.phase !== "done") {
    return Response.json(
      { ok: false, error: "extender only runs on completed books (phase=done)" },
      { status: 400 }
    );
  }

  const logPath = join("/tmp", `extend-${bookId}.log`);
  const out = openSync(logPath, "a");
  const child = spawn(
    "bun",
    ["scripts/extend-chapters.ts", bookId, String(target)],
    { cwd: ROOT, stdio: ["ignore", out, out], detached: true, env: process.env }
  );
  child.unref();

  return Response.json({ ok: true, pid: child.pid, log: logPath });
}
