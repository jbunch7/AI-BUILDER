"""Mask refinement microservice (preview masks)

This service refines *coarse* polygons (from the LLM scene scanner) into
pixel-accurate alpha masks suitable for fast UI previews.

Method (default): OpenCV GrabCut seeded by the polygon region.

Why GrabCut?
- CPU-friendly
- Edge-aware (snaps to color/texture boundaries)
- Works well when you already have a coarse region proposal

The Next.js app calls:
  POST /v1/masks/preview

and receives PNG masks (white with alpha) as base64.
"""

from __future__ import annotations

import base64
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


def _clamp01(x: float) -> float:
    if x < 0.0:
        return 0.0
    if x > 1.0:
        return 1.0
    return x


class MaskItem(BaseModel):
    type: str
    polygons_norm: List[List[Tuple[float, float]]] = Field(default_factory=list)
    confidence: float = 1.0


class PreviewMaskRequest(BaseModel):
    image_base64: str
    image_mime: str = "image/png"
    max_side: int = 1200
    items: List[MaskItem]


class MaskOut(BaseModel):
    png_base64: str
    confidence: float
    method: str


class PreviewMaskResponse(BaseModel):
    width: int
    height: int
    max_side: int
    masks: Dict[str, MaskOut]
    overlaps_resolved: bool = True
    errors: Optional[Dict[str, str]] = None


app = FastAPI(title="ai-builder-masker", version="0.1.0")


# Most-specific -> most-general. Earlier types win in overlap resolution.
PRIORITY: List[str] = [
    "door",
    "windows",
    "trim",
    "cabinets",
    "countertop",
    "backsplash",
    "appliances",
    "lighting",
    "roof",
    "siding",
    "driveway",
    "deck",
    "fence",
    "landscaping",
    "floor",
    "walls",
    "ceiling",
    "other",
]


def decode_image(image_base64: str) -> np.ndarray:
    try:
        raw = base64.b64decode(image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image: {e}")

    buf = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(buf, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="Could not decode image bytes")
    return img


def resize_to_max_side(img: np.ndarray, max_side: int) -> np.ndarray:
    h, w = img.shape[:2]
    if max_side <= 0:
        return img
    scale = min(1.0, float(max_side) / float(max(w, h)))
    if scale >= 1.0:
        return img
    nw = max(1, int(round(w * scale)))
    nh = max(1, int(round(h * scale)))
    return cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)


def polygons_to_bbox(polys_px: List[np.ndarray], w: int, h: int) -> Optional[Tuple[int, int, int, int]]:
    if not polys_px:
        return None
    xs = []
    ys = []
    for p in polys_px:
        xs.append(p[:, 0])
        ys.append(p[:, 1])
    xs = np.concatenate(xs) if xs else np.array([], dtype=np.int32)
    ys = np.concatenate(ys) if ys else np.array([], dtype=np.int32)
    if xs.size == 0 or ys.size == 0:
        return None
    x0 = int(max(0, np.min(xs)))
    x1 = int(min(w - 1, np.max(xs)))
    y0 = int(max(0, np.min(ys)))
    y1 = int(min(h - 1, np.max(ys)))
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def grabcut_refine(img_bgr: np.ndarray, polys_norm: List[List[Tuple[float, float]]]) -> np.ndarray:
    """Return a binary mask (uint8 0/1) refined via GrabCut."""
    h, w = img_bgr.shape[:2]
    if not polys_norm:
        return np.zeros((h, w), dtype=np.uint8)

    polys_px: List[np.ndarray] = []
    for poly in polys_norm:
        if len(poly) < 3:
            continue
        pts = np.array(
            [[int(round(_clamp01(x) * w)), int(round(_clamp01(y) * h))] for x, y in poly],
            dtype=np.int32,
        )
        polys_px.append(pts)

    bbox = polygons_to_bbox(polys_px, w, h)
    if bbox is None:
        return np.zeros((h, w), dtype=np.uint8)

    x0, y0, x1, y1 = bbox
    # Expand bbox slightly to give GrabCut context.
    margin = int(max(12, round(0.06 * max(w, h))))
    rx0 = max(0, x0 - margin)
    ry0 = max(0, y0 - margin)
    rx1 = min(w - 1, x1 + margin)
    ry1 = min(h - 1, y1 + margin)

    roi = img_bgr[ry0 : ry1 + 1, rx0 : rx1 + 1]
    rh, rw = roi.shape[:2]
    if rh < 2 or rw < 2:
        return np.zeros((h, w), dtype=np.uint8)

    # Rasterize polygons into ROI coordinates.
    poly_mask = np.zeros((rh, rw), dtype=np.uint8)
    roi_polys: List[np.ndarray] = []
    for p in polys_px:
        rp = p.copy()
        rp[:, 0] = np.clip(rp[:, 0] - rx0, 0, rw - 1)
        rp[:, 1] = np.clip(rp[:, 1] - ry0, 0, rh - 1)
        roi_polys.append(rp)
    if not roi_polys:
        return np.zeros((h, w), dtype=np.uint8)
    cv2.fillPoly(poly_mask, roi_polys, 1)

    # If the polygon is tiny, return it as-is.
    area = int(poly_mask.sum())
    if area < 25:
        out = np.zeros((h, w), dtype=np.uint8)
        out[ry0 : ry1 + 1, rx0 : rx1 + 1] = poly_mask
        return out

    # Build GrabCut seed mask.
    # 0: sure bg, 1: sure fg, 2: probable bg, 3: probable fg
    gc = np.full((rh, rw), cv2.GC_BGD, dtype=np.uint8)
    gc[poly_mask == 1] = cv2.GC_PR_FGD

    # Erode polygon to get "sure FG" core.
    k = max(3, int(round(0.01 * max(rw, rh))))
    k = k + 1 if k % 2 == 0 else k
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    sure_fg = cv2.erode(poly_mask, kernel, iterations=1)
    gc[sure_fg == 1] = cv2.GC_FGD

    # Mark a thin border as sure background (helps prevent leaking to image edges).
    border = max(2, int(round(0.01 * max(rw, rh))))
    gc[:border, :] = cv2.GC_BGD
    gc[-border:, :] = cv2.GC_BGD
    gc[:, :border] = cv2.GC_BGD
    gc[:, -border:] = cv2.GC_BGD

    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)

    # Run GrabCut.
    try:
        cv2.grabCut(roi, gc, (0, 0, rw, rh), bgd_model, fgd_model, 4, cv2.GC_INIT_WITH_MASK)
    except Exception:
        # If GrabCut fails, fall back to the polygon.
        out = np.zeros((h, w), dtype=np.uint8)
        out[ry0 : ry1 + 1, rx0 : rx1 + 1] = poly_mask
        return out

    fg = np.where((gc == cv2.GC_FGD) | (gc == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)

    # Post-process: close small gaps, then remove speckles.
    post_k = max(3, int(round(0.006 * max(rw, rh))))
    post_k = post_k + 1 if post_k % 2 == 0 else post_k
    post_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (post_k, post_k))
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, post_kernel, iterations=1)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, post_kernel, iterations=1)

    out = np.zeros((h, w), dtype=np.uint8)
    out[ry0 : ry1 + 1, rx0 : rx1 + 1] = fg
    return out


