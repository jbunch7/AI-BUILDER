"""Modal entrypoint for the masker service.

This file exists only to deploy the FastAPI app in main.py onto Modal.
It keeps the runtime environment (deps + vendored SAM2 code) bundled,
and exposes the same HTTP API the Next.js app expects:

  POST /v1/masks/preview
  GET  /health

IMPORTANT:
- The actual masking logic lives in main.py.
- This file should stay thin and stable.
"""

import os
import modal


MASKER_DIR = os.path.dirname(__file__)


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
        "iopath>=0.1.10",
        "torch>=2.5.1",
        "torchvision>=0.20.1",
        "huggingface_hub>=0.26.2",
        "transformers>=4.48.0",
        "safetensors>=0.4.5",
        "timm>=1.0.11",
    )
    # Bundle the whole masker directory so imports like `vendor_sam2` and `main` work.
    .add_local_dir(MASKER_DIR, remote_path="/root/masker")
)


app = modal.App("ai-builder-masker-sam2")


@app.function(image=image, gpu="T4", timeout=180)
@modal.asgi_app()
def fastapi_app():
    # Import the FastAPI app from the bundled code.
    import sys

    if "/root/masker" not in sys.path:
        sys.path.insert(0, "/root/masker")

    from main import app as api  # noqa: WPS433

    return api
