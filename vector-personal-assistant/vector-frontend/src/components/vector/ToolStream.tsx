import {
  Search,
  FileText,
  Code2,
  Image as ImageIcon,
  Globe,
  Youtube,
  Brain,
  Check,
  Loader2,
  Cloud,
  Calculator,
  Clock,
  Hash,
  Wand2,
  AlertTriangle,
} from "lucide-react";

export type ToolCall = {
  id: string;
  /** Raw backend tool name, e.g. "serpapi", "generate_image", "read_pdf". */
  tool: string;
  label: string;
  query?: string;
  /** "interrupted" = the turn ended (error/done) before a tool_end ever
   * arrived for this call -- shown distinctly from a real "complete" so
   * the UI never shows an infinite spinner for a call that never resolved. */
  status: "pending" | "running" | "complete" | "interrupted";
  meta?: string; // e.g. "12 results" or "4 sources"
  sources?: { title: string; host: string }[];
  /** Full URL to a generated image, when this tool call produced one. */
  imageUrl?: string;
};

import type { LucideIcon } from "lucide-react";

type ToolMeta = { icon: LucideIcon; name: string; accent: string };

// Maps the real tool names exposed by the agent (see tools/basic_tools.py
// and tools/file_tools.py in the backend) to a display icon/label/accent.
// Any tool name not listed here falls back to DEFAULT_TOOL_META below, so
// adding a new backend tool never breaks the UI -- it just renders generic.
const TOOL_META_BY_NAME: Record<string, ToolMeta> = {
  serpapi: { icon: Search, name: "Web Search", accent: "#00E5FF" },
  wikipedia_search: { icon: Search, name: "Wikipedia", accent: "#00E5FF" },
  youtube_search: { icon: Search, name: "YouTube Search", accent: "#00E5FF" },
  fetch_webpage: { icon: Globe, name: "Fetch Page", accent: "#00E5FF" },
  write_code: { icon: Code2, name: "Code Interpreter", accent: "#00E5FF" },
  generate_image: { icon: ImageIcon, name: "Image Synthesis", accent: "#7C3AED" },
  read_pdf: { icon: FileText, name: "Reading PDF", accent: "#7C3AED" },
  read_docx: { icon: FileText, name: "Reading Document", accent: "#7C3AED" },
  read_csv: { icon: FileText, name: "Reading CSV", accent: "#7C3AED" },
  read_excel: { icon: FileText, name: "Reading Excel", accent: "#7C3AED" },
  read_file: { icon: FileText, name: "Reading File", accent: "#7C3AED" },
  ocr_image: { icon: FileText, name: "OCR", accent: "#7C3AED" },
  summarize_text: { icon: Brain, name: "Summarizing", accent: "#7C3AED" },
  youtube_transcript: { icon: Youtube, name: "Video Transcript", accent: "#7C3AED" },
  weather: { icon: Cloud, name: "Weather", accent: "#00E5FF" },
  calculator: { icon: Calculator, name: "Calculator", accent: "#00E5FF" },
  unit_converter: { icon: Calculator, name: "Unit Converter", accent: "#00E5FF" },
  currency_converter: { icon: Calculator, name: "Currency Convert", accent: "#00E5FF" },
  get_current_datetime: { icon: Clock, name: "Date & Time", accent: "#00E5FF" },
  uuid_generator: { icon: Hash, name: "UUID Generator", accent: "#00E5FF" },
};

const DEFAULT_TOOL_META: ToolMeta = { icon: Wand2, name: "Tool", accent: "#00E5FF" };

export function getToolMeta(tool: string): ToolMeta {
  return TOOL_META_BY_NAME[tool] ?? { ...DEFAULT_TOOL_META, name: tool.replace(/_/g, " ") };
}

/** True for a query string that carries no real information worth showing
 * (a tool with no arguments often streams literal "null" or "{}"). */
function isEmptyQuery(q: string | undefined): boolean {
  if (!q) return true;
  const t = q.trim();
  return t === "" || t === "null" || t === "{}" || t === "undefined";
}

/**
 * A single tool-call card. Rendered inline inside the assistant message it
 * belongs to (see TranscriptPanel) rather than as a floating overlay, so a
 * call always stays visually attached to the turn that produced it.
 */
