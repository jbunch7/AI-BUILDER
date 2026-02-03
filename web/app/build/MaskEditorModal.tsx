"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SceneElement } from "@/lib/builder/types";

type Mode = "add" | "erase";

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function rasterizePolygonMask(el: SceneElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const pts = el.mask?.points_norm;
  if (!Array.isArray(pts) || pts.length < 3) return c;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "white";
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const [nx, ny] = pts[i];
    const x = nx * w;
    const y = ny * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  return c;
}

export default function MaskEditorModal({
  open,
  onClose,
  beforeSrc,
  element,
  initialMaskDataUrl,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  beforeSrc: string;
  element: SceneElement | null;
  initialMaskDataUrl?: string | null;
  onSave: (maskDataUrl: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("add");
  const [brush, setBrush] = useState(18);
  const [feather, setFeather] = useState(6);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const maskRef = useRef<HTMLCanvasElement | null>(null);
  const baseImgRef = useRef<HTMLImageElement | null>(null);

  const title = useMemo(() => {
    if (!element) return "Mask Editor";
    return `Edit mask: ${element.label || element.type}`;
  }, [element]);

  // Initialize base + mask.
  useEffect(() => {
    if (!open) return;
    if (!element) return;

    let cancelled = false;
    (async () => {
      setBusy(true);
      setErr(null);
      try {
        const img = await loadImage(beforeSrc);
        if (cancelled) return;
        baseImgRef.current = img;

        // Cap working resolution for speed.
        const maxSide = 1200;
        const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = w;
        maskCanvas.height = h;
        const mctx = maskCanvas.getContext("2d");
        if (!mctx) throw new Error("Mask ctx missing");

        // Init from override OR polygon.
        if (initialMaskDataUrl) {
          const mimg = await loadImage(initialMaskDataUrl);
          mctx.clearRect(0, 0, w, h);
          mctx.drawImage(mimg, 0, 0, w, h);
        } else {
          const poly = rasterizePolygonMask(element, w, h);
          mctx.clearRect(0, 0, w, h);
          mctx.drawImage(poly, 0, 0);
        }

        maskRef.current = maskCanvas;

        // Setup display canvas
        const d = displayRef.current;
        if (!d) throw new Error("Display canvas missing");
        d.width = w;
        d.height = h;
        d.style.width = "100%";
        d.style.height = "auto";
        drawComposite();
      } catch (e: any) {
        setErr(e?.message ?? "Failed to init mask editor");
      } finally {
        setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, element?.id]);

  const drawComposite = () => {
    const d = displayRef.current;
    const img = baseImgRef.current;
    const mask = maskRef.current;
    if (!d || !img || !mask) return;
    const ctx = d.getContext("2d");
    if (!ctx) return;
    const w = d.width;
    const h = d.height;

    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    // Draw mask overlay (cyan)
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(mask, 0, 0, w, h);
    ctx.restore();

    // Outline (optional)
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = "rgba(212,175,55,0.95)";
    ctx.lineWidth = 2;
    // Cheap outline by drawing mask to temp and using shadow trick.
    ctx.filter = `blur(1px)`;
    ctx.drawImage(mask, 0, 0, w, h);
    ctx.filter = "none";
    ctx.restore();
  };

  const drawAt = (x: number, y: number) => {
    const d = displayRef.current;
    const mask = maskRef.current;
    if (!d || !mask) return;
    const mctx = mask.getContext("2d");
    if (!mctx) return;

    const w = d.width;
    const h = d.height;
    const nx = clamp(x, 0, w);
    const ny = clamp(y, 0, h);

    mctx.save();
    mctx.globalCompositeOperation = mode === "add" ? "source-over" : "destination-out";
    mctx.fillStyle = "white";
    mctx.beginPath();
    mctx.arc(nx, ny, brush, 0, Math.PI * 2);
    mctx.closePath();
    mctx.fill();
    mctx.restore();

    drawComposite();
  };

  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent) => {
    if (busy) return;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const scaleX = (displayRef.current?.width ?? 1) / rect.width;
    const scaleY = (displayRef.current?.height ?? 1) / rect.height;
    drawAt((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging || busy) return;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const scaleX = (displayRef.current?.width ?? 1) / rect.width;
    const scaleY = (displayRef.current?.height ?? 1) / rect.height;
    drawAt((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
  };

  const onPointerUp = () => setDragging(false);

  const onClickFeather = () => {
    // Apply a quick feather blur to the mask itself (helps edges).
    const mask = maskRef.current;
    if (!mask) return;
    const tmp = document.createElement("canvas");
    tmp.width = mask.width;
    tmp.height = mask.height;
    const tctx = tmp.getContext("2d");
    const mctx = mask.getContext("2d");
    if (!tctx || !mctx) return;
    tctx.clearRect(0, 0, tmp.width, tmp.height);
    tctx.filter = `blur(${clamp(feather, 0, 24)}px)`;
    tctx.drawImage(mask, 0, 0);
    tctx.filter = "none";
    mctx.clearRect(0, 0, mask.width, mask.height);
    mctx.drawImage(tmp, 0, 0);
    drawComposite();
  };

  const onSaveClick = () => {
    const mask = maskRef.current;
    if (!mask) return;
    const data = mask.toDataURL("image/png");
    onSave(data);
    onClose();
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.72)",
        zIndex: 50,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        className="kv-card kv-surface"
        style={{ width: "min(980px, 100%)", padding: 16, borderRadius: 18 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
            <div style={{ opacity: 0.8, fontSize: 12, marginTop: 4 }}>
              Paint to correct the surface mask. Use Add to include missed areas, Erase to remove spills.
            </div>
          </div>
          <button className="kv-btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {err ? (
          <div style={{ marginTop: 12, padding: 12, borderRadius: 12, border: "1px solid rgba(255,0,0,0.25)", background: "rgba(255,0,0,0.08)" }}>
            {err}
          </div>
        ) : null}

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 14, marginTop: 14 }}>
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className={mode === "add" ? "kv-btn" : "kv-btn-secondary"}
                onClick={() => setMode("add")}
              >
                Add
              </button>
              <button
                className={mode === "erase" ? "kv-btn" : "kv-btn-secondary"}
                onClick={() => setMode("erase")}
              >
                Erase
              </button>
            </div>

            <div style={{ opacity: 0.85, fontSize: 12 }}>Brush size: {brush}px</div>
            <input
              type="range"
              min={6}
              max={50}
              value={brush}
              onChange={(e) => setBrush(parseInt(e.target.value, 10))}
            />

            <div style={{ opacity: 0.85, fontSize: 12 }}>Feather: {feather}px</div>
            <input
              type="range"
              min={0}
              max={24}
              value={feather}
              onChange={(e) => setFeather(parseInt(e.target.value, 10))}
            />
            <button className="kv-btn-secondary" onClick={onClickFeather} disabled={busy}>
              Smooth edges
            </button>

            <div style={{ height: 1, background: "rgba(255,255,255,0.10)", margin: "6px 0" }} />

            <button className="kv-btn" onClick={onSaveClick} disabled={busy}>
              Save mask
            </button>
            <div style={{ opacity: 0.65, fontSize: 12 }}>
              Saved masks are used for instant preview and improve the final render prompt.
            </div>
          </div>

          <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(0,0,0,0.25)" }}>
            <div style={{ padding: 8, opacity: 0.8, fontSize: 12 }}>
              Tip: zoom your browser if you need more precision.
            </div>
            <div style={{ padding: 10 }}>
              <canvas
                ref={displayRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onPointerLeave={onPointerUp}
                style={{ width: "100%", height: "auto", touchAction: "none", cursor: mode === "add" ? "crosshair" : "not-allowed" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
