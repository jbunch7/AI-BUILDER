"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWizard } from "../providers";
import type { BuilderModule, BuilderOption, SceneElement, SceneElementType } from "@/lib/builder/types";
import MaskEditorModal from "./MaskEditorModal";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

async function ensureImage(
  src: string,
  cache: Map<string, HTMLImageElement>
): Promise<HTMLImageElement> {
  const hit = cache.get(src);
  if (hit) return hit;
  const im = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
  cache.set(src, im);
  return im;
}

function getSelectedOption(module: BuilderModule, selections: Record<string, string>): BuilderOption | null {
  const selId = selections[module.featureId];
  if (!selId) return null;
  return module.options.find((o) => o.id === selId) ?? null;
}

function LiveBeforeAfter({
  beforeSrc,
  afterSrc,
  afterImgRef,
  overlayCanvasRef,
  disabled,
}: {
  beforeSrc: string;
  afterSrc: string;
  afterImgRef: React.RefObject<HTMLImageElement | null>;
  overlayCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  disabled?: boolean;
}) {
  const [pct, setPct] = useState(55);
  const draggingRef = useRef(false);

  const onDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    draggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [disabled]);

  const onMove = useCallback((e: React.PointerEvent) => {
    if (disabled) return;
    if (!draggingRef.current) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const nextPct = ((e.clientX - rect.left) / rect.width) * 100;
    setPct(clamp(nextPct, 8, 92));
  }, [disabled]);

  const onUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  return (
    <div
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
      style={{ position: "relative", width: "100%", userSelect: "none" }}
    >
      {/* Base (Before) */}
      <img src={beforeSrc} alt="Before" style={{ width: "100%", display: "block" }} />

      {/* After side (clipped) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          clipPath: `polygon(${pct}% 0, 100% 0, 100% 100%, ${pct}% 100%)`,
        }}
      >
        <div style={{ position: "relative", width: "100%", height: "100%" }}>
          <img
            ref={afterImgRef as any}
            src={afterSrc}
            alt="After"
            style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
          />
          <canvas
            ref={overlayCanvasRef as any}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
            }}
          />
        </div>
      </div>

      {/* Divider + handle */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${pct}%`,
          width: 2,
          background: "rgba(212,175,55,0.95)",
          boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${pct}%`,
          transform: "translate(-50%, -50%)",
          width: 44,
          height: 44,
          borderRadius: 999,
          background: "rgba(0,0,0,0.55)",
          border: "1px solid rgba(212,175,55,0.85)",
          display: "grid",
          placeItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: 6, opacity: 0.9 }}>
          <div style={{ width: 0, height: 0, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderRight: "8px solid rgba(255,255,255,0.85)" }} />
          <div style={{ width: 0, height: 0, borderTop: "6px solid transparent", borderBottom: "6px solid transparent", borderLeft: "8px solid rgba(255,255,255,0.85)" }} />
        </div>
      </div>
    </div>
  );
}

