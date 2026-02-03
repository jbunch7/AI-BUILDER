"""Mask refinement microservice (preview masks)

This service turns *coarse* regions (polygons from the scene scanner) into
pixel-accurate alpha masks for fast UI previews.

Two methods:
- sam2 (preferred): high-accuracy segmentation using SAM 2 (GPU recommended)
- grabcut (fallback): CPU-friendly refinement seeded by polygons

The Next.js app calls:
  POST /v1/masks/preview

and receives PNG masks (white with alpha) as base64.
"""

from __future__ import annotations

import base64
import os
from typing import Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


class MaskItem(BaseModel):
    type: str
    polygons_norm: List[List[Tuple[float, float]]] = Field(default_factory=list)
    confidence: float = 1.0
    # Optional override per item
    method: Optional[str] = None


class PreviewMaskRequest(BaseModel):
    image_base64: str
    image_mime: str = "image/png"
    max_side: int = 1200
    items: List[MaskItem]
    # Global default method
    method: str = "sam2"


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


app = FastAPI(title="ai-builder-masker", version="0.2.0")

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


def polygons_to_px(polys_norm: List[List[Tuple[float, float]]], w: int, h: int) -> List[np.ndarray]:
    polys_px: List[np.ndarray] = []
    for poly in polys_norm or []:
        if len(poly) < 3:
            continue
        pts = np.array([[int(round(_clamp01(x) * w)), int(round(_clamp01(y) * h))] for x, y in poly], dtype=np.int32)
        polys_px.append(pts)
    return polys_px


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


def union_polygon_mask(h: int, w: int, polys_px: List[np.ndarray]) -> np.ndarray:
    m = np.zeros((h, w), dtype=np.uint8)
    if polys_px:
        cv2.fillPoly(m, polys_px, 1)
    return m


def grabcut_refine(img_bgr: np.ndarray, polys_norm: List[List[Tuple[float, float]]]) -> np.ndarray:
    """Return a binary mask (uint8 0/1) refined via GrabCut."""
    h, w = img_bgr.shape[:2]
    polys_px = polygons_to_px(polys_norm, w, h)
    bbox = polygons_to_bbox(polys_px, w, h)
    if bbox is None:
        return np.zeros((h, w), dtype=np.uint8)

    x0, y0, x1, y1 = bbox

    # Seed: probable FG inside polygon, probable BG outside bbox margin.
    seed = np.zeros((h, w), dtype=np.uint8)
    cv2.rectangle(seed, (x0, y0), (x1, y1), 2, thickness=-1)  # PR_BG
    cv2.fillPoly(seed, polys_px, 3)  # PR_FG

    bgdModel = np.zeros((1, 65), np.float64)
    fgdModel = np.zeros((1, 65), np.float64)

    try:
        cv2.grabCut(img_bgr, seed, None, bgdModel, fgdModel, 4, cv2.GC_INIT_WITH_MASK)
    except Exception:
        # If GrabCut fails, fall back to polygon union.
        return union_polygon_mask(h, w, polys_px)

    mask = np.where((seed == cv2.GC_FGD) | (seed == cv2.GC_PR_FGD), 1, 0).astype(np.uint8)
    return mask


# -----------------------------
# SAM2 integration (preferred)
# -----------------------------

_SAM2_PREDICTOR = None  # lazy singleton


def _load_sam2_predictor():
    """Lazy-load SAM2 predictor. Uses HF model id by default."""
    global _SAM2_PREDICTOR
    if _SAM2_PREDICTOR is not None:
        return _SAM2_PREDICTOR

    # Add vendored sam2 to path
    import sys
    here = os.path.dirname(__file__)
    vendor = os.path.join(here, "vendor_sam2")
    if vendor not in sys.path:
        sys.path.insert(0, vendor)

    try:
        import torch  # noqa
        from sam2.sam2_image_predictor import SAM2ImagePredictor  # noqa
    except Exception as e:
        raise RuntimeError(f"SAM2 import failed (missing deps?): {e}")

    model_id = os.environ.get("SAM2_MODEL_ID", "").strip() or "facebook/sam2-hiera-large"
    # If you have a local checkpoint/config, you can wire it via env later.
    # For most deployments (e.g. Modal), the HF path is simplest.
    predictor = SAM2ImagePredictor.from_pretrained(model_id)

    # Choose device
    device = "cuda" if getattr(__import__("torch"), "cuda").is_available() else "cpu"
    predictor.model.to(device)
    _SAM2_PREDICTOR = predictor
    return _SAM2_PREDICTOR