def resolve_overlaps(masks: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    """Make masks disjoint using PRIORITY order."""
    if not masks:
        return masks

    # Ensure priority list covers existing types.
    ordered = [t for t in PRIORITY if t in masks] + [t for t in masks.keys() if t not in PRIORITY]

    h, w = next(iter(masks.values())).shape[:2]
    assigned = np.zeros((h, w), dtype=np.uint8)
    out: Dict[str, np.ndarray] = {}

    for t in ordered:
        m = masks[t].astype(np.uint8)
        # Only take unassigned pixels.
        available = np.where((m == 1) & (assigned == 0), 1, 0).astype(np.uint8)
        out[t] = available
        assigned = np.where(available == 1, 1, assigned).astype(np.uint8)

    return out


def mask_to_png_base64(mask01: np.ndarray) -> str:
    """Convert 0/1 mask to RGBA PNG (white with alpha)."""
    h, w = mask01.shape[:2]
    alpha = (mask01.astype(np.uint8) * 255)
    # BGRA for OpenCV
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[:, :, 0:3] = 255
    rgba[:, :, 3] = alpha
    ok, enc = cv2.imencode(".png", rgba)
    if not ok:
        raise RuntimeError("Failed to encode PNG")
    return base64.b64encode(enc.tobytes()).decode("utf-8")


def check_secret(x_mask_secret: Optional[str]) -> None:
    expected = None
    try:
        import os

        expected = os.environ.get("MASK_SERVICE_SECRET")
    except Exception:
        expected = None
    if expected:
        if not x_mask_secret or x_mask_secret != expected:
            raise HTTPException(status_code=403, detail="Forbidden")


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/v1/masks/preview", response_model=PreviewMaskResponse)
def preview_masks(req: PreviewMaskRequest, x_mask_secret: Optional[str] = Header(default=None)):
    check_secret(x_mask_secret)

    img = decode_image(req.image_base64)
    img = resize_to_max_side(img, int(req.max_side or 1200))
    h, w = img.shape[:2]

    masks01: Dict[str, np.ndarray] = {}
    errors: Dict[str, str] = {}

    for item in req.items:
        t = str(item.type)
        try:
            masks01[t] = grabcut_refine(img, item.polygons_norm)
        except Exception as e:
            errors[t] = str(e)

    # Resolve overlaps for cleaner UX (prevents spills between adjacent surfaces).
    masks01 = resolve_overlaps(masks01)

    out: Dict[str, MaskOut] = {}
    for t, m01 in masks01.items():
        try:
            b64 = mask_to_png_base64(m01)
            # Confidence is best-effort; we just echo a placeholder for now.
            out[t] = MaskOut(png_base64=b64, confidence=1.0, method="grabcut")
        except Exception as e:
            errors[t] = str(e)

    return PreviewMaskResponse(
        width=w,
        height=h,
        max_side=int(req.max_side or 1200),
        masks=out,
        overlaps_resolved=True,
        errors=errors or None,
    )
