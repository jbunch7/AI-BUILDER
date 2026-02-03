"""Mask refinement microservice (preview masks)

Goal: Generate pixel-accurate surface masks for a remodeling visualizer.

Key design:
- DO NOT trust LLM polygons for geometry (they're often slabs).
- Use coarse localization (open-vocab box detection) to get tight regions.
- Use SAM2 as a *boundary refiner* with:
  - box-first prompts
  - structured positive points
  - negative ring points + forbidden-zone negatives
  - two-pass refinement
  - scoring + retries before fallback
- Apply lightweight postprocessing and overlap resolution.

API:
  POST /v1/masks/preview
Payload matches Next.js lib/masking.ts:
  { image_base64, image_mime, max_side, scene?, items:[{type, polygons_norm}] }

Returns:
  { width, height, max_side, masks: {type:{png_base64, confidence, method}}, errors? }
"""

from __future__ import annotations

import base64
import os
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field


# -----------------------------
# Request / response models
# -----------------------------

def _clamp01(x: float) -> float:
    return 0.0 if x < 0.0 else 1.0 if x > 1.0 else x


class SceneHint(BaseModel):
    category: Optional[str] = None
    subcategory: Optional[str] = None


class MaskItem(BaseModel):
    type: str
    polygons_norm: List[List[Tuple[float, float]]] = Field(default_factory=list)
    confidence: float = 1.0


class PreviewMaskRequest(BaseModel):
    image_base64: str
    image_mime: str = "image/png"
    max_side: int = 1200
    scene: Optional[SceneHint] = None
    items: List[MaskItem]


class MaskOut(BaseModel):
    png_base64: str
    confidence: float = 1.0
    method: str = "sam2"


class PreviewMaskResponse(BaseModel):
    width: int
    height: int
    max_side: int
    masks: Dict[str, MaskOut]
    errors: Optional[Dict[str, str]] = None


app = FastAPI(title="ai-builder-masker", version="0.3.0")


# -----------------------------
# Utilities
# -----------------------------

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


def to_png_base64(mask01: np.ndarray) -> str:
    h, w = mask01.shape[:2]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = (mask01.astype(np.uint8) * 255)
    ok, buf = cv2.imencode(".png", rgba)
    if not ok:
        raise RuntimeError("PNG encode failed")
    return base64.b64encode(buf.tobytes()).decode("ascii")


def bbox_from_mask(mask01: np.ndarray) -> Optional[Tuple[int, int, int, int]]:
    ys, xs = np.where(mask01 > 0)
    if xs.size == 0 or ys.size == 0:
        return None
    x0 = int(xs.min())
    x1 = int(xs.max())
    y0 = int(ys.min())
    y1 = int(ys.max())
    if x1 <= x0 or y1 <= y0:
        return None
    return x0, y0, x1, y1


def expand_box(box: Tuple[int, int, int, int], w: int, h: int, pad: int) -> Tuple[int, int, int, int]:
    x0, y0, x1, y1 = box
    x0 = max(0, x0 - pad)
    y0 = max(0, y0 - pad)
    x1 = min(w - 1, x1 + pad)
    y1 = min(h - 1, y1 + pad)
    return x0, y0, x1, y1


def box_area(box: Tuple[int, int, int, int]) -> int:
    x0, y0, x1, y1 = box
    return max(0, x1 - x0 + 1) * max(0, y1 - y0 + 1)


def mask_area(mask01: np.ndarray) -> int:
    return int(mask01.sum())


def largest_component(mask01: np.ndarray, min_keep: int = 50) -> np.ndarray:
    # Keep the largest connected component
    if mask01.sum() == 0:
        return mask01
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask01.astype(np.uint8), connectivity=8)
    if num <= 1:
        return mask01
    # Skip background (0)
    areas = stats[1:, cv2.CC_STAT_AREA]
    idx = int(np.argmax(areas)) + 1
    if stats[idx, cv2.CC_STAT_AREA] < min_keep:
        return np.zeros_like(mask01, dtype=np.uint8)
    out = (labels == idx).astype(np.uint8)
    return out


