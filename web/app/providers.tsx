"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuilderModule, SceneGraph } from "@/lib/builder/types";

type Extras = Record<string, boolean>;

type OverlayAssets = Record<string, Record<string, string>>; // featureId -> optionId -> dataUrl

export type WizardSession = {
  sessionId: string;
  beforeSrc: string | null;
  /** Baseline image generated from the user's initial prompt ("prompted image") */
  promptedSrc: string | null;
  scanId: string | null;
  sceneGraph: SceneGraph | null;
  modules: BuilderModule[];
  selections: Record<string, string>;
  /** Optional per-element mask overrides (PNG data URLs) produced by user edits */
  maskOverrides: Record<string, string>;
  userPrompt: string;
  extras: Extras;
  scanStatus: "idle" | "scanning" | "ready" | "error";
  scanError?: string;

  /** Precomputed overlay PNGs so the build screen can swap options instantly (70% preview). */
  overlayAssets: OverlayAssets;
  overlayStatus: "idle" | "building" | "ready" | "error";
  overlayProgress: number; // 0..1
  overlayError?: string;
};

const STORAGE_KEY = "kv_builder_wizard_v1";

const defaultSession = (): WizardSession => ({
  sessionId: (globalThis.crypto?.randomUUID?.() ?? String(Date.now())) as string,
  beforeSrc: null,
  promptedSrc: null,
  scanId: null,
  sceneGraph: null,
  modules: [],
  selections: {},
  maskOverrides: {},
  userPrompt: "",
  extras: {},
  scanStatus: "idle",

  overlayAssets: {},
  overlayStatus: "idle",
  overlayProgress: 0,
});

type Ctx = {
  s: WizardSession;
  resetAll: () => void;
  setBeforeSrc: (src: string | null) => void;
  setPromptedSrc: (src: string | null) => void;
  startScan: (file: File) => Promise<void>;
  setUserPrompt: (v: string) => void;
  setExtras: (next: Extras) => void;
  setSelections: (next: Record<string, string>) => void;
  setMaskOverrides: (next: Record<string, string>) => void;
  /** Rebuild overlay assets (all modules or a single feature) after a mask correction. */
  rebuildOverlays: (featureId?: string) => Promise<void>;
  /** Navigate with a global 3s transition screen (and optional async work before navigation). */
  go: (to: string, opts?: { message?: string; submessage?: string; minMs?: number; before?: () => Promise<void> | void }) => Promise<void>;
};

const WizardContext = createContext<Ctx | null>(null);

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function toPersistedSession(s: WizardSession) {
  // Avoid saving giant base64 blobs (images + overlays) into localStorage.
  // We keep the wizard stable within a single navigation session via React state.
  const { beforeSrc: _b, promptedSrc: _p, overlayAssets: _o, maskOverrides: _m, ...rest } = s;
  return rest;
}

