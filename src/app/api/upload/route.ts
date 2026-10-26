import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { checkRate, RATE_LIMITS, rateLimitResponse } from "@/lib/rate-limit";
import { chunkText, estimateTokens } from "@/lib/rag";
import { LIMITS } from "@/lib/context-builder";
import type { DocumentItem } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "yaml", "yml", "xml", "html", "htm",
  "js", "jsx", "ts", "tsx", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp",
  "cs", "php", "sh", "bash", "zsh", "sql", "toml", "ini", "cfg", "conf", "env", "log",
  "css", "scss", "less", "vue", "svelte", "swift", "dart", "r", "lua", "pl", "tex",
]);

const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/bmp"]);
const BINARY_DOC_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

function classify(name: string, mime: string): "text" | "image" | "binary" | null {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("text/") || TEXT_EXTENSIONS.has(ext)) return "text";
  if (IMAGE_MIMES.has(mime)) return "image";
  if (BINARY_DOC_MIMES.has(mime) || mime === "application/octet-stream") return "binary";
  return null;
}

export async function POST(req: Request) {
  const user = await requireUser();
  const rate = checkRate(`upload:${user.id}`, RATE_LIMITS.upload.limit, RATE_LIMITS.upload.windowMs);
  if (!rate.ok) return rateLimitResponse(rate.retryAfterMs);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Expected multipart/form-data." }, { status: 400 });
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) return Response.json({ error: "No files provided." }, { status: 400 });
  if (files.length > LIMITS.MAX_ATTACHMENTS_PER_MESSAGE) {
    return Response.json(
      { error: `Max ${LIMITS.MAX_ATTACHMENTS_PER_MESSAGE} files per message.` },
      { status: 400 }
    );
  }

  const created: DocumentItem[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const kind = classify(file.name, file.type);
    if (!kind) {
      errors.push(`${file.name}: unsupported file type (${file.type || "unknown"})`);
      continue;
    }
    if (file.size > LIMITS.MAX_UPLOAD_BYTES) {
      errors.push(`${file.name}: exceeds ${Math.round(LIMITS.MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`);
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    if (kind === "text") {
      const text = buffer.toString("utf8").replace(/\u0000/g, "");
      if (!text.trim()) {
        errors.push(`${file.name}: file appears to be empty`);
        continue;
      }
      const chunks = chunkText(text);
      const doc = await db.document.create({
        data: {
          userId: user.id,
          name: file.name,
          mime: file.type || "text/plain",
          size: file.size,
          kind: "text",
          content: text,
          chunkCount: chunks.length,
          chunks: {
            create: chunks.map((c) => ({ idx: c.idx, text: c.text, tokens: c.tokens })),
          },
        },
      });
      created.push(toItem(doc.id, doc.name, doc.mime, doc.size, doc.kind, doc.chunkCount, doc.createdAt, text));
    } else {
      const doc = await db.document.create({
        data: {
          userId: user.id,
          name: file.name,
          mime: file.type || "application/octet-stream",
          size: file.size,
          kind,
          content: buffer.toString("base64"),
          chunkCount: 0,
        },
      });
      created.push(toItem(doc.id, doc.name, doc.mime, doc.size, doc.kind, 0, doc.createdAt, null));
    }
  }

  if (created.length === 0 && errors.length > 0) {
    return Response.json({ error: errors.join("; ") }, { status: 415 });
  }

  return Response.json({ documents: created, errors }, { status: 201 });
}

function toItem(
  id: string,
  name: string,
  mime: string,
  size: number,
  kind: string,
  chunkCount: number,
  createdAt: Date,
  content: string | null
): DocumentItem {
  return {
    id,
    name,
    mime,
    size,
    kind: kind as DocumentItem["kind"],
    chunkCount,
    hasSummary: false,
    createdAt: createdAt.toISOString(),
    excerpt: content ? content.slice(0, 220) : undefined,
  };
}
