"""
FastAPI streaming layer for the agent defined in agent.py.

Streams events to the client over Server-Sent Events (SSE) so the frontend
can render answer tokens as they're generated, plus tool-call lifecycle
events (tool_start / tool_args_chunk / tool_end) for a "thinking..." UI.

Run:
    pip install fastapi "uvicorn[standard]"
    uvicorn api:app --reload --port 8000

Test from the terminal:
    curl -N -X POST http://localhost:8000/chat/stream \
      -H "Content-Type: application/json" \
      -d '{"session_id": "demo", "message": "what is the weather in Cairo?"}'
"""
import os
import re
import json
import uuid
import base64
import shutil
import logging
import asyncio
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent import CustomAgentExecutor, QueueCallbackHandler

logger = logging.getLogger("api")
logging.basicConfig(level="INFO")

app = FastAPI(title="Personal Assistant Agent API")

# Comma-separated list of allowed frontend origins, e.g.
#   CORS_ORIGINS=http://localhost:8080,https://myapp.com
# Defaults to common local Vite dev ports if unset.
_default_origins = "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173"
_allowed_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", _default_origins).split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    # NOTE: allow_credentials=True together with allow_origins=["*"] is invalid
    # per the CORS spec and browsers will reject it. We don't use cookies/auth
    # here, so credentials stay off; if you add auth later, keep an explicit
    # origin list (never "*") when you turn this on.
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------------- file uploads -----------------------------------------------------
UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# -------------------------- generated images -----------------------------------------------------
# Tools like generate_image return base64 in-memory. We never send that
# base64 blob back over SSE (it would blow up message size and defeats the
# whole point of streaming) -- instead we save it once here and hand the
# frontend a small URL it can put straight into an <img src>.
GENERATED_DIR = os.environ.get("GENERATED_DIR", "generated_images")
os.makedirs(GENERATED_DIR, exist_ok=True)
app.mount("/static/generated", StaticFiles(directory=GENERATED_DIR), name="generated")


def _save_generated_image(image_base64: str, mime_type: str = "image/jpeg") -> str:
    ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(mime_type, "jpg")
    filename = f"{uuid.uuid4().hex}.{ext}"
    dest = os.path.join(GENERATED_DIR, filename)
    with open(dest, "wb") as f:
        f.write(base64.b64decode(image_base64))
    return f"/static/generated/{filename}"


_SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    """Strip path separators and anything else that isn't a normal filename
    character, so a crafted filename can't escape UPLOAD_DIR."""
    name = os.path.basename(name)
    name = _SAFE_NAME_RE.sub("_", name)
    return name or "file"


# One CustomAgentExecutor per session_id, cached so conversation memory
# persists across requests for the same session instead of being rebuilt
# (and losing history) on every call.
_executors: dict[str, CustomAgentExecutor] = {}


def _get_executor(session_id: str) -> CustomAgentExecutor:
    if session_id not in _executors:
        _executors[session_id] = CustomAgentExecutor(session_id=session_id)
    return _executors[session_id]


class ChatRequest(BaseModel):
    session_id: str = Field(..., description="Stable ID for this conversation/user")
    message: str = Field(..., min_length=1, description="The user's message")
    max_iterations: int | None = Field(
        None, description="Override the agent's default tool-call loop limit for this request"
    )


def _sse(event_type: str, data) -> str:
    """Format one Server-Sent Event. `data` is JSON-encoded; the browser's
    EventSource / fetch-stream reader splits on the blank line after each
    event, so every event MUST end with a double newline."""
    payload = json.dumps({"type": event_type, **data}, ensure_ascii=False, default=str)
    return f"data: {payload}\n\n"


async def _event_stream(req: ChatRequest) -> AsyncIterator[str]:
    executor = _get_executor(req.session_id)
    if req.max_iterations:
        executor.max_iterations = req.max_iterations

    queue: asyncio.Queue = asyncio.Queue()
    streamer = QueueCallbackHandler(queue)

    try:
        async for event in executor.stream(req.message, streamer):
            etype = event.get("type")

            if etype == "answer_chunk":
                yield _sse("answer_chunk", {"content": event["content"]})

            elif etype == "answer":
                yield _sse("answer", {"content": event["content"]})

            elif etype == "tool_start":
                yield _sse("tool_start", {"tool": event["tool"]})

            elif etype == "tool_args_chunk":
                yield _sse("tool_args_chunk", {"chunk": event["chunk"]})

            elif etype == "tool_end":
                # Never put base64 blobs on the wire over SSE -- persist
                # once and hand back a small URL the frontend can use in
                # an <img src> directly. Everything else passes through,
                # capped so one huge tool result can't balloon the event.
                result = event["result"]
                data = getattr(result, "data", result)
                if isinstance(data, dict) and "image_base64" in data:
                    mime_type = data.get("mime_type", "image/jpeg")
                    try:
                        url_path = _save_generated_image(data["image_base64"], mime_type)
                        summary = {
                            "note": "image generated",
                            "mime_type": mime_type,
                            "url": url_path,  # frontend prefixes with its API base URL
                        }
                    except Exception:
                        logger.exception("Failed to persist generated image (session=%s)", req.session_id)
                        summary = {"note": "image generated but could not be saved"}
                else:
                    text = json.dumps(data, default=str) if not isinstance(data, str) else data
                    if len(text) > 4000:
                        summary = text[:4000] + f"... [truncated, {len(text)} chars total]"
                    else:
                        summary = data
                yield _sse("tool_end", {"tool": event["tool"], "result": summary})

            elif etype == "error":
                yield _sse("error", {"content": event["content"]})

            elif etype == "done":
                yield _sse("done", {})

    except Exception as e:
        logger.exception("Unhandled error streaming session=%s", req.session_id)
        yield _sse("error", {"content": f"Internal error: {e}"})
        yield _sse("done", {})


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")

    return StreamingResponse(
        _event_stream(req),
        media_type="text/event-stream",
        headers={
            # Prevent proxies/load balancers from buffering the stream,
            # which would defeat the whole point of SSE.
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


class UploadResponse(BaseModel):
    path: str
    name: str
    size: int


@app.post("/upload", response_model=UploadResponse)
async def upload_file(session_id: str = Form(...), file: UploadFile = File(...)):
    """Saves an uploaded file to disk and returns its absolute path, so the
    agent's file tools (read_pdf, read_docx, read_csv, read_excel, read_file,
    ocr_image) can be pointed at it in a follow-up chat message. This does
    NOT trigger any agent processing by itself -- send a chat message like
    "Please analyze the file at <path>" after uploading."""
    session_dir = os.path.join(UPLOAD_DIR, _safe_filename(session_id))
    os.makedirs(session_dir, exist_ok=True)

    safe_name = _safe_filename(file.filename or "upload")
    unique_name = f"{uuid.uuid4().hex[:8]}_{safe_name}"
    dest = os.path.join(session_dir, unique_name)

    try:
        with open(dest, "wb") as out:
            shutil.copyfileobj(file.file, out)
    finally:
        await file.close()

    return UploadResponse(
        path=os.path.abspath(dest),
        name=file.filename or safe_name,
        size=os.path.getsize(dest),
    )


@app.get("/health")
async def health():
    return {"status": "ok"}