async function buildOverlayAssetsClient(args: {
  baseSrc: string;
  scene: SceneGraph;
  modules: BuilderModule[];
  maskOverrides?: Record<string, string>;
  maxSide?: number;
  onProgress?: (p: number) => void;
}): Promise<OverlayAssets> {
  const { baseSrc, scene, modules, maskOverrides, maxSide = 1200, onProgress } = args;

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("Failed to load base image for overlays"));
    im.src = baseSrc;
  });

  const naturalW = img.naturalWidth || 1024;
  const naturalH = img.naturalHeight || 1024;
  const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  const w = Math.max(8, Math.round(naturalW * scale));
  const h = Math.max(8, Math.round(naturalH * scale));

  // Count total overlays to generate for progress.
  const overlayModules = modules.filter((m) => m.previewMode === "overlay");
  const total = overlayModules.reduce((acc, m) => acc + (m.options?.length || 0), 0);
  let done = 0;

  const texCache = new Map<string, HTMLImageElement>();
  const getTexture = async (src: string) => {
    const cached = texCache.get(src);
    if (cached && cached.complete) return cached;
    if (cached) return cached;
    const t = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`Failed to load texture: ${src}`));
      im.src = src;
    });
    texCache.set(src, t);
    return t;
  };

  const assets: OverlayAssets = {};

  const loadImg = async (src: string) => {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error(`Failed to load image: ${src.substring(0, 32)}...`));
      im.src = src;
    });
  };

  // Helper: build a single combined mask canvas for a module's target element types.
  const buildMaskCanvas = async (m: BuilderModule) => {
    // If the user has corrected this surface mask, prefer it.
    const override = maskOverrides?.[m.featureId];
    if (override) {
      const mask = document.createElement("canvas");
      mask.width = w;
      mask.height = h;
      const mctx = mask.getContext("2d");
      if (!mctx) return null;
      mctx.clearRect(0, 0, w, h);
      const ov = await loadImg(override);
      mctx.drawImage(ov, 0, 0, w, h);
      return mask;
    }

    const targets = new Set(m.targetElementTypes);
    const elems = (scene.elements || []).filter((e) => targets.has(e.type));
    if (elems.length === 0) return null;

    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d");
    if (!mctx) return null;
    mctx.clearRect(0, 0, w, h);
    mctx.fillStyle = "white";
    for (const el of elems) {
      const pts = el?.mask?.points_norm;
      if (!Array.isArray(pts) || pts.length < 3) continue;
      mctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = p[0] * w;
        const y = p[1] * h;
        if (i === 0) mctx.moveTo(x, y);
        else mctx.lineTo(x, y);
      }
      mctx.closePath();
      mctx.fill();
    }
    return mask;
  };

  // Yield helper to keep UI responsive.
  const yieldToBrowser = async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  };

  for (const m of overlayModules) {
    const maskCanvas = await buildMaskCanvas(m);
    if (!maskCanvas) {
      // Still advance progress for this module's options so UI doesn't stall at 0%.
      done += m.options?.length || 0;
      onProgress?.(total ? done / total : 1);
      continue;
    }

    const outByOpt: Record<string, string> = {};

    const alpha = m.featureId === "flooring" ? 0.72 : 0.58;

    for (const opt of m.options || []) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) continue;

      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = alpha;
      // NOTE: We intentionally pre-bake the overlay as a normal alpha PNG.
      // The underlying base image provides the lighting/shadows. This is our "70%" preview.
      if (opt.preview?.kind === "color") {
        ctx.fillStyle = opt.preview.hex;
        ctx.fillRect(0, 0, w, h);
      } else if (opt.preview?.kind === "image") {
        const t = await getTexture(opt.preview.src);
        const pat = ctx.createPattern(t, "repeat");
        if (pat) {
          ctx.fillStyle = pat;
          ctx.fillRect(0, 0, w, h);
        }
      } else {
        // No preview; skip
      }

      // Mask
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "destination-in";
      ctx.drawImage(maskCanvas, 0, 0);

      ctx.globalCompositeOperation = "source-over";

      // Prefer WebP for smaller in-memory footprint when available.
      let dataUrl: string;
      try {
        dataUrl = c.toDataURL("image/webp", 0.86);
        if (!dataUrl.startsWith("data:image/webp")) throw new Error("webp not supported");
      } catch {
        dataUrl = c.toDataURL("image/png");
      }

      outByOpt[opt.id] = dataUrl;

      done += 1;
      onProgress?.(total ? done / total : 1);
      // Yield occasionally (every ~4 overlays) to keep the UI responsive.
      if (done % 4 === 0) await yieldToBrowser();
    }

    assets[m.featureId] = outByOpt;
  }

  onProgress?.(1);
  return assets;
}

type TransitionState = {
  message: string;
  submessage?: string;
};

