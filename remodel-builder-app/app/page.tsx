"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { BuilderModule, SceneGraph, BuilderOption } from "@/lib/builder/types";

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

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

export default function Page() {
  const [file, setFile] = useState<File | null>(null);
  const [beforeSrc, setBeforeSrc] = useState<string | null>(null);

  const [scanId, setScanId] = useState<string | null>(null);
  const [sceneGraph, setSceneGraph] = useState<SceneGraph | null>(null);
  const [modules, setModules] = useState<BuilderModule[]>([]);
  const [selections, setSelections] = useState<Record<string, string>>({});

  const [jobId, setJobId] = useState<string | null>(null);
  const [afterSrc, setAfterSrc] = useState<string | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [previewEnabled, setPreviewEnabled] = useState(true);
  const [debugMasks, setDebugMasks] = useState(false);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const step = useMemo(() => {
    if (!beforeSrc) return 1;
    if (isScanning) return 2;
    if (!sceneGraph) return 2;
    if (isRendering) return 4;
    if (afterSrc) return 5;
    return 3;
  }, [beforeSrc, isScanning, sceneGraph, isRendering, afterSrc]);

  async function onPickFile(f: File) {
    setError(null);
    setAfterSrc(null);
    setJobId(null);
    setScanId(null);
    setSceneGraph(null);
    setModules([]);
    setSelections({});

    setFile(f);
    setBeforeSrc(await fileToDataUrl(f));
  }

  async function runScan() {
    if (!file) return;
    setError(null);
    setIsScanning(true);

    try {
      const fd = new FormData();
      fd.append("image", file);

      const res = await fetch("/api/scan", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || "Scan failed");

      setScanId(data.scanId);
      setSceneGraph(data.sceneGraph);

      // Fetch options
      const res2 = await fetch("/api/options", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scanId: data.scanId }),
      });
      const data2 = await res2.json().catch(() => ({}));
      if (!res2.ok) throw new Error(data2?.error || data2?.message || "Options failed");

      setModules(data2.modules || []);
      setSelections(data2.defaultSelections || {});
    } catch (e: any) {
      setError(e?.message ?? "Scan failed");
    } finally {
      setIsScanning(false);
    }
  }

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
        body: JSON.stringify({ scanId, selections }),
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

  // Overlay preview
  useEffect(() => {
    if (!previewEnabled) return;
    if (!sceneGraph) return;
    if (!imgRef.current) return;
    if (!canvasRef.current) return;

    const img = imgRef.current;
    const canvas = canvasRef.current;

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

      // Normalize for devicePixelRatio
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, rect.width, rect.height);

      // For each module with overlay preview, apply its selected color within target masks.
      for (const m of modules) {
        if (m.previewMode !== "overlay") continue;
        const selected = findSelectedOption(m, selections);
        if (!isColorPreview(selected)) continue;
        const hex = selected.preview.hex;

        const targets = new Set(m.targetElementTypes);
        const elems = (sceneGraph.elements || []).filter((e) => targets.has(e.type));
        if (elems.length === 0) continue;

        // Choose blend mode. Walls/ceiling look best with 'color' when available.
        const preferColorBlend = m.featureId.includes("paint") || m.featureId.includes("color");

        for (const el of elems) {
          const pts = el?.mask?.points_norm;
          if (!Array.isArray(pts) || pts.length < 3) continue;

          ctx.save();
          ctx.beginPath();
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (!Array.isArray(p) || p.length !== 2) continue;
            const x = p[0] * rect.width;
            const y = p[1] * rect.height;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.closePath();

          // Mask clip
          ctx.clip();

          // Fill overlay
          const baseAlpha = m.featureId === "flooring" ? 0.55 : 0.48;
          ctx.globalAlpha = baseAlpha;

          // Attempt 'color' blend for paint-like updates (fallback to multiply)
          const desired = preferColorBlend ? ("color" as GlobalCompositeOperation) : ("multiply" as GlobalCompositeOperation);
          ctx.globalCompositeOperation = desired;
          // Some browsers may not support 'color' on <canvas>; fallback.
          if (preferColorBlend && ctx.globalCompositeOperation !== desired) {
            ctx.globalCompositeOperation = "multiply";
          }

          ctx.fillStyle = hex;
          ctx.fillRect(0, 0, rect.width, rect.height);

          // Debug outline
          if (debugMasks) {
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = "source-over";
            ctx.strokeStyle = "rgba(212,175,55,0.95)";
            ctx.lineWidth = 2;
            ctx.stroke();
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
  }, [previewEnabled, sceneGraph, modules, selections, debugMasks]);

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
              <input
                className="kv-input"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null;
                  if (f) void onPickFile(f);
                }}
                style={{ maxWidth: 420 }}
              />

              <button className="kv-btn" onClick={() => void runScan()} disabled={!file || isScanning}>
                {isScanning ? "Scanning…" : "Scan photo"}
              </button>

              <button
                className="kv-btn-secondary"
                onClick={() => void runRender()}
                disabled={!scanId || !sceneGraph || isScanning || isRendering}
              >
                {isRendering ? "Rendering…" : "Render photoreal"}
              </button>

              {sceneGraph ? (
                <div style={{ opacity: 0.85 }}>
                  Detected: <b>{sceneGraph.meta?.subcategory || "unknown"}</b> ({sceneGraph.meta?.category})
                </div>
              ) : null}
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
                    <img ref={imgRef} src={beforeSrc} alt="Your photo" style={{ width: "100%", display: "block" }} />
                    {previewEnabled ? (
                      <canvas
                        ref={canvasRef}
                        style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
                      />
                    ) : null}
                  </div>
                )}

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
              Tip: if masks look off, enable “Show masks”. Next step is adding a simple “paint/erase mask” corrector.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
