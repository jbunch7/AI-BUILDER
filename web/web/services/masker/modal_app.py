import base64
import io
import os
from typing import Any, Dict

import modal

# -------------------------
# Modal image (runtime)
# -------------------------
MASKER_DIR = os.path.dirname(__file__)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libglib2.0-0")
    .pip_install(
        "fastapi==0.115.0",
        "pydantic==2.9.2",
        "uvicorn==0.30.6",
        "pillow==10.4.0",
        "numpy==2.0.2",
        "opencv-python-headless==4.10.0.84",
        "torch==2.4.1",
        "torchvision==0.19.1",
        "huggingface_hub==0.26.2",
    )
    # Modal 1.0+ way to ship local code (replaces modal.Mount)
    .add_local_dir(MASKER_DIR, remote_path="/root/masker")
)

app = modal.App("ai-builder-masker-sam2")


# -------------------------
# Helpers
# -------------------------
def _b64png_from_alpha(alpha):
    from PIL import Image
    import numpy as np

    h, w = alpha.shape[:2]
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    rgba[..., :3] = 255
    rgba[..., 3] = alpha.astype(np.uint8)

    im = Image.fromarray(rgba, mode="RGBA")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")


def _rasterize_polygon(width, height, points_norm):
    import numpy as np
    import cv2

    mask = np.zeros((height, width), dtype=np.uint8)
    if not points_norm or len(points_norm) < 3:
        return mask

    pts = []
    for x, y in points_norm:
        px = int(max(0, min(width - 1, round(x * width))))
        py = int(max(0, min(height - 1, round(y * height))))
        pts.append([px, py])

    poly = np.array([pts], dtype=np.int32)
    cv2.fillPoly(mask, poly, 255)
    return mask


def _try_sam2(image_rgb, seed_mask):
    """Best-effort SAM2 refinement. Returns uint8 alpha mask or None."""
    try:
        import sys
        import numpy as np

        # ensure vendored code is importable
        if "/root/masker" not in sys.path:
            sys.path.insert(0, "/root/masker")

        Predictor = None
        try:
            from vendor_sam2.sam2.sam2_image_predictor import SAM2ImagePredictor as Predictor
        except Exception:
            try:
                from sam2.sam2_image_predictor import SAM2ImagePredictor as Predictor
            except Exception:
                return None

        model_id = os.environ.get("SAM2_MODEL_ID", "facebook/sam2-hiera-large")
        predictor = Predictor.from_pretrained(model_id)

        predictor.set_image(image_rgb)

        ys, xs = np.where(seed_mask > 0)
        if len(xs) < 10:
            return None

        step = max(1, len(xs) // 128)
        points = np.stack([xs[::step], ys[::step]], axis=1).astype(np.float32)
        labels = np.ones((points.shape[0],), dtype=np.int32)

        out = predictor.predict(point_coords=points, point_labels=labels)
        masks = out[0] if isinstance(out, tuple) else out
        m0 = masks[0]
        if hasattr(m0, "detach"):
            m0 = m0.detach().cpu().numpy()
        return (m0 > 0.5).astype("uint8") * 255
    except Exception:
        return None


@app.function(
    image=image,
    gpu="T4",
    timeout=120,
)
@modal.asgi_app()
def fastapi_app():
    from fastapi import FastAPI
    from pydantic import BaseModel
    import numpy as np
    from PIL import Image

    api = FastAPI()

    class PreviewReq(BaseModel):
        imageDataUrl: str
        width: int
        height: int
        byType: Dict[str, Any]
        maxSide: int = 1200

    @api.get("/health")
    def health():
        return {"ok": True}

    @api.post("/v1/masks/preview")
    def preview(req: PreviewReq):
        try:
            _, b64 = req.imageDataUrl.split(",", 1)
            img = Image.open(io.BytesIO(base64.b64decode(b64))).convert("RGB")
            img = np.array(img, dtype=np.uint8)
        except Exception:
            return {
                "maxSide": req.maxSide,
                "width": req.width,
                "height": req.height,
                "source": "polygon",
                "byType": {},
            }

        h, w = img.shape[:2]
        out = {}
        used_sam2 = False

        for k, payload in (req.byType or {}).items():
            pts = None
            if isinstance(payload, dict):
                if isinstance(payload.get("points_norm"), list):
                    pts = payload["points_norm"]
                elif isinstance(payload.get("polygons"), list) and payload["polygons"]:
                    p0 = payload["polygons"][0]
                    if isinstance(p0, dict):
                        pts = p0.get("points_norm")

            seed = _rasterize_polygon(w, h, pts) if pts else np.zeros((h, w), dtype=np.uint8)
            refined = _try_sam2(img, seed)
            if refined is not None:
                used_sam2 = True
                out[k] = _b64png_from_alpha(refined)
            else:
                out[k] = _b64png_from_alpha(seed)

        return {
            "maxSide": req.maxSide,
            "width": w,
            "height": h,
            "source": "sam2" if used_sam2 else "polygon",
            "byType": out,
        }

    return api
