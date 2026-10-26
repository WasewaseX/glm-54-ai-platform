import "server-only";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Export a conversation as Markdown or JSON. GET /api/conversations/:id/export?format=md|json */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;

  const conversation = await db.conversation.findFirst({
    where: { id, userId: user.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) return Response.json({ error: "Conversation not found." }, { status: 404 });

  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
  const slug =
    conversation.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "conversation";

  if (format === "json") {
    const payload = {
      product: "GLM 5.4 AI",
      conversation: {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        systemPrompt: conversation.systemPrompt,
      },
      messages: conversation.messages.map((m) => ({
        role: m.role,
        content: m.content,
        model: m.model,
        status: m.status,
        promptTokens: m.promptTokens,
        completionTokens: m.completionTokens,
        latencyMs: m.latencyMs,
        createdAt: m.createdAt,
      })),
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${slug}.json"`,
      },
    });
  }

  const lines: string[] = [
    `# ${conversation.title}`,
    "",
    `> Exported from GLM 5.4 AI · ${new Date().toISOString()}`,
    conversation.systemPrompt ? `> System prompt: ${conversation.systemPrompt}` : "",
    "",
  ];
  for (const m of conversation.messages) {
    const when = m.createdAt.toISOString().replace("T", " ").slice(0, 19);
    lines.push(`## ${m.role === "user" ? "User" : "GLM 5.4 AI"} · ${when}`);
    if (m.model) lines.push(`*model: ${m.model} · ${m.completionTokens ?? "?"} out tokens · ${m.latencyMs ?? "?"} ms*`);
    lines.push("", m.content || "*(no content)*", "");
  }

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.md"`,
    },
  });
}
