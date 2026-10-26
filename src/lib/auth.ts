import "server-only";
import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";
import type { UserSettings } from "@/lib/types";

/**
 * Anonymous-first session auth:
 * - A cryptographically random session token is stored in an httpOnly cookie
 *   and mapped to a User row (persistent identity across visits).
 * - Upgrade path to NextAuth/OAuth: replace requireUser() with a provider
 *   lookup; every table already references User.id.
 */

const COOKIE_NAME = "glm54_session";
const ONE_YEAR = 60 * 60 * 24 * 365;

export const DEFAULT_SETTINGS: Required<UserSettings> = {
  theme: "system",
  sendOnEnter: true,
  thinkingDefault: false,
  webSearchDefault: false,
  defaultSystemPromptId: null,
};

export async function requireUser(): Promise<User> {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;

  if (token) {
    const existing = await db.user.findUnique({ where: { sessionToken: token } });
    if (existing) return existing;
  }

  const newToken = randomBytes(24).toString("hex");
  const user = await db.user.create({
    data: {
      sessionToken: newToken,
      settings: JSON.stringify(DEFAULT_SETTINGS),
    },
  });

  store.set(COOKIE_NAME, newToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ONE_YEAR,
    path: "/",
  });

  return user;
}

export function parseSettings(user: User): Required<UserSettings> {
  try {
    if (!user.settings) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(user.settings) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
