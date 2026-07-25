export type UploadFile = {
  id: string;
  name: string;
  size: number;
  kind: string;
  pages?: number;
  progress: number; // 0..1
  status: "uploading" | "ready" | "error";
  /** Absolute server-side path once /upload succeeds -- required before
   * the file can be referenced in a chat message for the agent to read. */
  path?: string;
  error?: string;
};

function iconFor(kind: string) {
  const k = kind.toLowerCase();
  if (k.includes("pdf")) return { label: "PDF", color: "#F87171" };
  if (k.includes("word") || k.includes("doc")) return { label: "DOC", color: "#60A5FA" };
  if (k.includes("sheet") || k.includes("excel") || k.includes("xls") || k.includes("csv"))
    return { label: "XLS", color: "#4ADE80" };
  if (k.startsWith("image/")) return { label: "IMG", color: "#00E5FF" };
  if (k.includes("zip") || k.includes("compressed")) return { label: "ZIP", color: "#FBBF24" };
  return { label: "FILE", color: "#A78BFA" };
}

function fmtSize(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export function FileCards({
  files,
  onAnalyze,
  onSummarize,
  onAsk,
  onRemove,
}: {
  files: UploadFile[];
  onAnalyze: (id: string) => void;
  onSummarize: (id: string) => void;
  onAsk: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-32 left-1/2 z-30 w-full max-w-[720px] -translate-x-1/2 px-4">
      <div className="pointer-events-auto flex flex-wrap justify-center gap-2.5">
        {files.map((f) => {
          const ic = iconFor(f.kind);
          const busy = f.status === "uploading";
          const failed = f.status === "error";
          const actionsDisabled = busy || failed;
          return (
            <div
              key={f.id}
              className={`group relative flex items-center gap-3 rounded-2xl border px-3 py-2.5 backdrop-blur-2xl transition ${
                failed
                  ? "border-red-500/25 bg-red-500/[0.05] hover:border-red-500/40"
                  : "border-white/[0.06] bg-white/[0.03] hover:border-white/[0.12] hover:bg-white/[0.05]"
              }`}
              style={{
                animation: "v-slide-up 0.35s ease-out both",
                boxShadow: "0 20px 50px -30px rgba(0,0,0,0.9)",
              }}
            >
              <div
                className="relative flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg"
                style={{
                  background: `linear-gradient(135deg, ${ic.color}22, transparent)`,
                  border: `1px solid ${ic.color}33`,
                }}
              >
                {busy ? (
                  <CircularProgress value={f.progress} color={ic.color} />
                ) : (
                  <span
                    className="text-[9px] font-medium tracking-wider"
                    style={{ color: ic.color }}
                  >
                    {ic.label}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <div className="max-w-[180px] truncate text-[12px] font-light tracking-wide text-white/90">
                  {f.name}
                </div>
                <div
                  className={`mt-0.5 text-[10px] tracking-wide ${failed ? "text-red-400/80" : "text-white/35"}`}
                >
                  {failed
                    ? f.error || "Upload failed"
                    : busy
                      ? `${Math.round(f.progress * 100)}%`
                      : (f.pages ? `${f.pages} pages · ` : "") + fmtSize(f.size)}
                </div>
              </div>
              <div className="ml-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                <MiniBtn onClick={() => onAnalyze(f.id)} disabled={actionsDisabled}>
                  Analyze
                </MiniBtn>
                <MiniBtn onClick={() => onSummarize(f.id)} disabled={actionsDisabled}>
                  Summarize
                </MiniBtn>
                <MiniBtn onClick={() => onAsk(f.id)} disabled={actionsDisabled}>
                  Ask
                </MiniBtn>
                <button
                  onClick={() => onRemove(f.id)}
                  className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-md text-white/40 transition hover:bg-white/[0.06] hover:text-white/90"
                  aria-label="Remove file"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="12"
                    height="12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  >
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MiniBtn({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-1 text-[10.5px] font-light tracking-wide text-white/70 transition hover:border-[#00E5FF]/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-white/[0.06] disabled:hover:text-white/70"
    >
      {children}
    </button>
  );
}

function CircularProgress({ value, color }: { value: number; color: string }) {
  const r = 12;
  const c = 2 * Math.PI * r;
  return (
    <svg width="28" height="28" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" />
      <circle
        cx="16"
        cy="16"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - Math.max(0.05, value))}
        transform="rotate(-90 16 16)"
        style={{ transition: "stroke-dashoffset 0.3s ease-out" }}
      />
    </svg>
  );
}
