import os
import modal

# Modal entrypoint for the masker service.
# Deploy from this directory:
#   python -m modal deploy modal_app.py

MASKER_DIR = os.path.dirname(__file__)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libglib2.0-0")
    .pip_install(
        # API server
        "fastapi==0.115.6",
        "uvicorn[standard]==0.30.6",
        "pydantic==2.9.2",
        # Image + math
        "numpy==2.1.3",
        "pillow==10.4.0",
        "opencv-python-headless==4.10.0.84",
        # ML
        "torch>=2.5.1",
        "torchvision>=0.20.1",
        # Open-vocabulary coarse localization (GroundingDINO via transformers)
        "transformers==4.46.2",
        "accelerate==0.34.2",
        "timm==1.0.11",
        "safetensors>=0.4.5",
    )
    # Ship the whole masker folder (including vendor_sam2) into the container.
    .add_local_dir(MASKER_DIR, remote_path="/root/masker")
)

app = modal.App("ai-builder-masker-sam2")


@app.function(
    image=image,
    gpu="T4",
    timeout=300,
)
@modal.asgi_app()
def fastapi_app():
    import sys

    if "/root/masker" not in sys.path:
        sys.path.insert(0, "/root/masker")

    # Serve the FastAPI app defined in main.py (keeps Next.js contract intact).
    from main import app as api

    return api
