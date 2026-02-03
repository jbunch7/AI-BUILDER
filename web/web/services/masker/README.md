# Mask refinement service (GrabCut)

This is an optional **microservice** that turns the scanner’s coarse polygons into
**pixel-level alpha masks** for fast, clean in-browser previews.

It is designed to be:
- **Fast on CPU** (good for “preview masks”)
- **Edge-aware** (GrabCut snaps to boundaries)
- Easy to run locally or deploy anywhere you can run Python

## Run locally

```bash
cd services/masker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8080
```

Health check:

```bash
curl http://localhost:8080/health
```

## Connect the Next.js app

Set this env var for the Next.js server:

```bash
MASK_SERVICE_URL=http://localhost:8080
```

Optional shared secret:

```bash
MASK_SERVICE_SECRET=your-secret
```

If you set `MASK_SERVICE_SECRET`, the Next.js app will automatically send `x-mask-secret`.

## Endpoint

`POST /v1/masks/preview`

Input:

```json
{
  "image_base64": "...",
  "image_mime": "image/png",
  "max_side": 1200,
  "items": [
    {
      "type": "floor",
      "polygons_norm": [[[0.1,0.2],[0.2,0.2],[0.2,0.3]]],
      "confidence": 0.9
    }
  ]
}
```

Output:

```json
{
  "width": 1200,
  "height": 900,
  "max_side": 1200,
  "masks": {
    "floor": {"png_base64": "...", "confidence": 1.0, "method": "grabcut"}
  },
  "overlaps_resolved": true
}
```

The returned PNGs are **white with alpha**, so the Next.js client can use them as
canvas masks.
