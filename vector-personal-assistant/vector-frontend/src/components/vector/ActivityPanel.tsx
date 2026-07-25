export type ActivityStep = {
  id: string;
  label: string;
  status: "pending" | "active" | "complete";
};

export function ActivityPanel({ steps, thinking, visible }: { steps: ActivityStep[]; thinking: boolean; visible: boolean }) {
  const hasSteps = steps.length > 0;
  return (
    <aside
      className={`pointer-events-none fixed right-8 top-1/2 z-20 hidden w-[220px] -translate-y-1/2 transition-all duration-700 md:block lg:right-12 ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"}`}
    >
      <div className="mb-5 flex items-center gap-2 text-[10px] tracking-[0.4em] text-white/35">
        <span className={`h-1 w-1 rounded-full ${thinking ? "bg-[#7C3AED] shadow-[0_0_6px_#7C3AED]" : "bg-white/25"}`} />
        <span>ACTIVITY</span>
      </div>
      {!hasSteps && (
        <div className="text-[12px] font-light tracking-[0.15em] text-white/20">
          Standing by
        </div>
      )}
      {hasSteps && (
        <ol className="relative space-y-5">
          <span className="absolute left-[4px] top-2 bottom-2 w-px bg-gradient-to-b from-transparent via-white/10 to-transparent" />
          {steps.map((s, i) => (
            <li
              key={s.id}
              className="relative flex items-start gap-3"
              style={{ animation: `v-log-in 0.5s ease-out ${i * 0.06}s both` }}
            >
              <span
                className={`relative z-10 mt-[7px] h-[9px] w-[9px] flex-shrink-0 rounded-full transition-all duration-500 ${
                  s.status === "complete"
                    ? "bg-[#00E5FF]"
                    : s.status === "active"
                    ? "bg-[#7C3AED]"
                    : "bg-white/15"
                }`}
                style={s.status === "active" ? { boxShadow: "0 0 0 3px rgba(124,58,237,0.12), 0 0 10px rgba(124,58,237,0.5)" } : s.status === "complete" ? { boxShadow: "0 0 6px rgba(0,229,255,0.5)" } : undefined}
              >
                {s.status === "active" && (
                  <span className="absolute inset-0 rounded-full bg-[#7C3AED] opacity-60 animate-[v-breath_1.6s_ease-in-out_infinite]" />
                )}
              </span>
              <div className="flex-1">
                <div
                  className={`text-[12.5px] font-light tracking-[0.05em] transition-colors duration-500 ${
                    s.status === "complete"
                      ? "text-white/40"
                      : s.status === "active"
                      ? "text-white/90"
                      : "text-white/25"
                  }`}
                >
                  {s.label}
                  {s.status === "active" && <span className="ml-1 text-white/40">…</span>}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}