def clean_mask(mask01: np.ndarray) -> np.ndarray:
    if mask01.sum() == 0:
        return mask01
    k = 3
    kernel = np.ones((k, k), np.uint8)
    m = cv2.morphologyEx(mask01.astype(np.uint8), cv2.MORPH_CLOSE, kernel, iterations=1)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, kernel, iterations=1)
    return m.astype(np.uint8)


def count_components(mask01: np.ndarray, min_area: int = 30) -> int:
    if mask01.sum() == 0:
        return 0
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask01.astype(np.uint8), connectivity=8)
    if num <= 1:
        return 0
    areas = stats[1:, cv2.CC_STAT_AREA]
    return int(np.sum(areas >= min_area))


def touches_border(mask01: np.ndarray, border: str) -> bool:
    h, w = mask01.shape[:2]
    if border == "top":
        return bool(mask01[0, :].sum() > 0)
    if border == "bottom":
        return bool(mask01[h - 1, :].sum() > 0)
    if border == "left":
        return bool(mask01[:, 0].sum() > 0)
    if border == "right":
        return bool(mask01[:, w - 1].sum() > 0)
    return False


def border_touch_count(mask01: np.ndarray) -> int:
    return sum(int(touches_border(mask01, b)) for b in ["top", "bottom", "left", "right"])


# -----------------------------
# Scene + class profiles
# -----------------------------

@dataclass(frozen=True)
class ClassProfile:
    labels: List[str]
    allow_multiple: bool = False
    # expected vertical region hint (0..1)
    y_pref: Optional[str] = None  # "top" | "middle" | "bottom" | None
    # area fraction bounds (relative to image)
    area_min: float = 0.001
    area_max: float = 0.90
    # overlap forbidden types
    forbid: Tuple[str, ...] = ()
    # border expectations (reward/penalize)
    wants_border: Tuple[str, ...] = ()
    forbids_border: Tuple[str, ...] = ()


CLASS_PROFILES: Dict[str, ClassProfile] = {
    # Interior common
    "floor": ClassProfile(labels=["floor", "carpet", "tile floor", "wood floor", "concrete floor"], y_pref="bottom", area_min=0.05, area_max=0.75, wants_border=("bottom",), forbids_border=("top",)),
    "ceiling": ClassProfile(labels=["ceiling"], y_pref="top", area_min=0.03, area_max=0.75, wants_border=("top",), forbids_border=("bottom",)),
    "walls": ClassProfile(labels=["wall", "interior wall"], y_pref="middle", area_min=0.05, area_max=0.95, forbids_border=()),
    # Kitchen
    "cabinets": ClassProfile(labels=["kitchen cabinets", "cabinetry"], y_pref="middle", area_min=0.02, area_max=0.60, forbid=("countertop", "backsplash", "appliances", "floor")),
    "countertop": ClassProfile(labels=["countertop", "kitchen counter"], y_pref="middle", area_min=0.005, area_max=0.20, forbid=("cabinets", "backsplash")),
    "backsplash": ClassProfile(labels=["backsplash", "tile backsplash"], y_pref="middle", area_min=0.003, area_max=0.25, forbid=("countertop", "cabinets")),
    "appliances": ClassProfile(labels=["stove", "oven", "dishwasher", "refrigerator", "microwave"], allow_multiple=True, y_pref="middle", area_min=0.001, area_max=0.40, forbid=("walls", "floor", "cabinets")),
    # Exterior
    "siding": ClassProfile(labels=["house siding", "exterior wall"], y_pref="middle", area_min=0.05, area_max=0.95, forbid=("windows", "door", "roof", "garage_door")),
    "roof": ClassProfile(labels=["roof"], y_pref="top", area_min=0.02, area_max=0.60, wants_border=("top",)),
    "door": ClassProfile(labels=["front door", "door"], allow_multiple=True, y_pref="middle", area_min=0.001, area_max=0.10),
    "windows": ClassProfile(labels=["window"], allow_multiple=True, y_pref="middle", area_min=0.001, area_max=0.25),
    "driveway": ClassProfile(labels=["driveway", "concrete driveway"], y_pref="bottom", area_min=0.02, area_max=0.70, wants_border=("bottom",)),
    "walkway": ClassProfile(labels=["walkway", "sidewalk"], y_pref="bottom", area_min=0.005, area_max=0.40, wants_border=("bottom",)),
    "fence": ClassProfile(labels=["fence"], allow_multiple=False, y_pref="middle", area_min=0.01, area_max=0.60),
    "deck": ClassProfile(labels=["deck", "patio"], y_pref="bottom", area_min=0.01, area_max=0.70, wants_border=("bottom",)),
    "landscaping": ClassProfile(labels=["grass", "lawn", "yard", "landscaping"], y_pref="bottom", area_min=0.02, area_max=0.90),
    "trim": ClassProfile(labels=["trim", "exterior trim", "baseboard"], allow_multiple=False, y_pref="middle", area_min=0.001, area_max=0.30),
    "garage_door": ClassProfile(labels=["garage door"], allow_multiple=True, y_pref="middle", area_min=0.005, area_max=0.30),
}


