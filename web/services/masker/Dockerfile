FROM python:3.11-slim

WORKDIR /app

# OpenCV deps (headless) + common libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code + vendored SAM2
COPY . /app

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
