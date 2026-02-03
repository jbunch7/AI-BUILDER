"""Modal entrypoint: serve the FastAPI mask service on GPU.

This file is intended to be run ONCE to create your Modal app + endpoint.
After the first run, you'll manage everything from the Modal dashboard.

It exposes the same endpoint the Vercel app expects:
  POST /v1/masks/preview
"""

import modal

CUDA_IMAGE = "nvidia/cuda:12.4.1-runtime-ubuntu22.04"

image = (
    modal.Image.from_registry(CUDA_IMAGE, add_python="3.11")
    .apt_install("libgl1", "libglib2.0-0")
    .pip_install(
        "fastapi==0.115.0",
        "pydantic==2.8.2",
        "uvicorn==0.30.6",
        "numpy==1.26.4",
        "opencv-python-headless==4.10.0.84",
        "huggingface_hub==0.25.2",
        "safetensors==0.4.5",
        # Torch wheels with CUDA are provided by Modal's CUDA base image.
        "torch==2.4.1",
        "torchvision==0.19.1",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1"})
)

app = modal.App("ai-builder-masker-sam2", image=image)

# GPU choice: A10G is a good cost/perf default. Modal will pick availability.
GPU = "A10G"

@app.function(gpu=GPU, timeout=300, allow_concurrent_inputs=10)
@modal.asgi_app()
def fastapi_app():
    # Import the existing FastAPI service from main.py
    import os
    # Default model if not set in Modal secrets/env
    os.environ.setdefault("SAM2_MODEL_ID", "facebook/sam2-hiera-large")
    import main  # services/masker/main.py
    return main.app