PRIORITY: List[str] = [
    # small / foreground
    "windows",
    "door",
    "garage_door",
    "appliances",
    "trim",
    "backsplash",
    "countertop",
    "cabinets",
    # exterior large
    "roof",
    "siding",
    "fence",
    "deck",
    "driveway",
    "walkway",
    "landscaping",
    # interior large
    "floor",
    "walls",
    "ceiling",
]


def scene_kind(scene: Optional[SceneHint]) -> str:
    if not scene:
        return "unknown"
    cat = (scene.category or "").lower()
    sub = (scene.subcategory or "").lower()
    if cat == "exterior" or any(k in sub for k in ["front", "back", "side", "yard", "backyard", "exterior"]):
        return "exterior"
    if cat == "interior":
        return "interior"
    return "unknown"


def prior_bonus(profile: ClassProfile, box: Tuple[int, int, int, int], w: int, h: int) -> float:
    x0, y0, x1, y1 = box
    cy = 0.5 * (y0 + y1) / max(1.0, float(h))
    if profile.y_pref == "top":
        return 0.15 if cy < 0.35 else -0.05
    if profile.y_pref == "bottom":
        return 0.15 if cy > 0.65 else -0.05
    if profile.y_pref == "middle":
        return 0.10 if 0.25 < cy < 0.75 else -0.05
    return 0.0


# -----------------------------
# Coarse localization (GroundingDINO via transformers)
# -----------------------------

_DINO_MODEL = None
_DINO_PROC = None


def _load_dino():
    global _DINO_MODEL, _DINO_PROC
    if _DINO_MODEL is not None and _DINO_PROC is not None:
        return _DINO_MODEL, _DINO_PROC

    model_id = os.environ.get("DINO_MODEL_ID", "IDEA-Research/grounding-dino-tiny").strip() or "IDEA-Research/grounding-dino-tiny"
    device = "cuda" if os.environ.get("FORCE_CPU", "") != "1" else "cpu"

    try:
        # Prefer explicit GroundingDINO classes if available
        from transformers import GroundingDinoProcessor, GroundingDinoForObjectDetection  # type: ignore
        proc = GroundingDinoProcessor.from_pretrained(model_id)
        model = GroundingDinoForObjectDetection.from_pretrained(model_id)
    except Exception:
        from transformers import AutoProcessor, AutoModelForZeroShotObjectDetection  # type: ignore
        proc = AutoProcessor.from_pretrained(model_id)
        model = AutoModelForZeroShotObjectDetection.from_pretrained(model_id)

    import torch
    model.to(device)
    model.eval()

    _DINO_MODEL, _DINO_PROC = model, proc
    return _DINO_MODEL, _DINO_PROC