export default function BuildPage() {
  const { s, go, setSelections, setMaskOverrides, rebuildOverlays } = useWizard();

  const beforeSrc = s.beforeSrc;
  const baselineSrc = s.promptedSrc;
  const modules = s.modules || [];

  const [activeAfterSrc, setActiveAfterSrc] = useState<string | null>(null);
  const [finalJobId, setFinalJobId] = useState<string | null>(null);
  const [finalBusy, setFinalBusy] = useState(false);
  const [finalErr, setFinalErr] = useState<string | null>(null);

  const afterSrc = activeAfterSrc || baselineSrc || beforeSrc || "";

  const selections = s.selections || {};

  // --- Mask editor state
  const [maskOpen, setMaskOpen] = useState(false);
  const [maskFeature, setMaskFeature] = useState<string | null>(null);
  const [maskElement, setMaskElement] = useState<SceneElement | null>(null);
  const [maskInitial, setMaskInitial] = useState<string | null>(null);
  const [pendingRebuild, setPendingRebuild] = useState<string | null>(null);
  const [maskBuildErr, setMaskBuildErr] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imgCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const polyMaskCache = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const unionMaskCache = useRef<Map<string, string>>(new Map());

  const precomputedReady = s.overlayStatus === "ready" && Object.keys(s.overlayAssets || {}).length > 0;

  const selectedModules = useMemo(() => {
    return modules
      .map((m) => ({ m, selected: getSelectedOption(m, selections) }))
      .filter((x) => x.selected);
  }, [modules, selections]);

  const drawOverlays = useCallback(async () => {
    const imgEl = imgRef.current;
    const canvasEl = canvasRef.current;
    if (!imgEl || !canvasEl) return;
    if (!imgEl.complete) return;

    // If we are showing a final baked image, hide live overlays.
    if (activeAfterSrc) {
      const ctx = canvasEl.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      return;
    }

    const rect = imgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const dpr = window.devicePixelRatio || 1;
    canvasEl.width = Math.round(rect.width * dpr);
    canvasEl.height = Math.round(rect.height * dpr);
    canvasEl.style.width = `${Math.round(rect.width)}px`;
    canvasEl.style.height = `${Math.round(rect.height)}px`;

    const ctx = canvasEl.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);

    const scene = s.sceneGraph;
    if (!scene) return;

    const maskOverrideFor = async (featureId: string) => {
      const src = s.maskOverrides?.[featureId];
      if (!src) return null;
      return await ensureImage(src, imgCache.current);
    };

    for (const { m, selected } of selectedModules) {
      if (!selected) continue;

      const targetId = selected.id;
      const overlaySrc = s.overlayAssets?.[m.featureId]?.[targetId];

      if (precomputedReady && overlaySrc) {
        // Precomputed overlay image (already masked) — fastest path.
        try {
          const ov = await ensureImage(overlaySrc, imgCache.current);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
          ctx.drawImage(ov, 0, 0, rect.width, rect.height);

          // Optional: apply corrected mask on top to remove spills.
          const mo = await maskOverrideFor(m.featureId);
          if (mo) {
            ctx.globalCompositeOperation = "destination-in";
            ctx.drawImage(mo, 0, 0, rect.width, rect.height);
            ctx.globalCompositeOperation = "source-over";
          }
        } catch {
          // If an overlay image fails to load, fall back below.
        }
        continue;
      }

      // Fallback: draw a simple color/material fill and mask it client-side.
      ctx.globalAlpha = selected.kind === "material" ? 0.95 : 0.86;
      ctx.globalCompositeOperation = "source-over";

      if (selected.preview?.kind === "color") {
        ctx.fillStyle = selected.preview.hex;
        ctx.fillRect(0, 0, rect.width, rect.height);
      } else if (selected.preview?.kind === "image") {
        const tex = await ensureImage(selected.preview.src, imgCache.current);
        const pattern = ctx.createPattern(tex, "repeat");
        ctx.fillStyle = pattern || "rgba(255,255,255,0.25)";
        ctx.fillRect(0, 0, rect.width, rect.height);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.fillRect(0, 0, rect.width, rect.height);
      }

      // Masking
      const overrideMask = await maskOverrideFor(m.featureId);
      if (overrideMask) {
        ctx.globalCompositeOperation = "destination-in";
        ctx.globalAlpha = 1;
        ctx.drawImage(overrideMask, 0, 0, rect.width, rect.height);
        ctx.globalCompositeOperation = "source-over";
        continue;
      }

      // Polygon union mask (from scan)
      const key = `${m.featureId}:${Math.round(rect.width)}x${Math.round(rect.height)}`;
      let polyMask = polyMaskCache.current.get(key);
      if (!polyMask) {
        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = Math.round(rect.width);
        maskCanvas.height = Math.round(rect.height);
        const mctx = maskCanvas.getContext("2d");
        if (mctx) {
          mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
          mctx.fillStyle = "white";
          const types = new Set(m.targetElementTypes || []);
          const els = (scene.elements || []).filter((el) => types.has(el.type));
          for (const el of els) {
            const pts = el.mask?.points_norm;
            if (!Array.isArray(pts) || pts.length < 3) continue;
            mctx.beginPath();
            mctx.moveTo(pts[0].x_norm * maskCanvas.width, pts[0].y_norm * maskCanvas.height);
            for (let i = 1; i < pts.length; i++) {
              mctx.lineTo(pts[i].x_norm * maskCanvas.width, pts[i].y_norm * maskCanvas.height);
            }
            mctx.closePath();
            mctx.fill();
          }
        }
        polyMask = maskCanvas;
        polyMaskCache.current.set(key, polyMask);
      }

      ctx.globalCompositeOperation = "destination-in";
      ctx.globalAlpha = 1;
      ctx.drawImage(polyMask, 0, 0, rect.width, rect.height);
      ctx.globalCompositeOperation = "source-over";
    }
  }, [activeAfterSrc, precomputedReady, s.sceneGraph, s.overlayAssets, s.overlayStatus, s.maskOverrides, selectedModules]);

  // Redraw on image load + resizes + selection changes.
  useEffect(() => {
    const imgEl = imgRef.current;
    if (!imgEl) return;
    const onLoad = () => void drawOverlays();
    imgEl.addEventListener("load", onLoad);
    return () => imgEl.removeEventListener("load", onLoad);
  }, [afterSrc, drawOverlays]);

  useEffect(() => {
    void drawOverlays();
  }, [drawOverlays]);

  useEffect(() => {
    const imgEl = imgRef.current;
    if (!imgEl) return;
    const ro = new ResizeObserver(() => void drawOverlays());
    ro.observe(imgEl);
    return () => ro.disconnect();
  }, [drawOverlays]);

  // If a mask was saved, rebuild precomputed overlays for that feature.
  useEffect(() => {
    if (!pendingRebuild) return;
    if (!s.maskOverrides?.[pendingRebuild]) return;
    let cancelled = false;
    (async () => {
      try {
        await rebuildOverlays(pendingRebuild);
      } catch {
        // ignore (UI already falls back to polygon masks)
      } finally {
        if (!cancelled) setPendingRebuild(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pendingRebuild, s.maskOverrides, rebuildOverlays]);

  const canUseBuilder = !!beforeSrc && !!s.scanId && !!s.sceneGraph;
  const hasBaseline = !!baselineSrc;

  const resetToBaseline = useCallback(() => {
    setFinalErr(null);
    setFinalJobId(null);
    setActiveAfterSrc(null);
    setSelections({});
  }, [setSelections]);

  const onSelect = useCallback(
    (featureId: string, optionId: string) => {
      // If user changes something after generating a final, return to baseline builder.
      if (activeAfterSrc) setActiveAfterSrc(null);
      setSelections({ ...selections, [featureId]: optionId });
    },
    [activeAfterSrc, selections, setSelections]
  );

  const clearModule = useCallback(
    (featureId: string) => {
      if (activeAfterSrc) setActiveAfterSrc(null);
      const next = { ...selections };
      delete next[featureId];
      setSelections(next);
    },
    [activeAfterSrc, selections, setSelections]
  );

  const openMaskEditor = useCallback(
    async (m: BuilderModule) => {
      if (!beforeSrc || !s.sceneGraph) return;
      setMaskBuildErr(null);
      setMaskFeature(m.featureId);
      setMaskOpen(true);

      try {
        const existing = s.maskOverrides?.[m.featureId];
        if (existing) {
          setMaskInitial(existing);
        } else {
          const cached = unionMaskCache.current.get(m.featureId);
          if (cached) {
            setMaskInitial(cached);
          } else {
            // Build a union mask from scan polygons.
            const baseImg = await ensureImage(beforeSrc, imgCache.current);
            const maxSide = 1200;
            const scale = Math.min(1, maxSide / Math.max(baseImg.naturalWidth || 1, baseImg.naturalHeight || 1));
            const w = Math.max(1, Math.round((baseImg.naturalWidth || 1) * scale));
            const h = Math.max(1, Math.round((baseImg.naturalHeight || 1) * scale));

            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const ctx = c.getContext("2d");
            if (!ctx) throw new Error("Mask canvas unavailable");
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "white";

            const types = new Set(m.targetElementTypes || []);
            const els = (s.sceneGraph.elements || []).filter((el) => types.has(el.type));
            for (const el of els) {
              const pts = el.mask?.points_norm;
              if (!Array.isArray(pts) || pts.length < 3) continue;
              ctx.beginPath();
              ctx.moveTo(pts[0].x_norm * w, pts[0].y_norm * h);
              for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x_norm * w, pts[i].y_norm * h);
              }
              ctx.closePath();
              ctx.fill();
            }

            const dataUrl = c.toDataURL("image/png");
            unionMaskCache.current.set(m.featureId, dataUrl);
            setMaskInitial(dataUrl);
          }
        }

        const firstType = (m.targetElementTypes?.[0] || "wall") as SceneElementType;
        setMaskElement({ id: m.featureId, type: firstType, label: m.label, mask: { points_norm: [] } });
      } catch (e: any) {
        setMaskBuildErr(e?.message ?? "Failed to build mask");
        setMaskInitial(null);
        const firstType = (m.targetElementTypes?.[0] || "wall") as SceneElementType;
        setMaskElement({ id: m.featureId, type: firstType, label: m.label, mask: { points_norm: [] } });
      }
    },
    [beforeSrc, s.sceneGraph, s.maskOverrides]
  );

  const onSaveMask = useCallback(
    (maskDataUrl: string) => {
      if (!maskFeature) {
        setMaskOpen(false);
        return;
      }
      const next = { ...(s.maskOverrides || {}), [maskFeature]: maskDataUrl };
      setMaskOpen(false);
      setMaskInitial(null);
      setMaskElement(null);
      setMaskFeature(null);
      setMaskOverrides(next);
      setPendingRebuild(maskFeature);
    },
    [maskFeature, s.maskOverrides, setMaskOverrides]
  );

  // Final render (optional)
  const generateFinal = useCallback(async () => {
    if (!s.scanId) return;
    setFinalErr(null);
    setFinalBusy(true);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scanId: s.scanId,
          selections,
          extras: s.extras || {},
          userPrompt: s.userPrompt || "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to start render job");
      const jobId = data?.jobId as string | undefined;
      if (!jobId) throw new Error("Missing jobId");
      setFinalJobId(jobId);
      setActiveAfterSrc(null);

      // Poll job
      const start = Date.now();
      const maxMs = 120000; // 2 minutes
      while (Date.now() - start < maxMs) {
        await new Promise((r) => setTimeout(r, 1200));
        const jr = await fetch(`/api/job/${jobId}`, { method: "GET" });
        const j = await jr.json().catch(() => ({}));
        if (!jr.ok) throw new Error(j?.error || j?.message || "Job lookup failed");
        if (j?.status === "done" && j?.imageBase64) {
          setActiveAfterSrc(`data:image/png;base64,${j.imageBase64}`);
          break;
        }
        if (j?.status === "error") {
          throw new Error(j?.errorMessage || "Render failed");
        }
      }
    } catch (e: any) {
      setFinalErr(e?.message ?? "Final render failed");
    } finally {
      setFinalBusy(false);
    }
  }, [s.scanId, s.extras, s.userPrompt, selections]);

  // Guards
  if (!beforeSrc) {
    return (
      <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
        <div className="kv-card kv-surface kv-app-card" style={{ width: "min(760px, 100%)", padding: 20 }}>
          <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>No photo found</div>
          <div style={{ opacity: 0.85, marginTop: 8 }}>Please upload a photo to begin.</div>
          <div style={{ marginTop: 16 }}>
            <button className="kv-btn" onClick={() => void go("/upload", { message: "Opening uploader…", minMs: 3000 })}>Go to Upload</button>
          </div>
        </div>
      </div>
    );
  }

  if (!canUseBuilder) {
    return (
      <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
        <div className="kv-card kv-surface kv-app-card" style={{ width: "min(760px, 100%)", padding: 20 }}>
          <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>Still preparing…</div>
          <div style={{ opacity: 0.85, marginTop: 8 }}>We’re still analyzing your photo. This should only take a moment.</div>
          <div style={{ marginTop: 16, opacity: 0.8, fontSize: 13 }}>
            Status: {s.scanStatus}
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="kv-btn-secondary" onClick={() => void go("/upload", { message: "Back to uploader…", minMs: 3000 })}>Back</button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasBaseline) {
    return (
      <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
        <div className="kv-card kv-surface kv-app-card" style={{ width: "min(760px, 100%)", padding: 20 }}>
          <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>Baseline image missing</div>
          <div style={{ opacity: 0.85, marginTop: 8 }}>
            Please return to the prompt step and generate your baseline remodel first.
          </div>
          <div style={{ marginTop: 16 }}>
            <button className="kv-btn" onClick={() => void go("/prompt", { message: "Returning to prompt…", minMs: 3000 })}>Go to Prompt</button>
          </div>
        </div>
      </div>
    );
  }

  const subcategory = s.sceneGraph?.meta?.subcategory;

  return (
    <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(1200px, 100%)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <div>
            <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900 }}>Live Customizer</div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              Click options to swap instantly. No re-rendering on each click.
            </div>
            {subcategory ? (
              <div style={{ opacity: 0.75, marginTop: 6, fontSize: 12 }}>
                Detected: <b>{subcategory.replaceAll("_", " ")}</b>
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button className="kv-btn-secondary" onClick={() => void go("/prompt", { message: "Returning…", minMs: 3000 })}>
              Back
            </button>
            <button className="kv-btn-secondary" onClick={resetToBaseline}>
              Back to Prompted
            </button>
            <button className="kv-btn" onClick={generateFinal} disabled={finalBusy} title="Generate a full-quality final render">
              {finalBusy ? "Generating final…" : "Generate Final"}
            </button>
          </div>
        </div>

        {finalErr ? (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              borderRadius: 12,
              background: "rgba(255,0,0,0.10)",
              border: "1px solid rgba(255,0,0,0.25)",
            }}
          >
            {finalErr}
          </div>
        ) : null}

        {pendingRebuild ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "rgba(212,175,55,0.08)", border: "1px solid rgba(212,175,55,0.22)", opacity: 0.95 }}>
            Updating mask for <b>{pendingRebuild}</b>…
          </div>
        ) : null}

        {maskBuildErr ? (
          <div style={{ marginTop: 12, padding: 10, borderRadius: 12, background: "rgba(255,0,0,0.08)", border: "1px solid rgba(255,0,0,0.20)", opacity: 0.95 }}>
            {maskBuildErr}
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: 16, alignItems: "start" }}>
          <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,0.10)" }}>
            <LiveBeforeAfter beforeSrc={beforeSrc} afterSrc={afterSrc} afterImgRef={imgRef} overlayCanvasRef={canvasRef} disabled={false} />
          </div>

          <div>
            <div style={{ opacity: 0.85, fontSize: 13, marginBottom: 10 }}>
              {activeAfterSrc ? "Showing final render (click any option to return to live builder)." : "Pick 0–1 option per category (3 curated choices)."}
            </div>

            {modules.length === 0 ? (
              <div style={{ padding: 14, borderRadius: 14, border: "1px dashed rgba(255,255,255,0.18)", opacity: 0.85 }}>
                No configurable surfaces were detected. Try a different photo with clearer view.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {modules.map((m) => {
                  const selected = getSelectedOption(m, selections);
                  return (
                    <div key={m.featureId} style={{ padding: 12, borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.03)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <div>
                          <div style={{ fontWeight: 800 }}>{m.label}</div>
                          <div style={{ opacity: 0.75, fontSize: 12, marginTop: 2 }}>{selected ? `Selected: ${selected.label}` : "No selection"}</div>
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button className="kv-btn-secondary" onClick={() => void openMaskEditor(m)} title="Fix the mask for this surface">
                            Fix mask
                          </button>
                          <button className="kv-btn-secondary" onClick={() => clearModule(m.featureId)} title="Clear this surface">
                            Clear
                          </button>
                        </div>
                      </div>

                      <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                        {m.options.slice(0, 3).map((opt) => {
                          const isSelected = selections[m.featureId] === opt.id;
                          const isColor = opt.preview?.kind === "color";
                          const swatchStyle: React.CSSProperties = {
                            width: 44,
                            height: 44,
                            borderRadius: 12,
                            border: isSelected
                              ? "2px solid rgba(212,175,55,0.95)"
                              : "1px solid rgba(255,255,255,0.18)",
                            background: isColor ? opt.preview.hex : "rgba(255,255,255,0.10)",
                            boxShadow: isSelected ? "0 0 0 4px rgba(212,175,55,0.12)" : "none",
                            cursor: "pointer",
                            overflow: "hidden",
                          };

                          return (
                            <div key={opt.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                              <button
                                aria-label={`Select ${opt.label}`}
                                onClick={() => onSelect(m.featureId, opt.id)}
                                style={swatchStyle}
                              >
                                {!isColor && opt.preview?.kind === "image" ? (
                                  <img src={opt.preview.src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                ) : null}
                              </button>
                              <div style={{ fontSize: 12, opacity: 0.9 }}>{opt.label}</div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ marginTop: 12, opacity: 0.75, fontSize: 12 }}>
              Instant options: {s.overlayStatus === "ready" ? "Ready ✓" : s.overlayStatus === "building" ? "Preparing…" : s.overlayStatus === "error" ? `Error: ${s.overlayError || "failed"}` : "Queued"}
            </div>
          </div>
        </div>
      </div>

      <MaskEditorModal
        open={maskOpen}
        baseSrc={beforeSrc}
        element={maskElement}
        initialMaskDataUrl={maskInitial}
        onClose={() => {
          setMaskOpen(false);
          setMaskElement(null);
          setMaskInitial(null);
          setMaskFeature(null);
        }}
        onSave={onSaveMask}
      />
    </div>
  );
}
