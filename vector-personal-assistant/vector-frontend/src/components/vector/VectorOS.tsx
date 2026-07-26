import { useEffect, useRef, useState } from "react";
import { AiCore } from "./AiCore";
import { ParticleField } from "./ParticleField";
import { CommandConsole } from "./CommandConsole";
import { ActivityPanel, type ActivityStep } from "./ActivityPanel";
import { Sidebar, type HistoryItem } from "./Sidebar";
import { FileCards, type UploadFile } from "./FileCards";
import type { ToolCall } from "./ToolStream";
import { TranscriptPanel, type ChatMessage } from "./TranscriptPanel";
import {
  streamChat,
  checkHealth,
  uploadFile,
  API_BASE_URL,
  type AgentEvent,
} from "@/lib/agent-client";

const SESSION_STORAGE_KEY = "vector-os-session-id";

function newSessionId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function summarizeToolResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  const data = (result as { data?: unknown })?.data ?? result;
  if (typeof data === "object") {
    try {
      const s = JSON.stringify(data);
      return s.length > 60 ? `${s.slice(0, 57)}...` : s;
    } catch {
      return undefined;
    }
  }
  const s = String(data);
  return s.length > 60 ? `${s.slice(0, 57)}...` : s;
}

const TAGLINES = ["State your objective.", "Awaiting command.", "Vector online.", "Mission ready."];

