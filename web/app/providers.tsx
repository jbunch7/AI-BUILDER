"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  maxSide?: number;
  onProgress?: (p: number) => void;
}): Promise<OverlayAssets> {
  const { baseSrc, scene, modules, maxSide = 1200, onProgress } = args;

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

  // Helper: build a single combined mask canvas for a module's target element types.
  const buildMaskCanvas = (m: BuilderModule) => {
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
    const maskCanvas = buildMaskCanvas(m);
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

export function WizardProvider({ children }: { children: React.ReactNode }) {
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
    setS((p) => ({ ...p, maskOverrides: next }));
  }, []);

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
          selections: data2.defaultSelections || {},
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
          baseSrc: (s.promptedSrc || s.beforeSrc)!,
          scene: s.sceneGraph!,
          modules: s.modules,
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
  }, [s.overlayStatus, s.scanStatus, s.beforeSrc, s.sceneGraph, s.modules]);

  const value = useMemo<Ctx>(
    () => ({ s, resetAll, setBeforeSrc, setPromptedSrc, startScan, setUserPrompt, setExtras, setSelections, setMaskOverrides }),
    [s, resetAll, setBeforeSrc, setPromptedSrc, startScan, setUserPrompt, setExtras, setSelections, setMaskOverrides]
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard() {
  const ctx = useContext(WizardContext);
  if (!ctx) throw new Error("useWizard must be used within WizardProvider");
  return ctx;
}
