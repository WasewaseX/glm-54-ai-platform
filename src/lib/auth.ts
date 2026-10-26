import "server-only";
import { cookies, headers } from "next/headers";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import type { User } from "@prisma/client";
import type { UserSettings } from "@/lib/types";

/**
 * Anonymous-first session auth (iframe-proof):
 *
 * Identity is resolved from, in order:
 *   1. `x-session-token` request header   — sent by our own client from
 *      localStorage. This is the PRIMARY channel because the app is commonly
 *      rendered inside a cross-site preview iframe where SameSite=Lax cookies
 *      are stripped from fetch() requests (which used to spawn a fresh
 *      anonymous user on every call → "Conversation not found").
 *   2. `glm54_session` httpOnly cookie    — fallback for top-level navigations
 *      (export downloads, direct curl use).
 *   3. A fresh token is generated server-side and echoed back via the
 *      `x-session-token` response header (self-healing for non-UI clients).
 *
 * Upgrade path to NextAuth/OAuth: replace requireUser() with a provider
 * lookup; every table already references User.id.
 */

const COOKIE_NAME = "glm54_session";
export const SESSION_HEADER = "x-session-token";
const ONE_YEAR = 60 * 60 * 24 * 365;
const TOKEN_RE = /^[a-f0-9]{32,128}$/i;

export const DEFAULT_SETTINGS: Required<UserSettings> = {
  theme: "system",
  sendOnEnter: true,
  thinkingDefault: false,
  webSearchDefault: false,
  defaultSystemPromptId: null,
};

function randomToken(): string {
  return randomBytes(24).toString("hex");
}

async function resolveIncomingToken(): Promise<string | null> {
  const h = await headers();
  const fromHeader = h.get(SESSION_HEADER);
  if (fromHeader && TOKEN_RE.test(fromHeader)) return fromHeader;

  const store = await cookies();
  const fromCookie = store.get(COOKIE_NAME)?.value;
  if (fromCookie && TOKEN_RE.test(fromCookie)) return fromCookie;

  return null;
}

export async function requireUser(): Promise<User> {
  const incoming = await resolveIncomingToken();

  if (incoming) {
    const existing = await db.user.findUnique({ where: { sessionToken: incoming } });
    if (existing) return existing;
  }

  const token = incoming ?? randomToken();
  let user: User;
  try {
    user = await db.user.create({
      data: {
        sessionToken: token,
        settings: JSON.stringify(DEFAULT_SETTINGS),
      },
    });
  } catch {
    // Unique-violation race: a concurrent request registered this token first.
    const existing = await db.user.findUnique({ where: { sessionToken: token } });
    if (!existing) throw new Error("session_init_failed");
    user = existing;
  }

  // Best-effort cookie mirror so top-level navigations (export downloads,
  // curl, new tabs) resolve the same identity without the custom header.
  try {
    const store = await cookies();
    store.set(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: ONE_YEAR,
      path: "/",
    });
  } catch {
    /* cookies() writes are unsupported in some render contexts — header wins anyway */
  }

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
