// lib/usage.ts
import crypto from "crypto";

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function assertEnv() {
  if (!URL || !TOKEN) {
    throw new Error(
      "Missing Upstash env vars. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel."
    );
  }
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

export const USAGE_LIMIT = 3;
export const USAGE_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export function emailToUserId(email: string) {
  const norm = email.trim().toLowerCase();
  return crypto.createHash("sha256").update(norm).digest("hex");
}

export function usageKey(userId: string) {
  return `usage:${userId}`;
}

/** Ensure a usage counter exists (0) with TTL; does not overwrite existing. */
export async function ensureUsageUser(userId: string) {
  const key = usageKey(userId);
  // SET key 0 NX EX <ttl>
  await redisCommand(["SET", key, "0", "NX", "EX", String(USAGE_TTL_SECONDS)]);
}

export async function getUsageCount(userId: string): Promise<number> {
  const key = usageKey(userId);
  const raw = await redisCommand<string | null>(["GET", key]);
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Atomically increment usage; returns the new count. */
export async function incrementUsage(userId: string): Promise<number> {
  const key = usageKey(userId);
  const n = await redisCommand<number>(["INCR", key]);
  // best-effort: keep TTL alive
  if (n === 1) {
    await redisCommand<number>(["EXPIRE", key, USAGE_TTL_SECONDS]);
  }
  return n;
}
