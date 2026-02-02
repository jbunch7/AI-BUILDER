// lib/security.ts
import { NextResponse } from "next/server";

/**
 * Comma-separated hostnames (NO paths) allowed to call the API.
 * Example:
 *   ALLOWED_EMBED_HOSTS="krakenfinishes.com,www.krakenfinishes.com,visualizer.krakenfinishes.com"
 */
export function getAllowedHosts(): Set<string> {
  const raw = process.env.ALLOWED_EMBED_HOSTS || "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  // If not set, fail closed by default (security).
  return new Set(list);
}

function hostnameFromOrigin(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Enforce that requests come from an allowed Origin/Host.
 * - Origin never includes path, only scheme + host (+ port).
 * - If Origin is missing, we fall back to Host header.
 */
export function enforceAllowedOrigin(req: Request): { ok: true } | { ok: false; reason: string } {
  const allowed = getAllowedHosts();
  const allowlistWasEmpty = allowed.size === 0;

  // Developer quality-of-life: allow localhost in non-production.
  if (process.env.NODE_ENV !== "production") {
    allowed.add("localhost");
    allowed.add("127.0.0.1");
  }

  // If allowlist is empty, fail open in development (so local dev works),
  // but fail closed in production.
  if (allowlistWasEmpty) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, reason: "Forbidden: ALLOWED_EMBED_HOSTS not configured" };
  }

  const origin = req.headers.get("origin");
  if (origin) {
    const host = hostnameFromOrigin(origin);
    if (!host || !allowed.has(host)) {
      return { ok: false, reason: `Forbidden origin: ${origin}` };
    }
    return { ok: true };
  }

  const hostHeader = (req.headers.get("host") || "").split(":")[0].toLowerCase();
  if (hostHeader && allowed.has(hostHeader)) {
    return { ok: true };
  }

  return { ok: false, reason: "Forbidden: missing/invalid origin/host" };
}

export function withCors(req: Request, res: NextResponse) {
  const origin = req.headers.get("origin");
  if (origin) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Worker-Secret"
  );
  return res;
}

export function getClientIp(req: Request) {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const xrip = req.headers.get("x-real-ip");
  if (xrip) return xrip.trim();
  const cfcip = req.headers.get("cf-connecting-ip");
  if (cfcip) return cfcip.trim();
  return "unknown";
}
