# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Personal Assistant API - Dockerfile tuned for Render's FREE web service tier
#   - 512 MB RAM / shared CPU  -> single uvicorn worker, no heavyweight extras
#   - ephemeral disk           -> chat_sessions/uploads/generated_images do
#                                  NOT survive restarts or redeploys on the
#                                  free plan (see README section on this)
#   - $PORT is injected by Render at runtime, not fixed at build time
# ---------------------------------------------------------------------------
FROM python:3.12-slim

# Keep Python from writing .pyc files / buffering stdout (so `render logs`
# shows output immediately) and stop pip's cache from bloating the image.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# System packages required by the file tools:
#   - tesseract-ocr (+ Arabic pack) : pytesseract / OCR fallback in read_pdf,
#                                      called with lang="eng+ara"
#   - poppler-utils                 : pdf2image's convert_from_bytes
# Combined into one layer and cleaned up immediately to keep the image lean.
RUN apt-get update && apt-get install -y --no-install-recommends \
        tesseract-ocr \
        tesseract-ocr-ara \
        poppler-utils \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps in their own layer so code changes don't bust the
# dependency cache on every rebuild.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY . .

# Writable dirs the app creates at runtime anyway (os.makedirs(..., exist_ok=True)
# in api.py / memory.py) - created here too so they exist even before first write.
RUN mkdir -p chat_sessions uploads generated_images

# Run as a non-root user (Render doesn't require this, but it's good hygiene
# and these dirs are already owned correctly since we created them above).
RUN useradd --create-home --uid 1000 appuser \
    && chown -R appuser:appuser /app
USER appuser

# Documentation only - Render ignores EXPOSE and routes to whatever $PORT
# the process actually binds (set below).
EXPOSE 8000

# Render sets $PORT at runtime; default to 8000 for local `docker run`.
# Single worker: the free tier's 512 MB / shared vCPU can't reliably support
# more, and Render only ever routes to one instance on that plan anyway.
CMD ["sh", "-c", "uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
