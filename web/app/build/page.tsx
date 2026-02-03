"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { BuilderModule, SceneGraph, BuilderOption } from "@/lib/builder/types";
import { useWizard } from "../providers";

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
  const { s: ws, setSelections: setWizardSelections } = useWizard();

  const beforeSrc = ws.beforeSrc;
  const promptedSrc = ws.promptedSrc;
  const scanId = ws.scanId;
  const sceneGraph = ws.sceneGraph as SceneGraph | null;
  const modules = ws.modules || [];

  const [selections, setSelections] = useState<Record<string, string>>(ws.selections || {});

  // Progressive refinement
  const [refinedBaseSrc, setRefinedBaseSrc] = useState<string | null>(null);
  const [refining, setRefining] = useState(false);
  const [refineError, setRefineError] = useState<string | null>(null);
  const [lastRefinedKey, setLastRefinedKey] = useState<string | null>(null);
  const refineCache = useRef<Map<string, string>>(new Map());
  const refineAbort = useRef<AbortController | null>(null);

  // Preview renderer refs
  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const textureCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const polyMaskCanvasCache = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Slider "after" snapshot
  const [afterSnapshotSrc, setAfterSnapshotSrc] = useState<string | null>(null);

  // Guard: must have upload + scan + prompted baseline
  useEffect(() => {
    if (!beforeSrc) router.replace("/upload");
  }, [beforeSrc, router]);

  useEffect(() => {
    // Keep wizard selections synced
    setWizardSelections(selections);
  }, [selections, setWizardSelections]);

  const currentRefineKey = useMemo(() => {
    const payload = {
      scanId,
      selections,
      extras: ws.extras || {},
      userPrompt: ws.userPrompt || "",
      base: "prompted",
    };
    return hashString(stableStringify(payload));
  }, [scanId, selections, ws.extras, ws.userPrompt]);

  const basePreviewSrc = refinedBaseSrc ?? promptedSrc ?? beforeSrc;
  const refinedIsCurrent = Boolean(refinedBaseSrc && lastRefinedKey && currentRefineKey && lastRefinedKey === currentRefineKey);

  const precomputedReady = useMemo(() => {
    return ws.overlayStatus === "ready" && ws.overlayAssets && Object.keys(ws.overlayAssets).length > 0;
  }, [ws.overlayStatus, ws.overlayAssets]);

  // Debounced refine — only when user pauses
  useEffect(() => {
    if (!scanId) return;
    if (!beforeSrc || !promptedSrc) return;

    // If we already have a cached refined image for this exact state, use it.
    const cached = refineCache.current.get(currentRefineKey);
    if (cached) {
      setRefinedBaseSrc(cached);
      setLastRefinedKey(currentRefineKey);
      setRefining(false);
      setRefineError(null);
      return;
    }

    // Debounce
    setRefineError(null);
    const t = window.setTimeout(async () => {
      try {
        // Cancel any in-flight refine
        if (refineAbort.current) refineAbort.current.abort();
        const ac = new AbortController();
        refineAbort.current = ac;

        setRefining(true);

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
        if (!res.ok) throw new Error(data?.error || data?.message || "Refine failed");

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
  }, [scanId, beforeSrc, promptedSrc, currentRefineKey, selections, ws.extras, ws.userPrompt]);

  // Precomputed overlay renderer (fast path)
  useEffect(() => {
    if (!precomputedReady) return;
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

      // When the photoreal refine is current, the base image already includes changes.
      if (refinedIsCurrent) return;

      // When the photoreal refine is current, the base image already includes changes.
      if (refinedIsCurrent) return;

      for (const m of modules) {
        if (m.previewMode !== "overlay") continue;
        const selected = findSelectedOption(m, selections);
        if (!selected) continue;
        const overlaySrc = ws.overlayAssets?.[m.featureId]?.[selected.id];
        if (!overlaySrc) continue;

        const overlayImg = ensureImg(overlaySrc, textureCache.current, draw);
        if (!overlayImg.complete) continue;
        try {
          ctx.drawImage(overlayImg, 0, 0, rect.width, rect.height);
        } catch {
          // ignore
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
  }, [precomputedReady, ws.overlayAssets, refinedIsCurrent, sceneGraph, modules, selections]);

  // Instant preview renderer (fallback path while overlays are still precomputing)
  useEffect(() => {
    if (precomputedReady) return;
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

      // When the photoreal refine is current, the base image already includes changes.
      // Clear overlays to avoid double-applying.
      if (refinedIsCurrent) return;

      for (const m of modules) {
        if (m.previewMode !== "overlay") continue;
        const selected = findSelectedOption(m, selections);
        if (!selected || !selected.preview) continue;

        const targets = new Set(m.targetElementTypes);
        const elems = (sceneGraph.elements || []).filter((e) => targets.has(e.type));
        if (elems.length === 0) continue;

        const preferColorBlend = m.featureId.includes("paint") || m.featureId.includes("color") || m.featureId.includes("cabinets");
        const desiredBlend = preferColorBlend ? ("color" as GlobalCompositeOperation) : ("multiply" as GlobalCompositeOperation);

        let textureImg: HTMLImageElement | null = null;
        if (selected.preview.kind === "image") {
          textureImg = ensureImg(selected.preview.src, textureCache.current, draw);
          if (!textureImg.complete) continue;
        }

        for (const el of elems) {
          const pts = el?.mask?.points_norm;
          if (!Array.isArray(pts) || pts.length < 3) continue;

          ctx.save();
          ctx.globalAlpha = m.featureId === "flooring" ? 0.72 : 0.58;
          ctx.globalCompositeOperation = desiredBlend;
          if (preferColorBlend && ctx.globalCompositeOperation !== desiredBlend) {
            ctx.globalCompositeOperation = "multiply";
          }

          // Draw overlay source across full frame
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

          // Mask down via feathered polygon
          ctx.globalCompositeOperation = "destination-in";
          ctx.globalAlpha = 1;
          const maskCanvas = makeFeatheredPolyMask(el.id, pts, Math.round(rect.width), Math.round(rect.height), feather);
          ctx.drawImage(maskCanvas, 0, 0);

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
  }, [precomputedReady, refinedIsCurrent, sceneGraph, modules, selections]);

  // Snapshot for slider (base image + overlay canvas)
  useEffect(() => {
    if (!imgRef.current) return;
    if (!canvasRef.current) return;

    let raf = 0;
    const capture = () => {
      const img = imgRef.current!;
      const overlay = canvasRef.current!;
      const rect = img.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;

      const out = document.createElement("canvas");
      out.width = Math.max(1, Math.round(rect.width));
      out.height = Math.max(1, Math.round(rect.height));
      const ctx = out.getContext("2d");
      if (!ctx) return;

      // draw base preview image from the DOM element
      try {
        ctx.drawImage(img, 0, 0, out.width, out.height);
      } catch {
        return;
      }

      // overlay canvas is already at display size via style; draw it scaled
      try {
        ctx.drawImage(overlay, 0, 0, out.width, out.height);
      } catch {
        // ignore
      }

      try {
        setAfterSnapshotSrc(out.toDataURL("image/png"));
      } catch {
        // ignore
      }
    };

    const t = window.setTimeout(() => {
      raf = window.requestAnimationFrame(capture);
    }, 180);

    return () => {
      window.clearTimeout(t);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [basePreviewSrc, selections, refinedIsCurrent]);

  const step = useMemo(() => {
    if (!beforeSrc) return 1;
    if (ws.scanStatus === "scanning") return 2;
    if (!promptedSrc) return 3;
    return 4;
  }, [beforeSrc, promptedSrc, ws.scanStatus]);

  const canShowBuilder = Boolean(beforeSrc && scanId && sceneGraph && promptedSrc);

  return (
    <div style={{ minHeight: "100vh", padding: "28px 16px", display: "grid", placeItems: "center" }}>
      <div className="kv-card kv-surface kv-app-card" style={{ width: "min(1100px, 100%)", padding: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div className="kv-headline" style={{ fontSize: 22, fontWeight: 900, letterSpacing: -0.4 }}>
              Remodel Builder
            </div>
            <div style={{ opacity: 0.85, marginTop: 6 }}>
              Mix & match options instantly. We’ll auto-refine toward photoreal while you explore.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              className="kv-btn-secondary"
              onClick={() => {
                setRefinedBaseSrc(null);
                setLastRefinedKey(null);
                setRefineError(null);
                // keep cache; user can come back to refined state quickly
              }}
              disabled={!promptedSrc}
              title="Return to the baseline image generated from your prompt"
            >
              Back to prompted image
            </button>

            <button className="kv-btn-secondary" onClick={() => router.push("/prompt")}>Edit prompt</button>
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
              <Step label="Prompt" state={step > 3 ? "done" : step === 3 ? "active" : "todo"} />
              <Step label="Build" state={step === 4 ? "active" : "todo"} />
            </div>

            {ws.scanError ? (
              <div style={{ padding: 12, borderRadius: 12, background: "rgba(255,0,0,0.10)", border: "1px solid rgba(255,0,0,0.25)" }}>
                <div style={{ fontWeight: 900 }}>Scan error</div>
                <div style={{ opacity: 0.9, marginTop: 6 }}>{ws.scanError}</div>
              </div>
            ) : null}

            {!promptedSrc ? (
              <div style={{ opacity: 0.85, fontSize: 13 }}>
                Your baseline image is generated on the prompt step. If you skipped it, go back to the prompt page.
              </div>
            ) : null}

            {refineError ? (
              <div style={{ padding: 12, borderRadius: 12, background: "rgba(255,165,0,0.10)", border: "1px solid rgba(255,165,0,0.25)" }}>
                <div style={{ fontWeight: 900 }}>Refine notice</div>
                <div style={{ opacity: 0.9, marginTop: 6 }}>{refineError}</div>
              </div>
            ) : null}

            {ws.scanStatus === "ready" ? (
              <div style={{ opacity: 0.85, fontSize: 13 }}>
                Instant options: {ws.overlayStatus === "ready" ? "Ready ✓" : ws.overlayStatus === "building" ? `Preparing… ${Math.round((ws.overlayProgress || 0) * 100)}%` : ws.overlayStatus === "error" ? `Error: ${ws.overlayError || "failed"}` : "Queued"}
              </div>
            ) : null}
          </div>

          {!canShowBuilder ? null : (
            <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 16, alignItems: "start" }}>
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
                  Pick your options
                </div>
                <div style={{ opacity: 0.8, marginTop: 6, fontSize: 13 }}>
                  Colors/materials are curated per room type for mix-and-match consistency.
                </div>

                <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
                  {modules.map((m) => {
                    const selected = findSelectedOption(m, selections);

                    return (
                      <div key={m.featureId} style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 12 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ fontWeight: 800 }}>{m.label}</div>
                          <div style={{ opacity: 0.75, fontSize: 12 }}>
                            {m.previewMode === "overlay" ? "Instant" : "Applied in photoreal refine"}
                          </div>
                        </div>

                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 10 }}>
                          {m.options.map((opt) => {
                            const isSelected = selected?.id === opt.id;
                            const preview = opt.preview;

                            const swatchStyle: React.CSSProperties = {
                              height: 28,
                              width: 28,
                              borderRadius: 999,
                              border: isSelected
                                ? "2px solid rgba(212,175,55,0.95)"
                                : "1px solid rgba(255,255,255,0.18)",
                              background: preview?.kind === "color" ? preview.hex : "rgba(255,255,255,0.10)",
                              ...(preview?.kind === "image"
                                ? {
                                    backgroundImage: `url(${preview.src})`,
                                    backgroundSize: "cover",
                                    backgroundPosition: "center",
                                  }
                                : {}),
                              boxShadow: isSelected ? "0 0 0 4px rgba(212,175,55,0.12)" : "none",
                              cursor: "pointer",
                            };

                            return (
                              <div key={opt.id} style={{ display: "grid", justifyItems: "center", gap: 6 }}>
                                <div
                                  title={opt.label}
                                  style={swatchStyle}
                                  onClick={() => {
                                    setSelections((s0) => ({ ...s0, [m.featureId]: opt.id }));
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
                    Live preview
                  </div>
                  <div style={{ opacity: 0.8, fontSize: 12 }}>
                    {sceneGraph?.meta?.category} / {sceneGraph?.meta?.subcategory} • {refining ? "Refining…" : refinedIsCurrent ? "Photoreal refined ✓" : "Instant"}
                  </div>
                </div>

                {/* Slider always active */}
                {beforeSrc && afterSnapshotSrc ? (
                  <div style={{ marginTop: 12 }}>
                    <BeforeAfterSlider beforeSrc={beforeSrc} afterSrc={afterSnapshotSrc} />
                  </div>
                ) : null}

                {/* Base preview + overlay (used to generate afterSnapshotSrc) */}
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
                  <img ref={imgRef} src={basePreviewSrc || ""} alt="Preview" style={{ width: "100%", display: "block" }} />
                  <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, pointerEvents: "none" }} />

                  {!promptedSrc ? (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        display: "grid",
                        placeItems: "center",
                        background: "rgba(0,0,0,0.55)",
                        color: "var(--kv-offwhite)",
                        fontWeight: 800,
                      }}
                    >
                      Generate your baseline on the prompt step.
                    </div>
                  ) : null}
                </div>

                {refining ? (
                  <div style={{ marginTop: 12, opacity: 0.85, fontSize: 13 }}>
                    Refining toward photoreal…
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