function TransitionOverlay({ state }: { state: TransitionState | null }) {
  useEffect(() => {
    if (!state) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [state]);

  if (!state) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        background:
          "radial-gradient(900px 500px at 30% 20%, rgba(212,175,55,0.14), transparent 60%), radial-gradient(700px 420px at 70% 60%, rgba(255,255,255,0.10), transparent 55%), rgba(0,0,0,0.82)",
        backdropFilter: "blur(10px)",
      }}
      aria-live="polite"
    >
      <div
        className="kv-card kv-surface kv-app-card"
        style={{
          width: "min(760px, calc(100vw - 32px))",
          padding: 22,
          borderRadius: 20,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div
            style={{
              height: 44,
              width: 44,
              borderRadius: 999,
              border: "1px solid rgba(255,255,255,0.18)",
              position: "relative",
              overflow: "hidden",
              background: "rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                position: "absolute",
                inset: -6,
                borderRadius: 999,
                background:
                  "conic-gradient(from 90deg, rgba(212,175,55,0.0), rgba(212,175,55,0.85), rgba(255,255,255,0.0))",
                animation: "kvSpin 1.1s linear infinite",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 6,
                borderRadius: 999,
                background: "rgba(0,0,0,0.55)",
                border: "1px solid rgba(255,255,255,0.10)",
              }}
            />
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: -0.2 }}>{state.message}</div>
            {state.submessage ? <div style={{ opacity: 0.82, marginTop: 6 }}>{state.submessage}</div> : null}
          </div>
        </div>

        <div
          style={{
            marginTop: 14,
            height: 10,
            borderRadius: 999,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.14)",
            background: "rgba(255,255,255,0.06)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: "45%",
              borderRadius: 999,
              background:
                "linear-gradient(90deg, rgba(212,175,55,0.0), rgba(212,175,55,0.75), rgba(255,255,255,0.0))",
              animation: "kvShimmer 1.2s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      <style jsx global>{`
        @keyframes kvSpin {
          to {
            transform: rotate(360deg);
          }
        }
        @keyframes kvShimmer {
          0% {
            transform: translateX(-10%);
            opacity: 0.6;
          }
          50% {
            opacity: 1;
          }
          100% {
            transform: translateX(140%);
            opacity: 0.65;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .kvSpin,
          .kvShimmer {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}

export function WizardProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [s, setS] = useState<WizardSession>(() => {
    const existing = safeParse<any>(typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null);
    // We keep only light state across reloads.
    const merged = { ...defaultSession(), ...(existing || {}) } as WizardSession;
    // Never resurrect giant blobs from storage.
    merged.beforeSrc = null;
    merged.promptedSrc = null;
    merged.maskOverrides = {};
    merged.overlayAssets = {};
    merged.overlayStatus = "idle";
    merged.overlayProgress = 0;
    merged.overlayError = undefined;
    return merged;
  });

  const inflightScan = useRef<Promise<void> | null>(null);

  // Global transition overlay (used by go()).
  const [transition, setTransition] = useState<
    | null
    | {
        message?: string;
        submessage?: string;
      }
  >(null);

  useEffect(() => {
    if (!transition) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [transition]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedSession(s)));
    } catch {
      // ignore quota
    }
  }, [s]);

  const resetAll = useCallback(() => {
    const fresh = defaultSession();
    setS(fresh);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPersistedSession(fresh)));
    } catch {}
  }, []);

  const setBeforeSrc = useCallback((src: string | null) => {
    setS((p) => ({ ...p, beforeSrc: src }));
  }, []);

  const setPromptedSrc = useCallback((src: string | null) => {
    setS((p) => ({ ...p, promptedSrc: src }));
  }, []);

  const setUserPrompt = useCallback((v: string) => {
    setS((p) => ({ ...p, userPrompt: v }));
  }, []);

  const setExtras = useCallback((next: Extras) => {
    setS((p) => ({ ...p, extras: next }));
  }, []);

  const setSelections = useCallback((next: Record<string, string>) => {
    setS((p) => ({ ...p, selections: next }));
  }, []);

  const setMaskOverrides = useCallback((next: Record<string, string>) => {
    // Any mask correction invalidates precomputed overlays.
    setS((p) => ({
      ...p,
      maskOverrides: next,
      overlayAssets: {},
      overlayStatus: "idle",
      overlayProgress: 0,
      overlayError: undefined,
    }));
  }, []);

  const go = useCallback(
    async (
      to: string,
      opts?: {
        message?: string;
        submessage?: string;
        minMs?: number;
        before?: () => Promise<void> | void;
      }
    ) => {
      const message = opts?.message || "Loading…";
      const submessage = opts?.submessage || "";
      const minMs = typeof opts?.minMs === "number" ? opts!.minMs! : 3000;

      // Show overlay immediately.
      setTransition({ message, submessage });

      const start = Date.now();
      try {
        if (opts?.before) await opts.before();
      } catch (e) {
        setTransition(null);
        throw e;
      }

      const elapsed = Date.now() - start;
      const remaining = Math.max(0, minMs - elapsed);
      if (remaining) await new Promise((r) => setTimeout(r, remaining));

      router.push(to);
      // Hide shortly after navigation starts to prevent flicker.
      window.setTimeout(() => setTransition(null), 160);
    },
    [router]
  );

  const rebuildOverlays = useCallback(
    async (featureId?: string) => {
      if (s.overlayStatus === "building") return;
      if (s.scanStatus !== "ready") return;
      if (!s.beforeSrc || !s.sceneGraph || !s.modules?.length) return;

      const subset = featureId ? s.modules.filter((m) => m.featureId === featureId) : s.modules;
      if (!subset.length) return;

      setS((p) => ({ ...p, overlayStatus: "building", overlayProgress: 0, overlayError: undefined }));

      try {
        const assets = await buildOverlayAssetsClient({
          baseSrc: s.beforeSrc!,
          scene: s.sceneGraph!,
          modules: subset,
          maskOverrides: s.maskOverrides,
          maxSide: 1200,
          onProgress: (p) => setS((prev) => ({ ...prev, overlayProgress: p, overlayStatus: "building" })),
        });

        setS((prev) => ({
          ...prev,
          overlayAssets: featureId ? { ...prev.overlayAssets, ...assets } : assets,
          overlayStatus: "ready",
          overlayProgress: 1,
          overlayError: undefined,
        }));
      } catch (e: any) {
        setS((p) => ({
          ...p,
          overlayStatus: "error",
          overlayError: e?.message ?? "Overlay build failed",
        }));
      }
    },
    [s.overlayStatus, s.scanStatus, s.beforeSrc, s.sceneGraph, s.modules, s.maskOverrides]
  );

  const startScan = useCallback(async (file: File) => {
    if (inflightScan.current) return inflightScan.current;

    const run = (async () => {
      setS((p) => ({
        ...p,
        scanStatus: "scanning",
        scanError: undefined,
        scanId: null,
        sceneGraph: null,
        modules: [],
        selections: {},
        maskOverrides: {},
        // Reset overlays for the new scan.
        overlayAssets: {},
        overlayStatus: "idle",
        overlayProgress: 0,
        overlayError: undefined,
      }));
      try {
        const fd = new FormData();
        fd.append("image", file);

        const res = await fetch("/api/scan", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || data?.message || "Scan failed");

        const scanId = data.scanId as string;
        const sceneGraph = data.sceneGraph as SceneGraph;

        // Options (best-effort, but generally required)
        const res2 = await fetch("/api/options", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scanId }),
        });
        const data2 = await res2.json().catch(() => ({}));
        if (!res2.ok) throw new Error(data2?.error || data2?.message || "Options failed");

        setS((p) => ({
          ...p,
          scanId,
          sceneGraph,
          modules: data2.modules || [],
          // No pre-selected defaults. User starts from the prompted baseline.
          selections: {},
          maskOverrides: {},
          scanStatus: "ready",
          scanError: undefined,
          // Kick overlay builder once we have modules.
          overlayAssets: {},
          overlayStatus: "idle",
          overlayProgress: 0,
          overlayError: undefined,
        }));
      } catch (e: any) {
        setS((p) => ({
          ...p,
          scanStatus: "error",
          scanError: e?.message ?? "Scan failed",
          overlayAssets: {},
          overlayStatus: "idle",
          overlayProgress: 0,
          overlayError: undefined,
        }));
      } finally {
        inflightScan.current = null;
      }
    })();

    inflightScan.current = run;
    return run;
  }, []);

  // Background overlay precompute (runs while user is on contact/prompt screens).
  useEffect(() => {
    if (s.overlayStatus !== "idle") return;
    if (s.scanStatus !== "ready") return;
    if (!s.beforeSrc || !s.sceneGraph || !s.modules?.length) return;

    let cancelled = false;

    setS((p) => ({ ...p, overlayStatus: "building", overlayProgress: 0, overlayError: undefined, overlayAssets: {} }));

    (async () => {
      try {
        const assets = await buildOverlayAssetsClient({
          baseSrc: s.beforeSrc!,
          scene: s.sceneGraph!,
          modules: s.modules,
          maskOverrides: s.maskOverrides,
          maxSide: 1200,
          onProgress: (p) => {
            if (cancelled) return;
            setS((prev) => ({ ...prev, overlayProgress: p, overlayStatus: "building" }));
          },
        });

        if (cancelled) return;
        setS((p) => ({ ...p, overlayAssets: assets, overlayStatus: "ready", overlayProgress: 1, overlayError: undefined }));
      } catch (e: any) {
        if (cancelled) return;
        setS((p) => ({
          ...p,
          overlayAssets: {},
          overlayStatus: "error",
          overlayProgress: 0,
          overlayError: e?.message ?? "Overlay build failed",
        }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [s.overlayStatus, s.scanStatus, s.beforeSrc, s.sceneGraph, s.modules, s.maskOverrides]);

  const value = useMemo<Ctx>(
    () => ({
      s,
      resetAll,
      setBeforeSrc,
      setPromptedSrc,
      startScan,
      setUserPrompt,
      setExtras,
      setSelections,
      setMaskOverrides,
      rebuildOverlays,
      go,
    }),
    [s, resetAll, setBeforeSrc, setPromptedSrc, startScan, setUserPrompt, setExtras, setSelections, setMaskOverrides, rebuildOverlays, go]
  );

  return (
    <WizardContext.Provider value={value}>
      {children}
      <TransitionOverlay state={transition} />
    </WizardContext.Provider>
  );
}

function TransitionOverlay({
  state,
}: {
  state: null | {
    message?: string;
    submessage?: string;
  };
}) {
  if (!state) return null;

  return (
    <div
      role="alert"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        background: "radial-gradient(1200px 600px at 30% 10%, rgba(212,175,55,0.16), rgba(0,0,0,0.92))",
        backdropFilter: "blur(6px)",
      }}
    >
      <div
        className="kv-card"
        style={{
          width: "min(560px, 92vw)",
          padding: 22,
          borderRadius: 18,
          border: "1px solid rgba(255,255,255,0.14)",
          background: "rgba(0,0,0,0.55)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <div
            aria-hidden
            style={{
              width: 36,
              height: 36,
              borderRadius: 999,
              border: "3px solid rgba(255,255,255,0.18)",
              borderTopColor: "rgba(212,175,55,0.95)",
              animation: "kv_spin 1s linear infinite",
            }}
          />
          <div style={{ flex: 1 }}>
            <div className="kv-headline" style={{ fontSize: 18, fontWeight: 900 }}>
              {state.message || "Loading…"}
            </div>
            {state.submessage ? <div style={{ opacity: 0.82, marginTop: 6, fontSize: 13 }}>{state.submessage}</div> : null}
          </div>
        </div>

        <div
          aria-hidden
          style={{
            marginTop: 16,
            height: 10,
            borderRadius: 999,
            background: "rgba(255,255,255,0.10)",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <div
            style={{
              height: "100%",
              width: "45%",
              background: "linear-gradient(90deg, rgba(212,175,55,0), rgba(212,175,55,0.55), rgba(212,175,55,0))",
              animation: "kv_shimmer 1.2s ease-in-out infinite",
            }}
          />
        </div>

        <div style={{ marginTop: 12, opacity: 0.7, fontSize: 12 }}>
          Tip: we prep masks & options in the background so your edits feel instant.
        </div>
      </div>

      <style jsx global>{`
        @keyframes kv_spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes kv_shimmer {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(320%); }
        }
      `}</style>
    </div>
  );
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
