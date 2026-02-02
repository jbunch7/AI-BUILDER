// lib/store.ts
import type { BuilderJob } from "@/lib/jobs";
import type { ScanRecord } from "@/lib/builder/types";

const URL = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const HAS_REDIS = Boolean(URL && TOKEN);

// Dev fallback (no persistence; fine for local testing)
const mem = new Map<string, { value: string; expiresAt: number | null }>();

function assertEnv() {
  if (HAS_REDIS) return;
  if (process.env.NODE_ENV !== "production") return;
  throw new Error(
    "Missing Upstash env vars. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in production."
  );
}

async function redisPipeline(commands: unknown[]) {
  assertEnv();

  // Local dev fallback: emulate only the few commands we use.
  if (!HAS_REDIS) {
    const out: Array<{ result?: unknown; error?: string }> = [];
    for (const cmd of commands as any[]) {
      const [op, key, ...rest] = cmd;
      const now = Date.now();
      const entry = mem.get(String(key));
      const expired = entry?.expiresAt != null && entry.expiresAt <= now;
      if (expired) mem.delete(String(key));

      if (op === "GET") {
        out.push({ result: mem.get(String(key))?.value ?? null });
        continue;
      }
      if (op === "SET") {
        const value = String(rest[0] ?? "");
        // Support: SET key value EX seconds
        let expiresAt: number | null = null;
        if (rest[1] === "EX") {
          const seconds = Number(rest[2]);
          if (Number.isFinite(seconds)) expiresAt = now + seconds * 1000;
        }
        mem.set(String(key), { value, expiresAt });
        out.push({ result: "OK" });
        continue;
      }
      if (op === "DEL") {
        const existed = mem.delete(String(key));
        out.push({ result: existed ? 1 : 0 });
        continue;
      }
      out.push({ error: `Unsupported dev command: ${op}` });
    }
    return out;
  }

  const res = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(commands),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash error: ${res.status} ${text}`);
  }

  return res.json() as Promise<Array<{ result?: unknown; error?: string }>>;
}

function jobKey(id: string) {
  return `job:${id}`;
}

function scanKey(id: string) {
  return `scan:${id}`;
}

export async function setJob(job: BuilderJob, ttlSeconds = 60 * 60) {
  const key = jobKey(job.id);
  const value = JSON.stringify(job);

  await redisPipeline([["SET", key, value, "EX", String(ttlSeconds)]]);
}

export async function getJob(id: string): Promise<BuilderJob | null> {
  const key = jobKey(id);

  const out = await redisPipeline([["GET", key]]);
  const raw = out?.[0]?.result;

  if (!raw || typeof raw !== "string") return null;

  try {
    return JSON.parse(raw) as BuilderJob;
  } catch {
    return null;
  }
}

export async function deleteJob(id: string) {
  const key = jobKey(id);
  await redisPipeline([["DEL", key]]);
}

export async function setScan(scan: ScanRecord, ttlSeconds = 60 * 60 * 24) {
  const key = scanKey(scan.id);
  const value = JSON.stringify(scan);
  await redisPipeline([["SET", key, value, "EX", String(ttlSeconds)]]);
}

export async function getScan(id: string): Promise<ScanRecord | null> {
  const key = scanKey(id);
  const out = await redisPipeline([["GET", key]]);
  const raw = out?.[0]?.result;
  if (!raw || typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as ScanRecord;
  } catch {
    return null;
  }
}

export async function deleteScan(id: string) {
  const key = scanKey(id);
  await redisPipeline([["DEL", key]]);
}
