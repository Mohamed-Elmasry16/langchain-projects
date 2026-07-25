import {
  Search,
  FileText,
  Code2,
  Image as ImageIcon,
  Globe,
  Youtube,
  Database,
  Brain,
  Check,
  Loader2,
  Cloud,
  Calculator,
  Clock,
  Hash,
  Wand2,
} from "lucide-react";

export type ToolCall = {
  id: string;
  /** Raw backend tool name, e.g. "serpapi", "generate_image", "read_pdf". */
  tool: string;
  label: string;
  query?: string;
  status: "pending" | "running" | "complete";
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

function getToolMeta(tool: string): ToolMeta {
  return TOOL_META_BY_NAME[tool] ?? { ...DEFAULT_TOOL_META, name: tool.replace(/_/g, " ") };
}

export function ToolStream({ calls, sidebarOpen }: { calls: ToolCall[]; sidebarOpen: boolean }) {
  if (calls.length === 0) return null;
  return (
    <div
      className={`pointer-events-none fixed bottom-[168px] z-20 flex justify-center px-6 transition-[left,right] duration-500 ${
        sidebarOpen ? "left-[264px]" : "left-[60px]"
      } right-0 md:right-[260px]`}
    >
      <div className="pointer-events-auto flex w-full max-w-[560px] flex-col gap-2">
        {calls.slice(-3).map((c, i) => {
          const M = getToolMeta(c.tool);
          const Icon = M.icon;
          const running = c.status === "running";
          const done = c.status === "complete";
          return (
            <div
              key={c.id}
              className="group relative overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 backdrop-blur-xl"
              style={{
                animation: `v-log-in 0.45s cubic-bezier(.2,.7,.2,1) ${i * 0.04}s both`,
                boxShadow: running
                  ? `0 0 0 1px ${M.accent}22, 0 8px 30px -12px ${M.accent}55`
                  : "0 8px 24px -16px rgba(0,0,0,0.6)",
              }}
            >
              {/* scan line while running */}
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
                    boxShadow: running
                      ? `inset 0 0 0 1px ${M.accent}55`
                      : `inset 0 0 0 1px ${M.accent}22`,
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
                      {c.label}
                    </span>
                  </div>
                  {c.query && (
                    <div className="mt-0.5 truncate font-mono text-[11px] text-white/45">
                      <span className="text-white/25">›</span> {c.query}
                    </div>
                  )}
                  {done && c.sources && c.sources.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {c.sources.slice(0, 4).map((s, idx) => (
                        <span
                          key={idx}
                          className="rounded-md border border-white/[0.06] bg-white/[0.02] px-1.5 py-[2px] text-[10px] font-light text-white/55"
                        >
                          {s.host}
                        </span>
                      ))}
                    </div>
                  )}
                  {done && c.imageUrl && (
                    <div className="mt-1.5">
                      <img
                        src={c.imageUrl}
                        alt="Generated"
                        className="h-14 w-14 rounded-lg border border-white/[0.08] object-cover"
                      />
                    </div>
                  )}
                </div>
                <div className="flex flex-shrink-0 items-center gap-2 pl-2">
                  {c.meta && done && (
                    <span className="text-[10px] font-light tracking-[0.15em] text-white/40">
                      {c.meta}
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
                  {c.status === "pending" && (
                    <span className="h-1.5 w-1.5 rounded-full bg-white/15" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
