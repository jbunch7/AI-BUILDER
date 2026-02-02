"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuilderModule, SceneGraph, BuilderOption } from "@/lib/builder/types";
import { useWizard } from "../providers";
import MaskEditorModal from "./MaskEditorModal";

function Step({ label, state }: { label: string; state: "todo" | "active" | "done" }) {
  const circleStyle: React.CSSProperties = {
    height: 18,
    width: 18,
    borderRadius: 999,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 700,
    background:
      state === "done"
        ? "rgba(212,175,55,0.95)"
        : state === "active"
        ? "rgba(75,0,130,0.95)"
        : "rgba(255,255,255,0.12)",
    color: state === "todo" ? "rgba(255,255,255,0.65)" : "#0b0b0f",
    flex: "0 0 auto",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={circleStyle}>{state === "done" ? "✓" : state === "active" ? "…" : "•"}</span>
      <span
        style={{
          color: state === "todo" ? "rgba(255,255,255,0.65)" : "var(--kv-offwhite)",
          fontWeight: state === "active" ? 650 : 500,
        }}
      >
        {label}
      </span>
    </div>
  );
}

function BeforeAfterSlider({ beforeSrc, afterSrc }: { beforeSrc: string; afterSrc: string }) {
  const [pct, setPct] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const clampPct = (v: number) => Math.max(0, Math.min(100, v));

  const pctFromClientX = (clientX: number) => {
    const el = wrapRef.current;
    if (!el) return pct;
    const r = el.getBoundingClientRect();
    const x = clientX - r.left;
    return clampPct((x / Math.max(1, r.width)) * 100);
  };

  const beginDrag = (e: React.PointerEvent) => {
    setIsDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setPct(pctFromClientX(e.clientX));
  };

  const onDrag = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPct(pctFromClientX(e.clientX));
  };

  const endDrag = () => setIsDragging(false);

  return (
    <div
      style={{
        width: "100%",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        overflow: "hidden",
        background: "rgba(0,0,0,0.25)",
      }}
    >
      <div
        ref={wrapRef}
        style={{ position: "relative", width: "100%" }}
        onPointerDown={beginDrag}
        onPointerMove={onDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <img src={beforeSrc} alt="Before" style={{ width: "100%", display: "block" }} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            clipPath: `inset(0 ${100 - pct}% 0 0)`,
            WebkitClipPath: `inset(0 ${100 - pct}% 0 0)`,
          }}
        >
          <img
            src={afterSrc}
            alt="After"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
        </div>

        {/* Handle */}
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${pct}%`,
            transform: "translateX(-50%)",
            width: 2,
            background: "rgba(242,242,242,0.85)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${pct}%`,
            transform: "translate(-50%,-50%)",
            height: 36,
            width: 36,
            borderRadius: 999,
            background: "rgba(0,0,0,0.65)",
            border: "1px solid rgba(255,255,255,0.18)",
            display: "grid",
            placeItems: "center",
            color: "var(--kv-offwhite)",
            fontWeight: 800,
            userSelect: "none",
          }}
        >
          ⇆
        </div>
      </div>
    </div>
  );
}

function findSelectedOption(module: BuilderModule, selections: Record<string, string>) {
  const id = selections[module.featureId] ?? module.defaultOptionId ?? module.options?.[0]?.id;
  return module.options.find((o) => o.id === id) ?? module.options?.[0] ?? null;
}

function isColorPreview(opt: BuilderOption | null): opt is BuilderOption & { preview: { kind: "color"; hex: string } } {
  return !!opt && !!opt.preview && opt.preview.kind === "color";
}

function stableStringify(obj: unknown) {
  const seen = new WeakSet();
  const sorter = (_k: string, v: any) => {
    if (!v || typeof v !== "object") return v;
    if (seen.has(v)) return undefined;
    seen.add(v);
    if (Array.isArray(v)) return v;
    return Object.keys(v)
      .sort()
      .reduce((acc: any, k) => {
        acc[k] = v[k];
        return acc;
      }, {});
  };
  return JSON.stringify(obj, sorter);
}