export function VectorOS() {
  const [thinking, setThinking] = useState(false);
  const [steps, setSteps] = useState<ActivityStep[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [booted, setBooted] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [tagline] = useState(() => TAGLINES[0]);
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sessionIdRef = useRef<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // Session id: stable per browser tab session, persisted so a page
  // refresh doesn't lose conversation memory held server-side.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    sessionIdRef.current = existing || newSessionId();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, sessionIdRef.current);

    const seed: HistoryItem = { id: sessionIdRef.current, title: "New session", ts: Date.now() };
    setHistory([seed]);
    setActiveId(seed.id);
  }, []);

  // API connectivity badge -- polls /health every 15s so the UI can tell
  // the user honestly if the backend isn't reachable, instead of hanging
  // silently on the next message.
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      const ok = await checkHealth();
      if (!cancelled) setApiOnline(ok);
    };
    ping();
    const interval = window.setInterval(ping, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => setBooted(true), 200);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const runCommand = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || thinking) return;

    // Purely cosmetic: surface a slash-command as a "mode" label bottom-left.
    // The backend doesn't special-case these -- the LLM decides which real
    // tool to call based on the full message text either way.
    const cmdMatch = trimmed.match(/^\/(\w+)\s*(.*)$/);
    setMode(cmdMatch ? cmdMatch[1] : null);

    const userMsgId = `u-${Date.now()}`;
    const assistantMsgId = `a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: trimmed },
      { id: assistantMsgId, role: "assistant", content: "", streaming: true },
    ]);

    // First message of a session -- rename the sidebar entry from
    // "New session" to something derived from what was actually asked.
    setHistory((h) =>
      h.map((item) =>
        item.id === sessionIdRef.current && item.title === "New session"
          ? { ...item, title: trimmed.replace(/^\/\w+\s*/, "").slice(0, 48) }
          : item,
      ),
    );

    setSteps([{ id: `${Date.now()}-send`, label: "Sending request", status: "active" }]);
    setThinking(true);

    let toolCallSeq = 0;
    let generatingStepAdded = false;
    let sawTerminalAnswer = false;

    const markPreviousStepsComplete = () =>
      setSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "complete" } : s)),
      );

    // Applies an update to the specific tool call (by tool name, most
    // recent non-final one first) inside this turn's assistant message.
    const updateAssistantToolCall = (toolName: string, updater: (call: ToolCall) => ToolCall) => {
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== assistantMsgId) return m;
          const calls = m.toolCalls ?? [];
          const idx = [...calls]
            .reverse()
            .findIndex((c) => c.tool === toolName && c.status !== "complete");
          if (idx === -1) return m;
          const realIdx = calls.length - 1 - idx;
          const nextCalls = [...calls];
          nextCalls[realIdx] = updater(nextCalls[realIdx]);
          return { ...m, toolCalls: nextCalls };
        }),
      );
    };

    const handleEvent = (event: AgentEvent) => {
      // "final_answer" is not a real user-facing tool -- it's how the
      // model delivers its answer text. It never gets a matching tool_end
      // from the backend (agent.py intercepts it separately), so showing
      // it as a tool card means a permanently-spinning, never-resolving
      // card with a raw JSON dump. Skip it entirely here; its content
      // still reaches the user normally via the "answer" event below.
      if (
        (event.type === "tool_start" ||
          event.type === "tool_args_chunk" ||
          event.type === "tool_end") &&
        event.tool === "final_answer"
      ) {
        return;
      }

      switch (event.type) {
        case "tool_start": {
          const toolName = event.tool ?? "tool";
          toolCallSeq += 1;
          const id = `${Date.now()}-tc-${toolCallSeq}`;
          const newCall: ToolCall = {
            id,
            tool: toolName,
            label: `Calling ${toolName.replace(/_/g, " ")}`,
            status: "running",
          };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, toolCalls: [...(m.toolCalls ?? []), newCall] } : m,
            ),
          );
          markPreviousStepsComplete();
          setSteps((prev) => [
            ...prev,
            { id: `${id}-step`, label: `Using ${toolName.replace(/_/g, " ")}`, status: "active" },
          ]);
          break;
        }
        case "tool_args_chunk": {
          const toolName = event.tool;
          if (!toolName) break;
          updateAssistantToolCall(toolName, (call) => ({
            ...call,
            query: `${call.query ?? ""}${event.chunk ?? ""}`.slice(0, 200),
          }));
          break;
        }
        case "tool_end": {
          const toolName = event.tool;
          if (!toolName) break;
          const resultObj = event.result as { url?: string } | undefined;
          const imageUrl =
            resultObj && typeof resultObj === "object" && typeof resultObj.url === "string"
              ? `${API_BASE_URL}${resultObj.url}`
              : undefined;

          updateAssistantToolCall(toolName, (call) => ({
            ...call,
            status: "complete",
            meta: summarizeToolResult(event.result),
            imageUrl,
          }));

          if (imageUrl) {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsgId ? { ...m, imageUrl } : m)),
            );
          }
          break;
        }
        case "answer_chunk": {
          if (!generatingStepAdded) {
            generatingStepAdded = true;
            markPreviousStepsComplete();
            setSteps((prev) => [
              ...prev,
              { id: `${Date.now()}-gen`, label: "Generating response", status: "active" },
            ]);
          }
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId ? { ...m, content: m.content + (event.content ?? "") } : m,
            ),
          );
          break;
        }
        case "answer": {
          sawTerminalAnswer = true;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: event.content ?? m.content, streaming: false }
                : m,
            ),
          );
          break;
        }
        case "error": {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId
                ? {
                    ...m,
                    content: m.content || event.content || "Something went wrong.",
                    streaming: false,
                    isError: true,
                  }
                : m,
            ),
          );
          break;
        }
        case "done": {
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== assistantMsgId) return m;
              // Never leave a tool card spinning forever: if the turn
              // ended (successfully or via error) before a tool_end ever
              // arrived for a call, mark it "interrupted" instead of
              // "running" so the UI shows an honest state, not an
              // infinite loader.
              const settledCalls = (m.toolCalls ?? []).map((c) =>
                c.status === "running" || c.status === "pending"
                  ? { ...c, status: "interrupted" as const }
                  : c,
              );
              return {
                ...m,
                toolCalls: settledCalls,
                streaming: sawTerminalAnswer ? m.streaming : false,
              };
            }),
          );
          setSteps((prev) => prev.map((s) => ({ ...s, status: "complete" })));
          setThinking(false);
          break;
        }
      }
    };

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    streamChat({
      sessionId: sessionIdRef.current,
      message: trimmed,
      signal: controller.signal,
      onEvent: handleEvent,
    });
  };

  const handleFiles = (list: FileList | File[]) => {
    const arr = Array.from(list);
    const added: UploadFile[] = arr.map((f) => ({
      id: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: f.name,
      size: f.size,
      kind: f.type || f.name.split(".").pop() || "file",
      pages: /\.pdf$/i.test(f.name) ? Math.max(1, Math.round(f.size / 50000)) : undefined,
      progress: 0,
      status: "uploading",
    }));
    setFiles((prev) => [...prev, ...added]);

    added.forEach((staged, i) => {
      const rawFile = arr[i];
      uploadFile(sessionIdRef.current, rawFile, (fraction) => {
        setFiles((prev) =>
          prev.map((x) => (x.id === staged.id ? { ...x, progress: fraction } : x)),
        );
      })
        .then((uploaded) => {
          setFiles((prev) =>
            prev.map((x) =>
              x.id === staged.id ? { ...x, progress: 1, status: "ready", path: uploaded.path } : x,
            ),
          );
        })
        .catch((err: unknown) => {
          setFiles((prev) =>
            prev.map((x) =>
              x.id === staged.id
                ? {
                    ...x,
                    status: "error",
                    error: err instanceof Error ? err.message : "Upload failed",
                  }
                : x,
            ),
          );
        });
    });
  };

  const startNewSession = () => {
    abortRef.current?.abort();
    const id = newSessionId();
    sessionIdRef.current = id;
    if (typeof window !== "undefined") window.sessionStorage.setItem(SESSION_STORAGE_KEY, id);

    const item: HistoryItem = { id, title: "New session", ts: Date.now() };
    setHistory((h) => [item, ...h]);
    setActiveId(item.id);
    setMessages([]);
    setSteps([]);
    setMode(null);
    setThinking(false);
  };

  return (
    <div
      className="relative flex min-h-screen w-full flex-col overflow-hidden bg-[#050505] text-[#F5F5F5]"
      style={{ fontFamily: "var(--font-display)" }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
      }}
    >
      {/* Atmosphere */}
      <div className="pointer-events-none absolute inset-0 v-grid-bg opacity-25" />
      <ParticleField />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 42%, rgba(59,130,246,0.14), transparent 55%), radial-gradient(ellipse at 50% 85%, rgba(124,58,237,0.1), transparent 60%)",
        }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(5,5,10,0.75),transparent)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-[linear-gradient(0deg,rgba(5,5,10,0.9),transparent)]" />
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.55) 100%)",
        }}
      />

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onToggle={() => setSidebarOpen((v) => !v)}
        history={history}
        activeId={activeId}
        onSelect={(id) => setActiveId(id)}
        onNew={startNewSession}
        onRename={(id, title) =>
          setHistory((h) => h.map((x) => (x.id === id ? { ...x, title } : x)))
        }
        onDelete={(id) =>
          setHistory((h) => {
            const next = h.filter((x) => x.id !== id);
            if (activeId === id) setActiveId(next[0]?.id ?? null);
            return next;
          })
        }
        onPin={(id) =>
          setHistory((h) => h.map((x) => (x.id === id ? { ...x, pinned: !x.pinned } : x)))
        }
        onFavorite={(id) =>
          setHistory((h) => h.map((x) => (x.id === id ? { ...x, favorite: !x.favorite } : x)))
        }
      />

      {/* Content shifted by sidebar */}
      <div
        className={`relative flex min-h-screen flex-1 flex-col transition-[padding] duration-500 ease-out ${sidebarOpen ? "pl-[264px]" : "pl-[60px]"}`}
      >
        {/* Minimal top bar */}
        <header
          className={`relative z-20 flex items-center justify-end gap-4 px-8 pt-7 transition-opacity duration-1000 ${booted ? "opacity-100" : "opacity-0"}`}
        >
          {apiOnline === false && (
            <div className="flex items-center gap-2 text-[10.5px] tracking-[0.3em] text-red-400/80">
              <span className="h-1.5 w-1.5 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]" />
              <span>API OFFLINE</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-[10.5px] tracking-[0.4em] text-white/40">
            <span
              className={`h-1.5 w-1.5 rounded-full ${thinking ? "bg-[#7C3AED] shadow-[0_0_8px_#7C3AED]" : "bg-[#00E5FF] shadow-[0_0_8px_#00E5FF]"}`}
            />
            <span>{thinking ? "THINKING" : "READY"}</span>
          </div>
        </header>

        {/* Center stage */}
        <main
          className={`relative z-10 flex flex-1 flex-col transition-opacity duration-1000 ${booted ? "opacity-100" : "opacity-0"}`}
        >
          {messages.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 pb-60">
              <AiCore thinking={thinking} />
              <div className="mt-8 text-center">
                <h1 className="text-[15px] md:text-[16px] font-light tracking-[0.35em] text-white/85">
                  {tagline.toUpperCase()}
                </h1>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col pb-52 pt-4">
              <TranscriptPanel messages={messages} />
            </div>
          )}
        </main>
      </div>

      {/* Activity timeline */}
      <ActivityPanel steps={steps} thinking={thinking} visible={booted} />

      {/* File cards */}
      <FileCards
        files={files}
        onAnalyze={(id) => {
          const f = files.find((x) => x.id === id);
          if (f?.path)
            runCommand(
              `Please read and analyze this file. Path: ${f.path} (original filename: ${f.name}).`,
            );
        }}
        onSummarize={(id) => {
          const f = files.find((x) => x.id === id);
          if (f?.path)
            runCommand(
              `Please summarize this file. Path: ${f.path} (original filename: ${f.name}).`,
            );
        }}
        onAsk={(id) => {
          const f = files.find((x) => x.id === id);
          if (f?.path)
            runCommand(
              `I have a question about this file. Path: ${f.path} (original filename: ${f.name}). `,
            );
        }}
        onRemove={(id) => setFiles((prev) => prev.filter((x) => x.id !== id))}
      />

      {/* Command console */}
      <CommandConsole onSubmit={runCommand} onFiles={handleFiles} disabled={thinking} />

      {/* Drag overlay */}
      {dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="rounded-2xl border border-dashed border-[#00E5FF]/50 bg-black/40 px-10 py-8 text-center">
            <div className="text-[11px] tracking-[0.4em] text-[#00E5FF]/80">DROP TO INGEST</div>
            <div className="mt-2 text-[12px] font-light tracking-wide text-white/50">
              PDF · Word · Excel · CSV · Images · ZIP
            </div>
          </div>
        </div>
      )}

      {/* Faint mode label bottom-left */}
      {mode && (
        <div
          className={`fixed bottom-3 z-20 text-[10px] tracking-[0.4em] text-white/25 transition-[left] duration-500 ${sidebarOpen ? "left-[280px]" : "left-[76px]"}`}
        >
          MODE · {mode.toUpperCase()}
        </div>
      )}
    </div>
  );
}
