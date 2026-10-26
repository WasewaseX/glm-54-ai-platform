import "server-only";

/**
 * In-memory sliding-window rate limiter (per process).
 * Suitable for single-node deployments; swap for Redis/Upstash when scaling out.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export interface RateResult {
  ok: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRate(key: string, limit: number, windowMs: number): RateResult {
  const now = Date.now();
  sweep(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    buckets.set(key, bucket);
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, oldest + windowMs - now) };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfterMs: 0 };
}

export const RATE_LIMITS = {
  chat: { limit: 30, windowMs: 60_000 }, // 30 messages / minute
  upload: { limit: 12, windowMs: 60_000 }, // 12 uploads / minute
  search: { limit: 20, windowMs: 60_000 }, // 20 web searches / minute
  prompts: { limit: 60, windowMs: 60_000 },
  authedRead: { limit: 240, windowMs: 60_000 },
} as const;

export function rateLimitResponse(retryAfterMs: number): Response {
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded. Please slow down." }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(Math.ceil(retryAfterMs / 1000)),
      },
    }
  );
}
