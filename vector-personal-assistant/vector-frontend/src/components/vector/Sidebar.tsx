import { useState, type ReactNode } from "react";

export type HistoryItem = {
  id: string;
  title: string;
  ts: number;
  pinned?: boolean;
  favorite?: boolean;
};

type NavKey = "new" | "history" | "knowledge" | "memory" | "tools" | "settings";

const NAV: { key: NavKey; label: string; icon: ReactNode }[] = [
  { key: "new", label: "New Session", icon: <Icon d="M12 5v14M5 12h14" /> },
  { key: "history", label: "History", icon: <Icon d="M12 8v5l3 2M12 3a9 9 0 1 0 9 9M3 3v6h6" /> },
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px]">
      <path d={d} />
    </svg>
  );
}

function relTime(ts: number) {
  const d = (Date.now() - ts) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

export function Sidebar({
  open,
  onToggle,
  history,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
  onPin,
  onFavorite,
}: {
  open: boolean;
  onToggle: () => void;
  history: HistoryItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onFavorite: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [nav, setNav] = useState<NavKey>("history");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");

  const filtered = history
    .filter((h) => h.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      if (!!b.favorite !== !!a.favorite) return b.favorite ? 1 : -1;
      return b.ts - a.ts;
    });

  return (
    <aside
      className={`fixed left-0 top-0 z-40 h-screen border-r border-white/[0.04] bg-black/40 backdrop-blur-2xl transition-[width] duration-500 ease-out ${open ? "w-[264px]" : "w-[60px]"}`}
      style={{ boxShadow: "inset -1px 0 0 rgba(255,255,255,0.02)" }}
    >
      {/* Header */}
      <div className={`flex items-center px-4 pt-6 pb-4 ${open ? "justify-between" : "justify-center"}`}>
        <div className="flex items-center gap-2.5">
          <svg width="22" height="22" viewBox="0 0 32 32" className="animate-[v-breath_5s_ease-in-out_infinite]">
            <defs>
              <linearGradient id="sbv" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#00E5FF" />
                <stop offset="100%" stopColor="#7C3AED" />
              </linearGradient>
            </defs>
            <path d="M5 7 L16 27 L27 7" fill="none" stroke="url(#sbv)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="16" cy="15" r="1.6" fill="#00E5FF">
              <animate attributeName="r" values="1.2;2.2;1.2" dur="3s" repeatCount="indefinite" />
            </circle>
          </svg>
          {open && <span className="text-[11px] tracking-[0.42em] text-white/70">VECTOR</span>}
        </div>
        {open && (
          <button
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/40 transition hover:bg-white/[0.04] hover:text-white/80"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M15 6l-6 6 6 6" /></svg>
          </button>
        )}
      </div>

      {!open && (
        <div className="flex justify-center">
          <button
            onClick={onToggle}
            aria-label="Expand sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-white/40 transition hover:bg-white/[0.04] hover:text-white/80"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 6l6 6-6 6" /></svg>
          </button>
        </div>
      )}

      {/* Nav */}
      <nav className={`mt-2 ${open ? "px-3" : "px-2"} space-y-0.5`}>
        {NAV.map((n) => {
          const active = nav === n.key || (n.key === "history" && open);
          return (
            <button
              key={n.key}
              onClick={() => {
                if (n.key === "new") onNew();
                else setNav(n.key);
              }}
              title={n.label}
              className={`group flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                active ? "text-white/95" : "text-white/50 hover:text-white/85"
              } hover:bg-white/[0.03] ${!open ? "justify-center" : ""}`}
            >
              <span className={active ? "text-[#00E5FF]" : ""}>{n.icon}</span>
              {open && <span className="text-[12.5px] font-light tracking-wide">{n.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* History list */}
      {open && nav === "history" && (
        <div className="mt-5 flex h-[calc(100vh-260px)] flex-col px-3">
          <div className="relative mb-3 px-1">
            <svg viewBox="0 0 24 24" width="12" height="12" className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" /></svg>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
              className="w-full rounded-md bg-white/[0.03] px-7 py-1.5 text-[12px] font-light text-white/85 outline-none placeholder:text-white/25 focus:bg-white/[0.06]"
            />
          </div>
          <div className="flex-1 space-y-0.5 overflow-y-auto pr-1 [scrollbar-width:thin] [scrollbar-color:rgba(255,255,255,0.1)_transparent]">
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-[11px] font-light text-white/25">No sessions</div>
            )}
            {filtered.map((h) => {
              const isActive = h.id === activeId;
              return (
                <div key={h.id} className="group relative">
                  {renaming === h.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={() => {
                        if (renameVal.trim()) onRename(h.id, renameVal.trim());
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="w-full rounded-md bg-white/[0.06] px-3 py-2 text-[12.5px] text-white outline-none"
                    />
                  ) : (
                    <button
                      onClick={() => onSelect(h.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-left transition ${
                        isActive ? "bg-white/[0.05] text-white/95" : "text-white/60 hover:bg-white/[0.03] hover:text-white/90"
                      }`}
                    >
                      {h.pinned && <span className="text-[#00E5FF]" title="Pinned"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2l8 8-5 1-4 4v6l-3-3-3 3v-6l-4-4-5-1 8-8z" /></svg></span>}
                      {h.favorite && <span className="text-[#7C3AED]" title="Favorite"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z" /></svg></span>}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12.5px] font-light tracking-wide">{h.title}</div>
                        <div className="mt-0.5 text-[10px] tracking-wide text-white/30">{relTime(h.ts)}</div>
                      </div>
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuFor(menuFor === h.id ? null : h.id);
                    }}
                    aria-label="Session actions"
                    className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded text-white/40 hover:bg-white/[0.06] hover:text-white group-hover:flex"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
                  </button>
                  {menuFor === h.id && (
                    <div
                      className="absolute right-1 top-8 z-50 w-36 overflow-hidden rounded-md border border-white/[0.06] bg-black/90 py-1 backdrop-blur-xl"
                      style={{ animation: "v-slide-up 0.14s ease-out both" }}
                    >
                      {[
                        { label: "Rename", run: () => { setRenaming(h.id); setRenameVal(h.title); } },
                        { label: h.pinned ? "Unpin" : "Pin", run: () => onPin(h.id) },
                        { label: h.favorite ? "Unfavorite" : "Favorite", run: () => onFavorite(h.id) },
                        { label: "Delete", run: () => onDelete(h.id), danger: true },
                      ].map((a) => (
                        <button
                          key={a.label}
                          onClick={() => { a.run(); setMenuFor(null); }}
                          className={`block w-full px-3 py-1.5 text-left text-[11.5px] tracking-wide transition hover:bg-white/[0.06] ${a.danger ? "text-red-300/80 hover:text-red-200" : "text-white/70 hover:text-white"}`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {open && nav !== "history" && (
        <div className="mt-6 px-5 text-[11.5px] font-light tracking-[0.15em] text-white/30">
          {nav === "knowledge" && "Attach docs, notes and files to expand Vector's context."}
          {nav === "memory" && "Vector remembers what matters between sessions."}
          {nav === "tools" && "Configure integrations and slash commands."}
          {nav === "settings" && "Preferences, appearance and system."}
        </div>
      )}
    </aside>
  );
}