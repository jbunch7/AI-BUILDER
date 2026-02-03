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

  // Developer quality-of-life: allow localhost in non-production.
  if (process.env.NODE_ENV !== "production") {
    allowed.add("localhost");
    allowed.add("127.0.0.1");
  }

  // Vercel quality-of-life:
  // - VERCEL_URL is set by Vercel for Preview + Production deployments.
  // - This lets each deployment URL call the API without manually updating ALLOWED_EMBED_HOSTS.
  //   (Still keeps your allowlist model for custom domains.)
  const vercelUrl = (process.env.VERCEL_URL || "").toLowerCase().trim();
  if (vercelUrl) {
    // VERCEL_URL is host-only (no scheme). Example: "ai-builder-6epz.vercel.app"
    allowed.add(vercelUrl.split(":")[0]);
  }

  // Recompute after adding localhost / VERCEL_URL.
  const allowlistIsEmpty = allowed.size === 0;

  // If allowlist is empty, fail open in development (so local dev works),
  // but fail closed in production.
  if (allowlistIsEmpty) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return { ok: false, reason: "Forbidden: ALLOWED_EMBED_HOSTS not configured" };
  }

  const origin = req.headers.get("origin");
  if (origin) {
    const host = hostnameFromOrigin(origin);
    // Optional: allow any *.vercel.app origin if explicitly enabled.
    // This is helpful for rapid preview iteration. Keep it OFF for stricter security.
    const allowAnyVercelApp = (process.env.ALLOW_VERCEL_APP || "").toLowerCase() === "true";

    const isAllowed = !!host && (allowed.has(host) || (allowAnyVercelApp && host.endsWith(".vercel.app")));
    if (!isAllowed) {
      return { ok: false, reason: `Forbidden origin: ${origin}` };
    }
    return { ok: true };
  }

  // Some same-origin GETs may omit the Origin header.
  // On Vercel, prefer forwarded host when available.
  const hostHeaderRaw =
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  const hostHeader = hostHeaderRaw.split(":")[0].toLowerCase();

  // Always allow same-deployment host (especially for client polling like /api/job).
  if (hostHeader && vercelUrl && hostHeader === vercelUrl.split(":")[0]) {
    return { ok: true };
  }

  const allowAnyVercelApp = (process.env.ALLOW_VERCEL_APP || "").toLowerCase() === "true";
  if (hostHeader && (allowed.has(hostHeader) || (allowAnyVercelApp && hostHeader.endsWith(".vercel.app")))) {
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
