import crypto from "crypto";

// Minimal Redis helper (Upstash REST)
async function redisCommand<T = any>(command: unknown[]): Promise<T> {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error("Missing Upstash env vars");

  const res = await fetch(`${url}/pipeline`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify([command]),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Upstash error (${res.status})`);
  const data = (await res.json()) as any[];
  return data?.[0]?.result as T;
}

export type GenRecord = {
  id: string;
  before: string; // data url or http url
  after: string;  // data url or http url
  prompt?: string;
  createdAt: number;
  beforeSig?: string; // stable signature for dedupe
};

function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function signatureForBefore(before: string) {
  // Dedupe based on the *string* contents. For data URLs this effectively includes the image bytes.
  // This avoids hashing large buffers on the server; still stable for identical images.
  return sha1(before);
}

function genKey(uid: string, id: string) {
  return `gen:${uid}:${id}`;
}

function genIndexKey(uid: string) {
  return `genindex:${uid}`;
}

function hardlockForever() {
  return (process.env.HARDLOCK_FOREVER || "").toLowerCase() === "true";
}

export async function storeGen(uid: string, rec: Omit<GenRecord, "createdAt" | "beforeSig">) {
  const record: GenRecord = {
    ...rec,
    createdAt: Date.now(),
    beforeSig: rec.before ? signatureForBefore(rec.before) : undefined,
  };

  const key = genKey(uid, rec.id);
  const idxKey = genIndexKey(uid);
  const value = JSON.stringify(record);

  // Store record
  if (hardlockForever()) {
    await redisCommand(["SET", key, value]);
  } else {
    // Keep for 30 days
    await redisCommand(["SET", key, value, "EX", 60 * 60 * 24 * 30]);
  }

  // Track ids list (small). We cap at last 30 items.
  const idsJson = (await redisCommand<string | null>(["GET", idxKey])) || "[]";
  let ids: string[] = [];
  try {
    ids = JSON.parse(idsJson) as string[];
  } catch {
    ids = [];
  }
  if (!ids.includes(rec.id)) ids.push(rec.id);
  if (ids.length > 30) ids = ids.slice(ids.length - 30);

  const newIdsJson = JSON.stringify(ids);
  if (hardlockForever()) {
    await redisCommand(["SET", idxKey, newIdsJson]);
  } else {
    await redisCommand(["SET", idxKey, newIdsJson, "EX", 60 * 60 * 24 * 30]);
  }

  return record;
}

export async function getGen(uid: string, id: string): Promise<GenRecord | null> {
  const raw = await redisCommand<string | null>(["GET", genKey(uid, id)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GenRecord;
  } catch {
    return null;
  }
}

export async function getGens(uid: string, ids: string[]): Promise<GenRecord[]> {
  const out: GenRecord[] = [];
  for (const id of ids) {
    const rec = await getGen(uid, id);
    if (rec) out.push(rec);
  }
  return out;
}