def _detect_boxes(img_rgb: np.ndarray, text: str, box_thresh: float, text_thresh: float) -> List[Tuple[Tuple[int, int, int, int], float]]:
    """Return list of (box, score) in pixel coords."""
    model, proc = _load_dino()
    import torch

    device = next(model.parameters()).device
    h, w = img_rgb.shape[:2]

    inputs = proc(images=img_rgb, text=text, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)

    # Post-process: try multiple processor APIs
    boxes_scores: List[Tuple[Tuple[int, int, int, int], float]] = []
    target_sizes = torch.tensor([[h, w]], device=device)

    # GroundingDINO processors often expose post_process_grounded_object_detection
    post = None
    for name in [
        "post_process_grounded_object_detection",
        "post_process_grounding_dino",
        "post_process_object_detection",
    ]:
        if hasattr(proc, name):
            post = getattr(proc, name)
            break

    if post is None:
        return []

    try:
        results = post(outputs, inputs.get("input_ids", None), box_threshold=box_thresh, text_threshold=text_thresh, target_sizes=target_sizes)
    except TypeError:
        # Some versions use different args
        results = post(outputs, target_sizes=target_sizes)

    if not results:
        return []

    r0 = results[0]
    # r0 should have boxes + scores
    r_boxes = r0.get("boxes") if isinstance(r0, dict) else getattr(r0, "boxes", None)
    r_scores = r0.get("scores") if isinstance(r0, dict) else getattr(r0, "scores", None)

    if r_boxes is None or r_scores is None:
        return []

    r_boxes = r_boxes.detach().to("cpu").numpy()
    r_scores = r_scores.detach().to("cpu").numpy()

    for b, s in zip(r_boxes, r_scores):
        x0, y0, x1, y1 = [int(round(v)) for v in b.tolist()]
        x0 = max(0, min(w - 1, x0))
        x1 = max(0, min(w - 1, x1))
        y0 = max(0, min(h - 1, y0))
        y1 = max(0, min(h - 1, y1))
        if x1 <= x0 or y1 <= y0:
            continue
        boxes_scores.append(((x0, y0, x1, y1), float(s)))
    # sort high score
    boxes_scores.sort(key=lambda x: x[1], reverse=True)
    return boxes_scores


# -----------------------------
# SAM2 integration
# -----------------------------

_SAM2_PREDICTOR = None


def _load_sam2_predictor():
    global _SAM2_PREDICTOR
    if _SAM2_PREDICTOR is not None:
        return _SAM2_PREDICTOR

    # Add vendored sam2 to path
    import sys
    here = os.path.dirname(__file__)
    vendor = os.path.join(here, "vendor_sam2")
    if vendor not in sys.path:
        sys.path.insert(0, vendor)

    from sam2.sam2_image_predictor import SAM2ImagePredictor

    model_id = os.environ.get("SAM2_MODEL_ID", "").strip() or "facebook/sam2-hiera-large"
    predictor = SAM2ImagePredictor.from_pretrained(model_id)

    import torch
    device = "cuda" if torch.cuda.is_available() and os.environ.get("FORCE_CPU", "") != "1" else "cpu"
    predictor.model.to(device)
    _SAM2_PREDICTOR = predictor
    return _SAM2_PREDICTOR


