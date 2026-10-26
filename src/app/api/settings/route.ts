import "server-only";
import { requireUser, parseSettings, DEFAULT_SETTINGS } from "@/lib/auth";
import { db } from "@/lib/db";
import type { UserSettings } from "@/lib/types";
import { z } from "zod";

export const dynamic = "force-dynamic";

const SettingsSchema = z.object({
  theme: z.enum(["dark", "light", "system"]).optional(),
  sendOnEnter: z.boolean().optional(),
  thinkingDefault: z.boolean().optional(),
  webSearchDefault: z.boolean().optional(),
  defaultSystemPromptId: z.string().nullable().optional(),
});

export async function GET() {
  const user = await requireUser();
  return Response.json({ settings: parseSettings(user) });
}

export async function PUT(req: Request) {
  const user = await requireUser();

  let patch: z.infer<typeof SettingsSchema>;
  try {
    patch = SettingsSchema.parse(await req.json());
  } catch {
    return Response.json({ error: "Invalid settings payload." }, { status: 400 });
  }

  const merged: Required<UserSettings> = { ...parseSettings(user), ...patch };
  await db.user.update({
    where: { id: user.id },
    data: { settings: JSON.stringify(merged) },
  });

  return Response.json({ settings: merged });
}

export { DEFAULT_SETTINGS };
