"""Modal deployment entrypoint for the mask refinement service.

This file exists solely to run the *existing* FastAPI service defined in `main.py`
on Modal (GPU).

Why:
- The Next.js app already calls `/v1/masks/preview` with the `image_base64/items[]` payload.
- `services/masker/main.py` implements that contract and includes SAM2 + fallbacks.
- Modal apps are created from code execution; this file is the one you deploy.

Deploy (PowerShell):
  cd services\masker
  python -m modal deploy modal_app.py
"""

import os

import modal


MASKER_DIR = os.path.dirname(__file__)


# Keep dependencies aligned with `requirements.txt` so SAM2 can actually import.
# NOTE: SAM2 uses Hydra + OmegaConf internally.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libglib2.0-0")
    .pip_install(
        "fastapi==0.115.6",
        "uvicorn[standard]==0.30.6",
        "numpy==2.1.3",
        "opencv-python-headless==4.10.0.84",
        "pillow>=9.4.0",
        "tqdm>=4.66.1",
        "hydra-core>=1.3.2",
        "omegaconf>=2.3.0",
        "iopath>=0.1.10",
        "huggingface_hub>=0.26.2",
        "torch>=2.4.1",
        "torchvision>=0.19.1",
    )
    # Ship the entire masker folder (including vendor_sam2/) into the container.
    .add_local_dir(MASKER_DIR, remote_path="/root/masker")
)


app = modal.App("ai-builder-masker-sam2")


@app.function(image=image, gpu="T4", timeout=120)
@modal.asgi_app()
def fastapi_app():
    # Ensure /root/masker is importable.
    import sys

    if "/root/masker" not in sys.path:
        sys.path.insert(0, "/root/masker")

    # Import and return the FastAPI app from main.py
    from main import app as api

    return api
