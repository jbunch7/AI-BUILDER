import os
import modal

MASKER_DIR = os.path.dirname(__file__)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libglib2.0-0", "libsm6", "libxext6", "libxrender1")
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
        # Fix for: ModuleNotFoundError: No module named 'hydra'
        "hydra-core==1.3.2",
        "omegaconf==2.3.0",
        "transformers==4.44.2",
        "timm==1.0.9",
        "scipy==1.14.1",
        "pyyaml==6.0.2",
    )
    .add_local_dir(MASKER_DIR, remote_path="/root/masker")
)

app = modal.App("ai-builder-masker-sam2")

@app.function(image=image, gpu="T4", timeout=180)
@modal.asgi_app()
def fastapi_app():
    import sys
    if "/root/masker" not in sys.path:
        sys.path.insert(0, "/root/masker")
    import main  # type: ignore
    if hasattr(main, "api"):
        return main.api
    if hasattr(main, "app"):
        return main.app
    raise RuntimeError("main.py must export FastAPI as `api` or `app`")