def sam2_mask(img_bgr: np.ndarray, polys_norm: List[List[Tuple[float, float]]]) -> np.ndarray:
    """Use SAM2 to refine a coarse polygon region into a pixel mask.

    Design goal: SAM2 should *refine boundaries*, not "discover" the object.
    That means we must provide a tight-ish box prompt and structured points:
      - positive points *inside* the coarse region
      - negative points just *outside* the region to prevent bleed

    We also apply light sanity checks and a second-pass refinement.
    """

    h, w = img_bgr.shape[:2]
    polys_px = polygons_to_px(polys_norm, w, h)
    bbox0 = polygons_to_bbox(polys_px, w, h)
    if bbox0 is None:
        return np.zeros((h, w), dtype=np.uint8)

    # Coarse seed mask from polygons (0/1)
    seed = union_polygon_mask(h, w, polys_px).astype(np.uint8)
    if seed.sum() < 50:
        return np.zeros((h, w), dtype=np.uint8)

    def _expand_bbox(b: Tuple[int, int, int, int], pad: int) -> Tuple[int, int, int, int]:
        x0, y0, x1, y1 = b
        return (
            max(0, x0 - pad),
            max(0, y0 - pad),
            min(w - 1, x1 + pad),
            min(h - 1, y1 + pad),
        )

    def _sample_points(mask01: np.ndarray, k: int) -> np.ndarray:
        """Return up to k (x,y) points inside mask01. Deterministic-ish."""
        ys, xs = np.where(mask01 > 0)
        if xs.size == 0:
            return np.zeros((0, 2), dtype=np.float32)
        # Take evenly-spaced indices for determinism
        step = max(1, xs.size // max(1, k))
        idx = np.arange(0, xs.size, step)[:k]
        pts = np.stack([xs[idx], ys[idx]], axis=1).astype(np.float32)
        return pts

    def _center_point(mask01: np.ndarray) -> np.ndarray:
        ys, xs = np.where(mask01 > 0)
        if xs.size == 0:
            return np.zeros((0, 2), dtype=np.float32)
        return np.array([[float(xs.mean()), float(ys.mean())]], dtype=np.float32)

    def _sanity(mask01: np.ndarray, bbox: Tuple[int, int, int, int]) -> bool:
        """Reject obvious junk masks."""
        area = int(mask01.sum())
        if area < 100:
            return False
        # If it's basically the whole image, reject
        if area > int(0.85 * h * w):
            return False
        x0, y0, x1, y1 = bbox
        bbox_area = max(1, (x1 - x0) * (y1 - y0))
        # If it floods essentially the whole bbox, it's usually a slab.
        # Keep this loose: floors/roofs can legitimately fill most of a tight box.
        if area > int(0.985 * bbox_area):
            return False
        # Border-touch heuristic (too much border contact + big area = likely overreach).
        touches = 0
        if mask01[0, :].any():
            touches += 1
        if mask01[-1, :].any():
            touches += 1
        if mask01[:, 0].any():
            touches += 1
        if mask01[:, -1].any():
            touches += 1
        if touches >= 3 and area > int(0.55 * bbox_area):
            return False
        return True

    # Prepare SAM2 inputs
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    predictor = _load_sam2_predictor()
    predictor.set_image(img_rgb)

    # Build prompts
    x0, y0, x1, y1 = bbox0
    pad = int(max(8, 0.03 * max(x1 - x0, y1 - y0)))
    bbox = _expand_bbox(bbox0, pad)
    bx0, by0, bx1, by1 = bbox

    # Positive points: center + a few interior points from an eroded seed
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    inner = cv2.erode(seed * 255, kernel, iterations=1)
    inner01 = (inner > 0).astype(np.uint8)
    pos = np.concatenate([_center_point(inner01), _sample_points(inner01, 6)], axis=0)
    if pos.shape[0] == 0:
        pos = _center_point(seed)

    # Negative points: sample from a ring just outside the seed (within expanded bbox)
    dil = cv2.dilate(seed * 255, kernel, iterations=2)
    ring = ((dil > 0) & (seed == 0)).astype(np.uint8)
    ring_crop = ring[by0:by1, bx0:bx1]
    neg_local = _sample_points(ring_crop, 10)
    if neg_local.shape[0] > 0:
        neg = neg_local.copy()
        neg[:, 0] += bx0
        neg[:, 1] += by0
    else:
        neg = np.zeros((0, 2), dtype=np.float32)

    # Combine points
    pts = np.concatenate([pos, neg], axis=0)
    labels = np.concatenate([
        np.ones((pos.shape[0],), dtype=np.int32),
        np.zeros((neg.shape[0],), dtype=np.int32),
    ], axis=0)

    box = np.array([bx0, by0, bx1, by1], dtype=np.float32)

    masks, scores, _ = predictor.predict(
        box=box,
        point_coords=pts if pts.shape[0] else None,
        point_labels=labels if pts.shape[0] else None,
        multimask_output=True,
    )

    if masks is None or len(masks) == 0:
        return np.zeros((h, w), dtype=np.uint8)

    # Choose best candidate by (IoU with seed) + score, with area penalty.
    seed_area = float(seed.sum())
    seed01 = (seed > 0).astype(np.uint8)
    best_idx = -1
    best_val = -1e9
    for i in range(len(masks)):
        m01 = masks[i].astype(np.uint8)
        area = float(m01.sum())
        inter = float((m01 & seed01).sum())
        union = float((m01 | seed01).sum())
        iou = inter / union if union > 0 else 0.0
        bbox_area = float(max(1, (bx1 - bx0) * (by1 - by0)))
        area_pen = min(1.0, area / bbox_area)
        val = (0.7 * iou) + (0.3 * float(scores[i])) - (0.25 * area_pen)
        if val > best_val:
            best_val = val
            best_idx = i

    m = masks[best_idx].astype(np.uint8)

    # Second-pass refinement: tighten box around first mask and re-run once.
    ys, xs = np.where(m > 0)
    if xs.size > 50:
        bx0b = int(max(0, xs.min()))
        bx1b = int(min(w - 1, xs.max()))
        by0b = int(max(0, ys.min()))
        by1b = int(min(h - 1, ys.max()))
        bbox1 = _expand_bbox((bx0b, by0b, bx1b, by1b), pad)
        b1x0, b1y0, b1x1, b1y1 = bbox1
        box1 = np.array([b1x0, b1y0, b1x1, b1y1], dtype=np.float32)

        # Use points from the first mask (more informative than the original polygon)
        inner2 = cv2.erode(m.astype(np.uint8) * 255, kernel, iterations=1)
        pos2 = np.concatenate([_center_point(inner2 > 0), _sample_points((inner2 > 0).astype(np.uint8), 6)], axis=0)
        dil2 = cv2.dilate(m.astype(np.uint8) * 255, kernel, iterations=2)
        ring2 = ((dil2 > 0) & (m == 0)).astype(np.uint8)
        ring2_crop = ring2[b1y0:b1y1, b1x0:b1x1]
        neg2_local = _sample_points(ring2_crop, 10)
        if neg2_local.shape[0] > 0:
            neg2 = neg2_local.copy()
            neg2[:, 0] += b1x0
            neg2[:, 1] += b1y0
        else:
            neg2 = np.zeros((0, 2), dtype=np.float32)

        pts2 = np.concatenate([pos2, neg2], axis=0)
        labels2 = np.concatenate([
            np.ones((pos2.shape[0],), dtype=np.int32),
            np.zeros((neg2.shape[0],), dtype=np.int32),
        ], axis=0)

        masks2, scores2, _ = predictor.predict(
            box=box1,
            point_coords=pts2 if pts2.shape[0] else None,
            point_labels=labels2 if pts2.shape[0] else None,
            multimask_output=True,
        )
        if masks2 is not None and len(masks2) > 0:
            # pick best by IoU with first mask + score
            m01 = m.astype(np.uint8)
            best2 = 0
            bestv2 = -1e9
            for i in range(len(masks2)):
                cand = masks2[i].astype(np.uint8)
                inter = float((cand & m01).sum())
                union = float((cand | m01).sum())
                iou2 = inter / union if union > 0 else 0.0
                val2 = 0.75 * iou2 + 0.25 * float(scores2[i])
                if val2 > bestv2:
                    bestv2 = val2
                    best2 = i
            m = masks2[best2].astype(np.uint8)
            bbox = bbox1

    # Keep largest component (helps remove speckle)
    try:
        num, lab, stats, _ = cv2.connectedComponentsWithStats(m.astype(np.uint8), connectivity=8)
        if num > 1:
            # skip background row 0
            areas = stats[1:, cv2.CC_STAT_AREA]
            keep = 1 + int(np.argmax(areas))
            m = (lab == keep).astype(np.uint8)
    except Exception:
        pass

    # Final sanity gate. If it fails, return empty and let caller fall back.
    if not _sanity(m, bbox):
        return np.zeros((h, w), dtype=np.uint8)

    return m


def to_png_base64(mask01: np.ndarray) -> str:
    """Convert mask 0/1 to a PNG (white with alpha) base64 string."""
    h, w = mask01.shape[:2]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., 0:3] = 255
    rgba[..., 3] = (mask01.astype(np.uint8) * 255)
    ok, buf = cv2.imencode(".png", rgba)
    if not ok:
        raise RuntimeError("PNG encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def resolve_overlaps(masks: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    """Resolve overlaps by priority: earlier types win."""
    h = next(iter(masks.values())).shape[0]
    w = next(iter(masks.values())).shape[1]
    taken = np.zeros((h, w), dtype=np.uint8)
    out: Dict[str, np.ndarray] = {}
    for t in PRIORITY:
        if t not in masks:
            continue
        m = masks[t].copy()
        m[taken == 1] = 0
        out[t] = m
        taken = np.where((taken == 1) | (m == 1), 1, 0).astype(np.uint8)

    # Any leftover types not in PRIORITY keep what's left
    for t, m in masks.items():
        if t in out:
            continue
        mm = m.copy()
        mm[taken == 1] = 0
        out[t] = mm
        taken = np.where((taken == 1) | (mm == 1), 1, 0).astype(np.uint8)
    return out


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/v1/masks/preview", response_model=PreviewMaskResponse)
def preview_masks(
    req: PreviewMaskRequest,
    x_mask_secret: Optional[str] = Header(default=None, alias="X-Mask-Secret"),
):
    secret = os.environ.get("MASK_SERVICE_SECRET", "").strip()
    if secret and x_mask_secret != secret:
        raise HTTPException(status_code=401, detail="Unauthorized")

    img = decode_image(req.image_base64)
    img = resize_to_max_side(img, req.max_side)
    h, w = img.shape[:2]

    errors: Dict[str, str] = {}
    raw_masks: Dict[str, np.ndarray] = {}
    used_by_type: Dict[str, str] = {}

    for item in req.items:
        method = (item.method or req.method or "sam2").lower().strip()
        try:
            if method == "sam2":
                m = sam2_mask(img, item.polygons_norm)
                used = "sam2"
                # If SAM2 returns empty (common when prompts are poor), gracefully fall back.
                if m.sum() == 0:
                    m = grabcut_refine(img, item.polygons_norm)
                    used = "grabcut-fallback"
            elif method == "grabcut":
                m = grabcut_refine(img, item.polygons_norm)
                used = "grabcut"
            else:
                # Fallback to polygon union
                polys_px = polygons_to_px(item.polygons_norm, w, h)
                m = union_polygon_mask(h, w, polys_px)
                used = "polygon"
            raw_masks[item.type] = m.astype(np.uint8)
            used_by_type[item.type] = used
        except Exception as e:
            # If SAM2 fails (e.g., missing deps), fall back to grabcut then polygon.
            try:
                m = grabcut_refine(img, item.polygons_norm)
                raw_masks[item.type] = m.astype(np.uint8)
                used = "grabcut-fallback"
                used_by_type[item.type] = used
            except Exception as e2:
                polys_px = polygons_to_px(item.polygons_norm, w, h)
                raw_masks[item.type] = union_polygon_mask(h, w, polys_px)
                used = "polygon-fallback"
                errors[item.type] = f"{method} failed: {e}; fallback: {e2}"
                used_by_type[item.type] = used
            else:
                errors[item.type] = f"{method} failed: {e}; used {used}"
                used_by_type[item.type] = used

    resolved = resolve_overlaps(raw_masks) if raw_masks else {}

    out: Dict[str, MaskOut] = {}
    for t, m in resolved.items():
        out[t] = MaskOut(
            png_base64=to_png_base64(m),
            confidence=1.0,
            method=used_by_type.get(t, (req.method or "mixed")),
        )

    return PreviewMaskResponse(width=w, height=h, max_side=req.max_side, masks=out, overlaps_resolved=True, errors=errors or None)
