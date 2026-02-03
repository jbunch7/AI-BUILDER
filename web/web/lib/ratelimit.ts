// lib/ratelimit.ts
const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_REDIS = Boolean(URL && TOKEN);

function assertEnv() {
  if (HAS_REDIS) return;
  if (process.env.NODE_ENV !== "production") return;
  throw new Error(
    "Missing Upstash env vars. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in production."
  );
}

async function redisCommand<T = any>(command: unknown[]): Promise<T> {
  assertEnv();
  const res = await fetch(`${URL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash error: ${res.status} ${text}`);
  }
  const data = (await res.json()) as { result: T };
  return data.result;
}

/**
 * Simple fixed-window rate limiter using INCR + EXPIRE.
 * - key should include IP (and optionally route)
 * - If count == 1, set expiry for windowSeconds
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  // In development (or when Redis isn't configured), we skip rate limiting.
  if (!HAS_REDIS) {
    return { allowed: true, remaining: limit };
  }
  const count = await redisCommand<number>(["INCR", key]);
  if (count === 1) {
    // Best-effort: set TTL for the window
    await redisCommand<number>(["EXPIRE", key, windowSeconds]);
  }
  const remaining = Math.max(0, limit - count);
  return { allowed: count <= limit, remaining };
}