def _sample_points_from_mask(mask01: np.ndarray, n: int, mode: str = "pos") -> List[Tuple[int, int]]:
    """Structured sampling: attempt to cover space. mask01 is 0/1."""
    ys, xs = np.where(mask01 > 0)
    if xs.size == 0:
        return []
    h, w = mask01.shape[:2]

    # Stratify into grid
    g = int(max(1, round(np.sqrt(n))))
    pts: List[Tuple[int, int]] = []
    for gy in range(g):
        for gx in range(g):
            if len(pts) >= n:
                break
            x_min = int(gx * w / g)
            x_max = int((gx + 1) * w / g)
            y_min = int(gy * h / g)
            y_max = int((gy + 1) * h / g)
            # select pixels in this cell
            cell = np.where((xs >= x_min) & (xs < x_max) & (ys >= y_min) & (ys < y_max))[0]
            if cell.size == 0:
                continue
            idx = int(cell[cell.size // 2])
            pts.append((int(xs[idx]), int(ys[idx])))
    # If not enough, pad with random subset
    if len(pts) < n:
        idxs = np.linspace(0, xs.size - 1, num=min(n - len(pts), xs.size), dtype=int)
        for i in idxs:
            pts.append((int(xs[i]), int(ys[i])))
            if len(pts) >= n:
                break
    return pts[:n]


def _ring_mask(w: int, h: int, inner: Tuple[int, int, int, int], pad: int) -> np.ndarray:
    x0, y0, x1, y1 = inner
    outer = expand_box(inner, w, h, pad)
    ox0, oy0, ox1, oy1 = outer
    ring = np.zeros((h, w), dtype=np.uint8)
    ring[oy0:oy1 + 1, ox0:ox1 + 1] = 1
    ring[y0:y1 + 1, x0:x1 + 1] = 0
    return ring


def _mask_from_box(w: int, h: int, box: Tuple[int, int, int, int]) -> np.ndarray:
    x0, y0, x1, y1 = box
    m = np.zeros((h, w), dtype=np.uint8)
    m[y0:y1 + 1, x0:x1 + 1] = 1
    return m


def _apply_forbidden_zones(neg_mask: np.ndarray, forbid_boxes: List[Tuple[int, int, int, int]]) -> np.ndarray:
    h, w = neg_mask.shape[:2]
    m = neg_mask.copy()
    for b in forbid_boxes:
        x0, y0, x1, y1 = b
        m[y0:y1 + 1, x0:x1 + 1] = 1
    return m


def _sam2_predict_masks(
    img_rgb: np.ndarray,
    box: Tuple[int, int, int, int],
    pos_pts: List[Tuple[int, int]],
    neg_pts: List[Tuple[int, int]],
) -> Tuple[List[np.ndarray], List[float]]:
    predictor = _load_sam2_predictor()
    predictor.set_image(img_rgb)

    box_np = np.array([box[0], box[1], box[2], box[3]], dtype=np.float32)

    pts = []
    lbls = []
    for x, y in pos_pts:
        pts.append([x, y])
        lbls.append(1)
    for x, y in neg_pts:
        pts.append([x, y])
        lbls.append(0)

    pts_np = np.array(pts, dtype=np.float32) if pts else None
    lbls_np = np.array(lbls, dtype=np.int32) if lbls else None

    masks, scores, _ = predictor.predict(
        point_coords=pts_np,
        point_labels=lbls_np,
        box=box_np,
        multimask_output=True,
        return_logits=False,
        normalize_coords=True,
    )

    out_masks: List[np.ndarray] = []
    out_scores: List[float] = []
    if masks is None or len(masks) == 0:
        return out_masks, out_scores
    for m, s in zip(masks, scores):
        out_masks.append((m > 0.0).astype(np.uint8))
        out_scores.append(float(s))
    return out_masks, out_scores


def _score_candidate(
    profile: ClassProfile,
    cand: np.ndarray,
    sam_score: float,
    box: Tuple[int, int, int, int],
    forbid_boxes: List[Tuple[int, int, int, int]],
) -> float:
    h, w = cand.shape[:2]
    area = mask_area(cand)
    if area <= 0:
        return -1e9

    frac = area / float(h * w)
    if frac < profile.area_min or frac > profile.area_max:
        return -1e9

    # penalize fragmentation
    comps = count_components(cand, min_area=50)
    frag_pen = 0.05 * max(0, comps - (2 if profile.allow_multiple else 1))

    # border preferences
    bpen = 0.0
    for b in profile.forbids_border:
        if touches_border(cand, b):
            bpen += 0.15
    for b in profile.wants_border:
        if not touches_border(cand, b):
            bpen += 0.10

    # forbid overlap penalty
    fpen = 0.0
    for fb in forbid_boxes:
        x0, y0, x1, y1 = fb
        overlap = cand[y0:y1 + 1, x0:x1 + 1].sum()
        if overlap > 0:
            fpen += 0.10

    # area relative to box
    ba = float(box_area(box))
    if ba > 0:
        ar = area / ba
        if ar < 0.15:
            fpen += 0.10
        if ar > 1.25:
            fpen += 0.15

    return sam_score - frag_pen - bpen - fpen


def _refine_type(
    img_bgr: np.ndarray,
    img_rgb: np.ndarray,
    t: str,
    profile: ClassProfile,
    scene: Optional[SceneHint],
    boxes_by_type: Dict[str, List[Tuple[Tuple[int, int, int, int], float]]],
    forbid_boxes_by_type: Dict[str, List[Tuple[int, int, int, int]]],
) -> Tuple[np.ndarray, Optional[str]]:
    """Return (mask01, error_message)."""
    h, w = img_rgb.shape[:2]
    box_candidates = boxes_by_type.get(t, [])
    if not box_candidates:
        # Heuristic fallback boxes for universal types
        if t == "floor":
            box = (0, int(0.55 * h), w - 1, h - 1)
        elif t == "ceiling":
            box = (0, 0, w - 1, int(0.35 * h))
        elif t == "walls":
            box = (0, int(0.05 * h), w - 1, int(0.75 * h))
        else:
            return np.zeros((h, w), dtype=np.uint8), f"no coarse boxes for {t}"
        box_candidates = [(box, 0.01)]

    # choose best candidate with priors
    best_box = None
    best_score = -1e9
    for box, sc in box_candidates[:10]:
        s = float(sc) + prior_bonus(profile, box, w, h)
        if s > best_score:
            best_score = s
            best_box = box
    assert best_box is not None

    forbid_boxes = forbid_boxes_by_type.get(t, [])

    # Build negative ring + forbidden zones
    ring = _ring_mask(w, h, best_box, pad=max(10, int(0.02 * max(w, h))))
    neg_mask = _apply_forbidden_zones(ring, forbid_boxes)

    # Additional class priors via negative masks
    if t in ("floor", "driveway", "walkway", "deck", "landscaping"):
        # forbid top half
        neg_mask[: int(0.45 * h), :] = 1
    if t in ("ceiling", "roof"):
        # forbid bottom half
        neg_mask[int(0.60 * h) :, :] = 1

    # Positives from eroded box region
    coarse = _mask_from_box(w, h, best_box)
    kernel = np.ones((7, 7), np.uint8)
    interior = cv2.erode(coarse, kernel, iterations=1)
    pos_pts = _sample_points_from_mask(interior, n=12)

    neg_pts = _sample_points_from_mask(neg_mask, n=20)

    # Retry loop (2 passes, with retries)
    last_err = None
    cur_box = best_box
    for attempt in range(3):
        masks1, scores1 = _sam2_predict_masks(img_rgb, cur_box, pos_pts, neg_pts)
        if not masks1:
            last_err = "sam2 returned no masks"
            # tighten/expand box alternate
            cur_box = expand_box(cur_box, w, h, pad=12)
            continue

        # score + choose
        scored = []
        for m, s in zip(masks1, scores1):
            m = clean_mask(m)
            if not profile.allow_multiple:
                m = largest_component(m)
            sc = _score_candidate(profile, m, s, cur_box, forbid_boxes)
            scored.append((sc, m))
        scored.sort(key=lambda x: x[0], reverse=True)
        best_m = scored[0][1]
        if scored[0][0] < -1e8:
            last_err = "all masks failed gating"
            # increase negatives density by expanding ring
            neg_mask = _ring_mask(w, h, cur_box, pad=max(15, int(0.03 * max(w, h))))
            neg_mask = _apply_forbidden_zones(neg_mask, forbid_boxes)
            neg_pts = _sample_points_from_mask(neg_mask, n=30)
            continue

        # pass 2 refinement
        bb = bbox_from_mask(best_m)
        if bb is not None:
            bb2 = expand_box(bb, w, h, pad=max(6, int(0.01 * max(w, h))))
            interior2 = cv2.erode(_mask_from_box(w, h, bb2), kernel, iterations=1)
            pos2 = _sample_points_from_mask(interior2, n=16)
            ring2 = _ring_mask(w, h, bb2, pad=max(12, int(0.02 * max(w, h))))
            ring2 = _apply_forbidden_zones(ring2, forbid_boxes)
            if t in ("floor", "driveway", "walkway", "deck", "landscaping"):
                ring2[: int(0.45 * h), :] = 1
            if t in ("ceiling", "roof"):
                ring2[int(0.60 * h) :, :] = 1
            neg2 = _sample_points_from_mask(ring2, n=32)

            masks2, scores2 = _sam2_predict_masks(img_rgb, bb2, pos2, neg2)
            if masks2:
                best2 = None
                best2sc = -1e9
                for m, s in zip(masks2, scores2):
                    m = clean_mask(m)
                    if not profile.allow_multiple:
                        m = largest_component(m)
                    sc = _score_candidate(profile, m, s, bb2, forbid_boxes)
                    if sc > best2sc:
                        best2sc = sc
                        best2 = m
                if best2 is not None and best2sc > -1e8:
                    return best2.astype(np.uint8), None

        return best_m.astype(np.uint8), None

    return np.zeros((h, w), dtype=np.uint8), last_err or "unknown failure"


def resolve_overlaps(masks: Dict[str, np.ndarray]) -> Dict[str, np.ndarray]:
    if not masks:
        return {}
    h, w = next(iter(masks.values())).shape[:2]
    taken = np.zeros((h, w), dtype=np.uint8)
    out: Dict[str, np.ndarray] = {}
    for t in PRIORITY:
        if t not in masks:
            continue
        m = masks[t].copy()
        m[taken == 1] = 0
        out[t] = m
        taken = np.where((taken == 1) | (m == 1), 1, 0).astype(np.uint8)
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

    img_bgr = decode_image(req.image_base64)
    img_bgr = resize_to_max_side(img_bgr, req.max_side)
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    h, w = img_rgb.shape[:2]

    # Determine which classes to process
    types = [it.type for it in req.items if it.type]
    types = list(dict.fromkeys(types))  # unique preserve order

    errors: Dict[str, str] = {}
    masks_out: Dict[str, np.ndarray] = {}

    # Coarse boxes per type (detector)
    boxes_by_type: Dict[str, List[Tuple[Tuple[int, int, int, int], float]]] = {}
    box_thresh = float(os.environ.get("DINO_BOX_THRESHOLD", "0.25"))
    text_thresh = float(os.environ.get("DINO_TEXT_THRESHOLD", "0.25"))

    for t in types:
        prof = CLASS_PROFILES.get(t)
        if prof is None:
            continue
        # Build text prompt (GroundingDINO prefers period-separated phrases)
        text = ". ".join(prof.labels) + "."
        try:
            boxes_by_type[t] = _detect_boxes(img_rgb, text, box_thresh, text_thresh)
        except Exception as e:
            # detector failure shouldn't kill; we'll fall back to heuristics
            errors[t] = f"coarse detector failed: {e}"

    # Forbidden boxes: from detected boxes of other types.
    forbid_boxes_by_type: Dict[str, List[Tuple[int, int, int, int]]] = {t: [] for t in types}
    # Precompute best boxes for each type for forbids
    best_box_for_type: Dict[str, Tuple[int, int, int, int]] = {}
    for t in types:
        cand = boxes_by_type.get(t, [])
        if cand:
            best_box_for_type[t] = cand[0][0]

    for t in types:
        prof = CLASS_PROFILES.get(t)
        if not prof:
            continue
        fb: List[Tuple[int, int, int, int]] = []
        for other in prof.forbid:
            if other in best_box_for_type:
                fb.append(best_box_for_type[other])
        forbid_boxes_by_type[t] = fb

    # Run SAM2 refinement
    for t in types:
        prof = CLASS_PROFILES.get(t)
        if prof is None:
            continue

        if prof.allow_multiple and boxes_by_type.get(t):
            # run per-box and union
            union = np.zeros((h, w), dtype=np.uint8)
            for box, _sc in boxes_by_type[t][:3]:
                m, err = _refine_type(img_bgr, img_rgb, t, prof, req.scene, {t: [(box, _sc)]}, forbid_boxes_by_type)
                union = np.where((union == 1) | (m == 1), 1, 0).astype(np.uint8)
            union = clean_mask(union)
            masks_out[t] = union
        else:
            m, err = _refine_type(img_bgr, img_rgb, t, prof, req.scene, boxes_by_type, forbid_boxes_by_type)
            if err:
                errors[t] = (errors.get(t, "") + ("; " if errors.get(t) else "") + err)
            masks_out[t] = m

    # Resolve overlaps
    resolved = resolve_overlaps(masks_out)

    out: Dict[str, MaskOut] = {}
    for t, m in resolved.items():
        out[t] = MaskOut(png_base64=to_png_base64(m), confidence=1.0, method="sam2")

    return PreviewMaskResponse(width=w, height=h, max_side=req.max_side, masks=out, errors=errors or None)
