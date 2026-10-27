/**
 * code-exec — sandboxed code runner for the agent's `run_code` tool.
 *
 * POST /run { code, language?: "typescript"|"javascript", tests?, stdin?, timeoutMs? }
 *   -> { exitCode, stdout, stderr, timedOut, durationMs, files, ranTests }
 *
 * Isolation model (documented, pragmatic):
 * - Fresh temp dir per run, deleted afterwards
 * - `ulimit -v` (2 GB address space) + `ulimit -t` (CPU seconds) via bash wrapper
 * - Hard wall-clock timeout, process kill
 * - No network isolation is NOT guaranteed; treat as untrusted-node execution
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const PORT = 3010;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_CHARS = 64_000;

interface RunBody {
  code: string;
  language?: "typescript" | "javascript";
  tests?: string;
  stdin?: string;
  timeoutMs?: number;
}

function clip(s: string): string {
  return s.length > MAX_OUTPUT_CHARS
    ? s.slice(0, MAX_OUTPUT_CHARS) + `\n…[truncated ${s.length - MAX_OUTPUT_CHARS} chars]`
    : s;
}

console.log(`[code-exec] listening on :${PORT}`);
Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "code-exec", port: PORT });
    }

    if (req.method === "POST" && url.pathname === "/run") {
      let body: RunBody;
      try {
        body = (await req.json()) as RunBody;
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }

      if (!body.code || typeof body.code !== "string") {
        return Response.json({ error: "field `code` is required" }, { status: 400 });
      }
      const language = body.language === "javascript" ? "javascript" : "typescript";
      const ext = language === "javascript" ? "js" : "ts";
      const timeoutMs = Math.min(Math.max(body.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1000), MAX_TIMEOUT_MS);

      const dir = join("/tmp", `codeexec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
      mkdirSync(dir, { recursive: true });
      const files: string[] = [];

      try {
        const entry = `main.${ext}`;
        writeFileSync(join(dir, entry), body.code);
        files.push(entry);

        let ranTests = false;
        let cmd = `exec bun run ${entry}`;
        if (body.tests && typeof body.tests === "string") {
          writeFileSync(join(dir, `main.test.${ext}`), body.tests);
          files.push(`main.test.${ext}`);
          cmd = "exec bun test";
          ranTests = true;
        }

        // ulimit wrapper: 2 GB address space, 10 CPU seconds.
        const wrapped = `ulimit -v 2097152 2>/dev/null; ulimit -t 10 2>/dev/null; ${cmd}`;

        const started = Date.now();
        const proc = Bun.spawn(["bash", "-c", wrapped], {
          cwd: dir,
          stdin: body.stdin ? new Response(body.stdin).body : undefined,
          stdout: "pipe",
          stderr: "pipe",
        });

        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill(9);
          } catch {
            /* noop */
          }
        }, timeoutMs);

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;
        clearTimeout(timer);

        return Response.json({
          exitCode,
          stdout: clip(stdout),
          stderr: clip(stderr),
          timedOut,
          durationMs: Date.now() - started,
          files,
          ranTests,
        });
      } catch (err) {
        return Response.json(
          { error: err instanceof Error ? err.message : String(err), files },
          { status: 500 }
        );
      } finally {
        try {
          rmSync(dir, { recursive: true, force: true });
        } catch {
          /* noop */
        }
      }
    }

    return new Response("Not found", { status: 404 });
  },
});
