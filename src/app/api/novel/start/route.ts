import "server-only";
import { spawn } from "node:child_process";
import { loadState, BOOKS } from "@/lib/novel-engine";
import { existsSync, readFileSync, writeFileSync, openSync } from "node:fs";
import { join } from "node:path";

export const dynamic = "force-dynamic";

const BOOK_ID = "the-dreaming-vat";

function isRunnerAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function POST() {
  const def = BOOKS[BOOK_ID];
  if (!def) return Response.json({ error: "unknown book" }, { status: 404 });

  const pidPath = join("/tmp", `novel-${BOOK_ID}.pid`);
  const state = loadState(BOOK_ID);

  if (state?.phase === "done") {
    return Response.json({ ok: true, message: "Book already complete." });
  }

  // Prevent duplicate runners.
  if (existsSync(pidPath)) {
    try {
      const pid = Number(readFileSync(pidPath, "utf8").trim());
      if (isRunnerAlive(pid)) {
        return Response.json({ ok: true, message: `Runner already active (pid ${pid}).` });
      }
    } catch {
      /* stale pid file — fall through and start */
    }
  }

  const logPath = join("/tmp", "novel-run.log");
  const out = openSync(logPath, "a");
  const child = spawn("bun", ["scripts/run-novel.ts", BOOK_ID], {
    cwd: process.cwd(),
    stdio: ["ignore", out, out],
    detached: true,
    env: process.env,
  });
  child.unref();
  writeFileSync(pidPath, String(child.pid));

  return Response.json({ ok: true, message: `Book Forge started (pid ${child.pid}).` });
}