export function ToolCallCard({ call, index = 0 }: { call: ToolCall; index?: number }) {
  const M = getToolMeta(call.tool);
  const Icon = M.icon;
  const running = call.status === "running";
  const done = call.status === "complete";
  const interrupted = call.status === "interrupted";

  return (
    <div
      className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 backdrop-blur-xl"
      style={{
        animation: `v-log-in 0.4s cubic-bezier(.2,.7,.2,1) ${index * 0.04}s both`,
        boxShadow: running
          ? `0 0 0 1px ${M.accent}22, 0 8px 30px -12px ${M.accent}55`
          : "0 8px 24px -16px rgba(0,0,0,0.6)",
      }}
    >
      {running && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background: `linear-gradient(90deg, transparent, ${M.accent}, transparent)`,
            animation: "v-orbit-dash 1.6s linear infinite",
          }}
        />
      )}
      <div className="flex items-center gap-3">
        <span
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md"
          style={{
            background: `${M.accent}12`,
            boxShadow: running ? `inset 0 0 0 1px ${M.accent}55` : `inset 0 0 0 1px ${M.accent}22`,
          }}
        >
          <Icon className="h-3.5 w-3.5" style={{ color: M.accent }} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] font-medium uppercase tracking-[0.28em]"
              style={{ color: M.accent }}
            >
              {M.name}
            </span>
            <span className="text-white/20">·</span>
            <span className="truncate text-[11.5px] font-light tracking-wide text-white/70">
              {call.label}
            </span>
          </div>
          {!isEmptyQuery(call.query) && (
            <div className="mt-0.5 truncate font-mono text-[11px] text-white/45">
              <span className="text-white/25">›</span> {call.query}
            </div>
          )}
          {done && call.sources && call.sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {call.sources.slice(0, 4).map((s, idx) => (
                <span
                  key={idx}
                  className="rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-[2px] text-[10px] font-light text-white/55"
                >
                  {s.host}
                </span>
              ))}
            </div>
          )}
          {done && call.imageUrl && (
            <div className="mt-1.5">
              <img
                src={call.imageUrl}
                alt="Generated"
                className="h-14 w-14 rounded-lg border border-white/[0.08] object-cover"
              />
            </div>
          )}
          {interrupted && (
            <div className="mt-0.5 text-[10.5px] font-light text-amber-400/70">
              Didn't confirm completion
            </div>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2 pl-2">
          {call.meta && done && (
            <span className="text-[10px] font-light tracking-[0.15em] text-white/40">
              {call.meta}
            </span>
          )}
          {running && <Loader2 className="h-3.5 w-3.5 animate-spin text-white/60" />}
          {done && (
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full"
              style={{ background: `${M.accent}18`, boxShadow: `0 0 8px ${M.accent}55` }}
            >
              <Check className="h-2.5 w-2.5" style={{ color: M.accent }} />
            </span>
          )}
          {interrupted && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-amber-400/15">
              <AlertTriangle className="h-2.5 w-2.5 text-amber-400/80" />
            </span>
          )}
          {call.status === "pending" && <span className="h-1.5 w-1.5 rounded-full bg-white/15" />}
        </div>
      </div>
    </div>
  );
}

/**
 * @deprecated no longer used by VectorOS -- tool calls now render inline
 * inside each message via ToolCallCard (see TranscriptPanel). Kept only in
 * case a future surface wants a floating "live activity" overlay.
 */
export function ToolStream({ calls, sidebarOpen }: { calls: ToolCall[]; sidebarOpen: boolean }) {
  if (calls.length === 0) return null;
  return (
    <div
      className={`pointer-events-none fixed bottom-[168px] z-20 flex justify-center px-6 transition-[left,right] duration-500 ${
        sidebarOpen ? "left-[264px]" : "left-[60px]"
      } right-0 md:right-[260px]`}
    >
      <div className="pointer-events-auto flex w-full max-w-[560px] flex-col gap-2">
        {calls.slice(-3).map((c, i) => (
          <ToolCallCard key={c.id} call={c} index={i} />
        ))}
      </div>
    </div>
  );
}
