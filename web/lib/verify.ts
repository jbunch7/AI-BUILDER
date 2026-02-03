import { randomUUID } from "crypto";

// Stores pending lead payloads, verified flags, profiles, and hardlock keys in Upstash Redis.

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

const HARDLOCK_FOREVER = (process.env.HARDLOCK_FOREVER || "").toLowerCase() === "true";

// If HARDLOCK_FOREVER=true we avoid TTL-based forgetting for verified/profile/hardlock keys.
// Pending tokens should still expire.
export const VERIFIED_TTL_SECONDS = HARDLOCK_FOREVER ? null : 60 * 60 * 24 * 30; // 30 days
export const PROFILE_TTL_SECONDS = HARDLOCK_FOREVER ? null : 60 * 60 * 24 * 30; // 30 days
export const PENDING_TTL_SECONDS = 60 * 30; // 30 minutes

export type PendingLead = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  deviceId?: string; // client-provided stable id (localStorage) for hardlock
};

export type VerifiedProfile = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  verifiedAt: number;
  deviceId?: string;
};

export function newVerifyToken() {
  return randomUUID();
}

export function pendingKey(token: string) {
  return `pending:${token}`;
}

export function pendingEmailKey(emailLower: string) {
  return `pending_email:${emailLower}`;
}

export function verifiedKey(userId: string) {
  return `verified:${userId}`;
}

export function profileKey(userId: string) {
  return `profile:${userId}`;
}

// Hardlock keys (no TTL when enabled)
export function hardlockDeviceKey(deviceId: string) {
  return `hardlock:device:${deviceId}`;
}

export function hardlockPhoneKey(phoneNorm: string) {
  return `hardlock:phone:${phoneNorm}`;
}

function normEmail(email: string) {
  return (email || "").trim().toLowerCase();
}

export function normPhone(phone: string) {
  return (phone || "").replace(/[^0-9+]/g, "");
}

export async function savePendingLead(token: string, lead: PendingLead) {
  const emailLower = normEmail(lead.email);
  const payload = JSON.stringify(lead);

  // Store by token (one-time link)
  await redisCommand([
    "SET",
    pendingKey(token),
    payload,
    "EX",
    String(PENDING_TTL_SECONDS),
  ]);

  // Also store by email for resend support
  await redisCommand([
    "SET",
    pendingEmailKey(emailLower),
    JSON.stringify({ token, lead }),
    "EX",
    String(PENDING_TTL_SECONDS),
  ]);
}

export async function getPendingByEmail(email: string): Promise<{ token: string; lead: PendingLead } | null> {
  const emailLower = normEmail(email);
  const raw = await redisCommand<string | null>(["GET", pendingEmailKey(emailLower)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { token: string; lead: PendingLead };
  } catch {
    return null;
  }
}

/**
 * Fetch pending lead + delete the token (one-time use).
 */
export async function consumePendingLead(token: string): Promise<PendingLead | null> {
  const raw = await redisCommand<string | null>(["GET", pendingKey(token)]);
  if (!raw) return null;

  await redisCommand<number>(["DEL", pendingKey(token)]);

  // Best effort delete the email mapping as well
  try {
    const lead = JSON.parse(raw) as PendingLead;
    const emailLower = normEmail(lead.email);
    await redisCommand<number>(["DEL", pendingEmailKey(emailLower)]);
    return lead;
  } catch {
    return JSON.parse(raw) as PendingLead;
  }
}

export async function markVerified(userId: string) {
  if (VERIFIED_TTL_SECONDS === null) {
    await redisCommand(["SET", verifiedKey(userId), "1"]);
    return;
  }
  await redisCommand([
    "SET",
    verifiedKey(userId),
    "1",
    "EX",
    String(VERIFIED_TTL_SECONDS),
  ]);
}

export async function isVerified(userId: string): Promise<boolean> {
  const raw = await redisCommand<string | null>(["GET", verifiedKey(userId)]);
  return raw === "1";
}

export async function saveProfile(userId: string, profile: VerifiedProfile) {
  const payload = JSON.stringify(profile);
  if (PROFILE_TTL_SECONDS === null) {
    await redisCommand(["SET", profileKey(userId), payload]);
    return;
  }
  await redisCommand(["SET", profileKey(userId), payload, "EX", String(PROFILE_TTL_SECONDS)]);
}

export async function getProfile(userId: string): Promise<VerifiedProfile | null> {
  const raw = await redisCommand<string | null>(["GET", profileKey(userId)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as VerifiedProfile;
  } catch {
    return null;
  }
}

// Hardlock helpers
export async function getHardlockedUserByDevice(deviceId: string): Promise<string | null> {
  const raw = await redisCommand<string | null>(["GET", hardlockDeviceKey(deviceId)]);
  return raw || null;
}

export async function setHardlockForDevice(deviceId: string, userId: string) {
  await redisCommand(["SET", hardlockDeviceKey(deviceId), userId]);
}

export async function getHardlockedUserByPhone(phoneNorm: string): Promise<string | null> {
  const raw = await redisCommand<string | null>(["GET", hardlockPhoneKey(phoneNorm)]);
  return raw || null;
}

export async function setHardlockForPhone(phoneNorm: string, userId: string) {
  await redisCommand(["SET", hardlockPhoneKey(phoneNorm), userId]);
}