function hashString(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export default function Page() {
  const router = useRouter();
  const { s: ws, setSelections: setWizardSelections, setMaskOverrides: setWizardMaskOverrides } = useWizard();

  const [beforeSrc, setBeforeSrc] = useState<string | null>(ws.beforeSrc);
  const [scanId, setScanId] = useState<string | null>(ws.scanId);
  const [sceneGraph, setSceneGraph] = useState<SceneGraph | null>(ws.sceneGraph);
  const [modules, setModules] = useState<BuilderModule[]>(ws.modules || []);
  const [selections, setSelections] = useState<Record<string, string>>(ws.selections || {});
  const [maskOverrides, setMaskOverrides] = useState<Record<string, string>>(ws.maskOverrides || {});

  const [jobId, setJobId] = useState<string | null>(null);
  const [afterSrc, setAfterSrc] = useState<string | null>(null);

  // Phase 3: progressive refinement (background “snap to photoreal”)
  const [refinedBaseSrc, setRefinedBaseSrc] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [lastRefinedKey, setLastRefinedKey] = useState<string | null>(null);
  const refineCache = useRef<Map<string, string>>(new Map());
  const refineAbort = useRef<AbortController | null>(null);

  const isScanning = ws.scanStatus === "scanning";
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [debugMasks, setDebugMasks] = useState(false);

  const [maskEditorOpen, setMaskEditorOpen] = useState(false);
  const [maskEditorElementId, setMaskEditorElementId] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Caches for instant preview assets
  const textureCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const maskImgCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const polyMaskCanvasCache = useRef<Map<string, HTMLCanvasElement>>(new Map());

  const step = useMemo(() => {
    if (!beforeSrc) return 1;
    if (isScanning) return 2;
    if (!sceneGraph) return 2;
    if (isRendering) return 4;
    if (afterSrc) return 5;
    return 3;
  }, [beforeSrc, isScanning, sceneGraph, isRendering, afterSrc]);

  // Guard: if user hasn't uploaded, send them back.
  useEffect(() => {
    if (!ws.beforeSrc) router.replace("/upload");
  }, [ws.beforeSrc, router]);

  // Sync wizard state into this page (scan runs earlier in the wizard).
  useEffect(() => {
    setBeforeSrc(ws.beforeSrc);
    setScanId(ws.scanId);
    setSceneGraph(ws.sceneGraph);
    setModules(ws.modules || []);
    setSelections(ws.selections || {});
    setMaskOverrides(ws.maskOverrides || {});

    // If a new scan starts (new image), reset refinement cache for clarity.
    if (ws.scanId && ws.scanId !== scanId) {
      refineCache.current.clear();
      setRefinedBaseSrc(null);
      setLastRefinedKey(null);
      setRefineError(null);
      setRefining(false);
    }
  }, [ws.beforeSrc, ws.scanId, ws.sceneGraph, ws.modules, ws.selections, ws.maskOverrides, scanId]);

  // Keep wizard selections in sync when user clicks options.
  useEffect(() => {
    setWizardSelections(selections);
  }, [selections, setWizardSelections]);

  // Keep wizard mask overrides in sync when user edits masks.
  useEffect(() => {
    setWizardMaskOverrides(maskOverrides);
  }, [maskOverrides, setWizardMaskOverrides]);

  // Phase 3: background refinement
  // - Debounced (so rapid clicking stays instant)
  // - Cached (so returning to a previous combo snaps immediately)
  // - Cancels in-flight requests when user changes selection
  const currentRefineKey = useMemo(() => {
    if (!scanId) return null;
    const seed = stableStringify({ selections, extras: ws.extras || {}, userPrompt: ws.userPrompt || "" });
    return `${scanId}:${hashString(seed)}:low`;
  }, [scanId, selections, ws.extras, ws.userPrompt]);

  const basePreviewSrc = refinedBaseSrc ?? beforeSrc;
  const refinedIsCurrent = Boolean(refinedBaseSrc && lastRefinedKey && currentRefineKey && lastRefinedKey === currentRefineKey);
  const showCanvas = previewEnabled && !refinedIsCurrent;

  useEffect(() => {
    if (!scanId || !currentRefineKey) return;

    setRefineError(null);

    // If cached, show immediately.
    const cached = refineCache.current.get(currentRefineKey);
    if (cached) {
      setRefinedBaseSrc(cached);
      setLastRefinedKey(currentRefineKey);
      setRefining(false);
      return;
    }

    // Debounce refine calls.
    setRefining(true);
    const t = window.setTimeout(async () => {
      // Cancel any in-flight request.
      if (refineAbort.current) refineAbort.current.abort();
      const ac = new AbortController();
      refineAbort.current = ac;

      try {
        const res = await fetch("/api/refine", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            scanId,
            selections,
            extras: ws.extras || {},
            userPrompt: ws.userPrompt || "",
            variant: "low",
          }),
          signal: ac.signal,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Refine failed");
        const b64 = data?.resultImageBase64;
        if (!b64 || typeof b64 !== "string") throw new Error("Refine returned no image");
        const src = `data:image/png;base64,${b64}`;
        refineCache.current.set(currentRefineKey, src);
        setRefinedBaseSrc(src);
        setLastRefinedKey(currentRefineKey);
        setRefining(false);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setRefining(false);
        setRefineError(e?.message || "Refine failed");
      }
    }, 850);

    return () => window.clearTimeout(t);
  }, [scanId, currentRefineKey, selections, ws.extras, ws.userPrompt]);

  async function runRender() {
    if (!scanId) return;
    setError(null);
    setIsRendering(true);
    setAfterSrc(null);
    setJobId(null);

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId, selections, extras: ws.extras || {}, userPrompt: ws.userPrompt || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || "Render failed");

      setJobId(data.jobId);
    } catch (e: any) {
      setError(e?.message ?? "Render failed");
      setIsRendering(false);
    }
  }

  // Poll job status
  useEffect(() => {
    if (!jobId) return;

    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/job/${encodeURIComponent(jobId)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || "Job fetch failed");

        if (cancelled) return;

        if (data.status === "completed" && data.resultImageBase64) {
          setAfterSrc(`data:image/png;base64,${data.resultImageBase64}`);
          setIsRendering(false);
        } else if (data.status === "failed") {
          setError(data.error || "Render failed");
          setIsRendering(false);
        }
      } catch (e: any) {
        if (cancelled) return;
        // Don’t hard fail on transient polling issues.
      }
    };

    const interval = setInterval(tick, 1500);
    tick();

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  // Instant preview renderer (Phase 2)
  // - Supports color + texture previews
  // - Uses feathered masks (polygons) and optional per-element PNG overrides from the mask editor
  useEffect(() => {
    if (!previewEnabled) return;
    if (!sceneGraph) return;
    if (!imgRef.current) return;
    if (!canvasRef.current) return;

    const img = imgRef.current;
    const canvas = canvasRef.current;

    const ensureImg = (src: string, cache: Map<string, HTMLImageElement>, onReady: () => void) => {
      const existing = cache.get(src);
      if (existing && existing.complete) return existing;
      if (existing) return existing;
      const im = new Image();
      im.onload = onReady;
      im.src = src;
      cache.set(src, im);
      return im;
    };

    const makeFeatheredPolyMask = (elId: string, pts: any, w: number, h: number, featherPx: number) => {
      const key = `${elId}:${w}x${h}:f${featherPx}`;
      const cached = polyMaskCanvasCache.current.get(key);
      if (cached) return cached;

      const base = document.createElement("canvas");
      base.width = w;
      base.height = h;
      const bctx = base.getContext("2d");
      if (!bctx) return base;
      bctx.clearRect(0, 0, w, h);
      bctx.fillStyle = "white";
      bctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        const x = p[0] * w;
        const y = p[1] * h;
        if (i === 0) bctx.moveTo(x, y);
        else bctx.lineTo(x, y);
      }
      bctx.closePath();
      bctx.fill();

      if (featherPx > 0) {
        const out = document.createElement("canvas");
        out.width = w;
        out.height = h;
        const octx = out.getContext("2d");
        if (octx) {
          octx.clearRect(0, 0, w, h);
          octx.filter = `blur(${featherPx}px)`;
          octx.drawImage(base, 0, 0);
          octx.filter = "none";
        }
        polyMaskCanvasCache.current.set(key, out);
        return out;
      }

      polyMaskCanvasCache.current.set(key, base);
      return base;
    };

    const draw = () => {
      const rect = img.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      const feather = 6;

      for (const m of modules) {
        if (m.previewMode !== "overlay") continue;
        const selected = findSelectedOption(m, selections);
        if (!selected || !selected.preview) continue;

        const targets = new Set(m.targetElementTypes);
        const elems = (sceneGraph.elements || []).filter((e) => targets.has(e.type));
        if (elems.length === 0) continue;

        const preferColorBlend = m.featureId.includes("paint") || m.featureId.includes("color") || m.featureId.includes("cabinets");
        const desiredBlend = preferColorBlend ? ("color" as GlobalCompositeOperation) : ("multiply" as GlobalCompositeOperation);

        // Pre-load textures/mask overrides if needed
        let textureImg: HTMLImageElement | null = null;
        if (selected.preview.kind === "image") {
          textureImg = ensureImg(selected.preview.src, textureCache.current, draw);
          if (!textureImg.complete) continue; // wait for load
        }

        for (const el of elems) {
          const override = maskOverrides[el.id];

          ctx.save();
          ctx.globalAlpha = m.featureId === "flooring" ? 0.72 : 0.58;
          ctx.globalCompositeOperation = desiredBlend;
          if (preferColorBlend && ctx.globalCompositeOperation !== desiredBlend) {
            ctx.globalCompositeOperation = "multiply";
          }

          // Draw overlay source across full frame (we will mask it down next)
          if (selected.preview.kind === "color") {
            ctx.fillStyle = selected.preview.hex;
            ctx.fillRect(0, 0, rect.width, rect.height);
          } else if (selected.preview.kind === "image" && textureImg) {
            const pat = ctx.createPattern(textureImg, "repeat");
            if (pat) {
              ctx.fillStyle = pat;
              ctx.fillRect(0, 0, rect.width, rect.height);
            }
          }

          // Clip by mask (override PNG preferred, else feathered polygon)
          ctx.globalCompositeOperation = "destination-in";
          ctx.globalAlpha = 1;

          if (override) {
            const maskIm = ensureImg(override, maskImgCache.current, draw);
            if (maskIm.complete) {
              ctx.drawImage(maskIm, 0, 0, rect.width, rect.height);
            }
          } else {
            const pts = el?.mask?.points_norm;
            if (Array.isArray(pts) && pts.length >= 3) {
              const maskCanvas = makeFeatheredPolyMask(el.id, pts, Math.round(rect.width), Math.round(rect.height), feather);
              ctx.drawImage(maskCanvas, 0, 0);
            }
          }

          if (debugMasks) {
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = 1;
            ctx.strokeStyle = "rgba(212,175,55,0.95)";
            ctx.lineWidth = 2;
            const pts = el?.mask?.points_norm;
            if (Array.isArray(pts) && pts.length >= 3) {
              ctx.beginPath();
              for (let i = 0; i < pts.length; i++) {
                const x = pts[i][0] * rect.width;
                const y = pts[i][1] * rect.height;
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
              ctx.stroke();
            }
          }

          ctx.restore();
        }
      }
    };

    const ro = new ResizeObserver(() => draw());
    ro.observe(img);
    if (img.complete) draw();
    else img.onload = draw;
    window.addEventListener("resize", draw);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [previewEnabled, sceneGraph, modules, selections, debugMasks, maskOverrides]);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "28px 16px",
        display: "grid",
        placeItems: "center",
      }}
    >
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(1100px, 100%)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.4 }}>
              Remodel Builder
            </div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              Upload a photo, pick finishes, then render a photoreal preview — same space, same perspective.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", opacity: 0.9 }}>
              <input type="checkbox" checked={previewEnabled} onChange={(e) => setPreviewEnabled(e.target.checked)} />
              Live overlay preview
            </label>
            <label style={{ display: "flex", gap: 8, alignItems: "center", cursor: "pointer", opacity: 0.9 }}>
              <input type="checkbox" checked={debugMasks} onChange={(e) => setDebugMasks(e.target.checked)} />
              Show masks
            </label>

            {sceneGraph?.elements?.length ? (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <select
                  className="kv-input"
                  style={{ height: 34, padding: "6px 10px", maxWidth: 220 }}
                  value={maskEditorElementId ?? sceneGraph.elements[0].id}
                  onChange={(e) => setMaskEditorElementId(e.target.value)}
                >
                  {sceneGraph.elements.map((el) => (
                    <option key={el.id} value={el.id}>
                      {el.label || el.type}
                    </option>
                  ))}
                </select>
                <button
                  className="kv-btn-secondary"
                  onClick={() => {
                    const chosen = maskEditorElementId ?? sceneGraph.elements[0].id;
                    setMaskEditorElementId(chosen);
                    setMaskEditorOpen(true);
                  }}
                >
                  Edit masks
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 16,
            marginTop: 18,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 12,
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 16,
              padding: 14,
              background: "rgba(255,255,255,0.04)",
            }}
          >
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <Step label="Upload" state={step > 1 ? "done" : "active"} />
              <Step label="Scan" state={step > 2 ? "done" : step === 2 ? "active" : "todo"} />
              <Step label="Choose" state={step > 3 ? "done" : step === 3 ? "active" : "todo"} />
              <Step label="Render" state={step > 4 ? "done" : step === 4 ? "active" : "todo"} />
              <Step label="Result" state={step === 5 ? "active" : "todo"} />
            </div>

            {error ? (
              <div style={{ padding: 12, borderRadius: 12, background: "rgba(255,0,0,0.10)", border: "1px solid rgba(255,0,0,0.25)" }}>
                <div style={{ fontWeight: 800 }}>Error</div>
                <div style={{ opacity: 0.9, marginTop: 6 }}>{error}</div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
              <button className="kv-btn-secondary" onClick={() => router.push("/prompt")}>
                Back
              </button>

              <button
                className="kv-btn"
                onClick={() => void runRender()}
                disabled={!scanId || !sceneGraph || isScanning || isRendering}
              >
                {isScanning ? "Preparing…" : isRendering ? "Rendering…" : "Render photoreal"}
              </button>

              {sceneGraph ? (
                <div style={{ opacity: 0.85 }}>
                  Detected: <b>{sceneGraph.meta?.subcategory || "unknown"}</b> ({sceneGraph.meta?.category})
                </div>
              ) : (
                <div style={{ opacity: 0.8 }}>
                  {ws.scanStatus === "error" ? `Scan error: ${ws.scanError}` : "Preparing your live builder…"}
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: 16,
            }}
          >
            {/* Main content */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "360px 1fr",
                gap: 16,
                alignItems: "start",
              }}
            >
              {/* Options */}
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(0,0,0,0.25)",
                }}
              >
                <div className="kv-headline" style={{ fontSize: 16, fontWeight: 800 }}>
                  Your selections
                </div>
                <div style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
                  Click swatches to preview. Final render applies realistic materials.
                </div>

                {!sceneGraph ? (
                  <div style={{ opacity: 0.75, marginTop: 12 }}>Scan a photo to unlock options.</div>
                ) : null}

                <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                  {modules.map((m) => {
                    const selected = findSelectedOption(m, selections);

                    return (
                      <div key={m.featureId} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 800 }}>{m.label}</div>
                          <div style={{ opacity: 0.75, fontSize: 12 }}>
                            {m.previewMode === "overlay" ? "Preview" : "Final render"}
                          </div>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                          {m.options.map((opt) => {
                            const isSelected = selected?.id === opt.id;
                            const isColor = opt.preview?.kind === "color";
                            const swatchStyle: React.CSSProperties = {
                              height: 28,
                              width: 28,
                              borderRadius: 999,
                              border: isSelected
                                ? "2px solid rgba(212,175,55,0.95)"
                                : "1px solid rgba(255,255,255,0.18)",
                              background: isColor ? opt.preview!.hex : "rgba(255,255,255,0.10)",
                              boxShadow: isSelected ? "0 0 0 4px rgba(212,175,55,0.12)" : "none",
                              cursor: "pointer",
                            };

                            return (
                              <div key={opt.id} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
                                <div
                                  title={opt.label}
                                  style={swatchStyle}
                                  onClick={() => {
                                    setSelections((s) => ({ ...s, [m.featureId]: opt.id }));
                                  }}
                                />
                                <div style={{ fontSize: 11, opacity: 0.8, textAlign: "center", maxWidth: 90 }}>
                                  {opt.label}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview */}
              <div
                style={{
                  border: "1px solid rgba(255,255,255,0.10)",
                  borderRadius: 16,
                  padding: 14,
                  background: "rgba(0,0,0,0.18)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "baseline" }}>
                  <div className="kv-headline" style={{ fontSize: 16, fontWeight: 800 }}>
                    Preview
                  </div>
                  {sceneGraph ? (
                    <div style={{ opacity: 0.8, fontSize: 12 }}>
                      {sceneGraph.meta.category} / {sceneGraph.meta.subcategory} — masks: {sceneGraph.elements?.length ?? 0}
                    </div>
                  ) : null}
                </div>

                {!beforeSrc ? (
                  <div style={{ padding: 28, opacity: 0.75 }}>Upload a photo to start.</div>
                ) : afterSrc ? (
                  <div style={{ marginTop: 12 }}>
                    <BeforeAfterSlider beforeSrc={beforeSrc} afterSrc={afterSrc} />
                  </div>
                ) : (
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      marginTop: 12,
                      borderRadius: 12,
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.12)",
                    }}
                  >
                    <img
                      ref={imgRef}
                      src={basePreviewSrc || beforeSrc || ""}
                      alt="Your photo"
                      style={{ width: "100%", display: "block", transition: "opacity 200ms ease" }}
                    />
                    {showCanvas ? (
                      <canvas
                        ref={canvasRef}
                        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                      />
                    ) : null}
                  </div>
                )}

                {!afterSrc && sceneGraph ? (
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {refinedIsCurrent ? (
                      <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "rgba(212,175,55,0.18)", border: "1px solid rgba(212,175,55,0.35)" }}>
                        Photoreal refined ✓
                      </span>
                    ) : refining ? (
                      <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)" }}>
                        Refining preview…
                      </span>
                    ) : null}

                    {refineError ? (
                      <span style={{ fontSize: 12, padding: "4px 10px", borderRadius: 999, background: "rgba(255,0,0,0.10)", border: "1px solid rgba(255,0,0,0.22)", opacity: 0.9 }}>
                        Preview refine unavailable
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {isRendering ? (
                  <div style={{ marginTop: 12, opacity: 0.85 }}>Rendering photoreal preview…</div>
                ) : null}

                {afterSrc ? (
                  <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <a
                      className="kv-btn-secondary"
                      href={afterSrc}
                      download="remodel-preview.png"
                      style={{ textDecoration: "none" }}
                    >
                      Download image
                    </a>
                    <button
                      className="kv-btn-secondary"
                      onClick={() => {
                        setAfterSrc(null);
                        setJobId(null);
                      }}
                    >
                      Back to editing
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Mobile layout helper */}
            <div style={{ opacity: 0.65, fontSize: 12 }}>
              Tip: if instant preview spills onto the wrong surface, use “Edit masks” to paint/erase the mask.
            </div>
          </div>
        </div>
      </div>

      <MaskEditorModal
        open={maskEditorOpen}
        onClose={() => setMaskEditorOpen(false)}
        beforeSrc={beforeSrc || ""}
        element={(sceneGraph?.elements || []).find((e) => e.id === (maskEditorElementId ?? "")) || null}
        initialMaskDataUrl={maskOverrides[maskEditorElementId ?? ""] || null}
        onSave={(maskDataUrl) => {
          const id = maskEditorElementId ?? "";
          if (!id) return;
          setMaskOverrides((p) => ({ ...p, [id]: maskDataUrl }));
        }}
      />
    </div>
  );
}
