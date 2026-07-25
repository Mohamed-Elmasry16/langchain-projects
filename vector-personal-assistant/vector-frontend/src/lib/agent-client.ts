/**
 * Streaming client for the agent API defined in api.py.
 *
 * Uses fetch() + a manual ReadableStream reader instead of EventSource
 * because EventSource cannot send a POST body (we need to send session_id
 * and message), and cannot set custom headers. This parses the same
 * `data: {...}\n\n` SSE framing the backend emits.
 */

export type AgentEventType =
  "answer_chunk" | "answer" | "tool_start" | "tool_args_chunk" | "tool_end" | "error" | "done";

export interface AgentEvent {
  type: AgentEventType;
  content?: string;
  tool?: string;
  chunk?: string;
  result?: unknown;
}

export interface StreamChatParams {
  sessionId: string;
  message: string;
  signal?: AbortSignal;
  onEvent: (event: AgentEvent) => void;
}

// Vite exposes env vars prefixed with VITE_ on import.meta.env.
// Falls back to localhost:8000 (the default uvicorn port used in the
// api.py docstring) so local dev works without a .env file.
export const API_BASE_URL: string =
  (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_API_URL ??
  "http://localhost:8000";

/**
 * Streams one chat turn from the agent API. Resolves once the stream ends
 * (either a `done` event was received, or the connection closed/errored).
 * Every parsed SSE event is forwarded to `onEvent` in order.
 */
export async function streamChat({
  sessionId,
  message,
  signal,
  onEvent,
}: StreamChatParams): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, message }),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    onEvent({
      type: "error",
      content: `Could not reach the agent API at ${API_BASE_URL}. Is it running?`,
    });
    onEvent({ type: "done" });
    return;
  }

  if (!res.ok || !res.body) {
    let detail = res.statusText || "Request failed";
    try {
      const body = await res.json();
      detail = body?.detail ?? detail;
    } catch {
      // response wasn't JSON -- keep statusText
    }
    onEvent({ type: "error", content: detail });
    onEvent({ type: "done" });
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line ("\n\n"). Process every
      // complete event currently in the buffer; keep the remainder (a
      // partial event that hasn't fully arrived yet) for the next chunk.
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;

        const jsonStr = dataLine.slice(5).trim();
        if (!jsonStr) continue;

        try {
          const parsed = JSON.parse(jsonStr) as AgentEvent;
          onEvent(parsed);
        } catch (parseErr) {
          console.error("agent-client: failed to parse SSE event", jsonStr, parseErr);
        }
      }
    }
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") {
      onEvent({ type: "error", content: "Connection to the agent was interrupted." });
      onEvent({ type: "done" });
    }
  }
}

/** Simple health check against GET /health, used to show a connection badge. */
export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/health`, { signal });
    return res.ok;
  } catch {
    return false;
  }
}

export interface UploadedFile {
  path: string;
  name: string;
  size: number;
}

/**
 * Uploads one file to POST /upload. Uses XMLHttpRequest instead of fetch
 * because fetch has no upload-progress event -- XHR's `upload.onprogress`
 * is the only standard way to report real (not simulated) progress for a
 * multipart form upload in the browser.
 */
export function uploadFile(
  sessionId: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<UploadedFile> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE_URL}/upload`);

    if (signal) {
      const onAbort = () => xhr.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      xhr.addEventListener("loadend", () => signal.removeEventListener("abort", onAbort));
    }

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedFile);
        } catch {
          reject(new Error("Upload succeeded but the response could not be parsed."));
        }
        return;
      }
      let detail = xhr.statusText || `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        detail = body?.detail ?? detail;
      } catch {
        // response wasn't JSON -- keep statusText/status fallback
      }
      reject(new Error(detail));
    };

    xhr.onerror = () => reject(new Error(`Could not reach the agent API at ${API_BASE_URL}.`));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));

    const form = new FormData();
    form.append("session_id", sessionId);
    form.append("file", file);
    xhr.send(form);
  });
}
