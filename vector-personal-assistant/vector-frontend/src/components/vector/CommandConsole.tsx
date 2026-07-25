import { useEffect, useRef, useState } from "react";

const COMMANDS: { cmd: string; hint: string }[] = [
  { cmd: "/search", hint: "Search the web" },
  { cmd: "/pdf", hint: "Read a PDF" },
  { cmd: "/code", hint: "Generate code" },
  { cmd: "/image", hint: "Create an image" },
  { cmd: "/web", hint: "Browse a URL" },
  { cmd: "/youtube", hint: "Analyze a video" },
];

export function CommandConsole({
  onSubmit,
  onFiles,
  disabled,
}: {
  onSubmit: (v: string) => void;
  onFiles: (files: FileList | File[]) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 220);
    el.style.height = `${Math.max(next, 24)}px`;
  }, [value]);

  const submit = () => {
    if (disabled) return;
    if (!value.trim()) return;
    onSubmit(value);
    setValue("");
  };

  const slashActive = value.startsWith("/") && focused && !disabled;
  const matches = slashActive
    ? COMMANDS.filter((c) => c.cmd.startsWith(value.split(" ")[0].toLowerCase()))
    : [];

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-8 z-30 flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-[680px]">
        {matches.length > 0 && (
          <div
            className="mb-2.5 overflow-hidden rounded-2xl border border-white/[0.06] bg-black/60 backdrop-blur-2xl"
            style={{ animation: "v-slide-up 0.2s ease-out both" }}
          >
            {matches.map((c) => (
              <button
                key={c.cmd}
                type="button"
                onClick={() => {
                  setValue(c.cmd + " ");
                  textRef.current?.focus();
                }}
                className="flex w-full items-center gap-3 px-5 py-2 text-left transition hover:bg-white/[0.03]"
              >
                <span className="text-[12.5px] font-light tracking-wide text-[#00E5FF]/85">{c.cmd}</span>
                <span className="text-[11.5px] font-light tracking-wide text-white/40">{c.hint}</span>
              </button>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="group relative flex items-end gap-1.5 rounded-[22px] border border-white/[0.06] bg-black/45 pl-2.5 pr-2 py-2 backdrop-blur-2xl transition-all duration-500"
          style={{
            boxShadow: focused
              ? "0 0 0 1px rgba(0,229,255,0.18), 0 24px 60px -30px rgba(0,229,255,0.28)"
              : "0 24px 60px -34px rgba(0,0,0,0.9)",
          }}
        >
          <input
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.zip,image/*"
            className="hidden"
            onChange={(e) => e.target.files && onFiles(e.target.files)}
          />
          <input
            ref={imgRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files && onFiles(e.target.files)}
          />
          <IconButton title="Upload" onClick={() => fileRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M21 12v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-6M12 3v13M7 8l5-5 5 5" /></svg>
          </IconButton>
          <IconButton title="Image" onClick={() => imgRef.current?.click()}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.7" /><path d="M21 16l-5-5-8 8" strokeLinecap="round" /></svg>
          </IconButton>
          <textarea
            ref={textRef}
            rows={1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={disabled}
            placeholder="Enter Objective…"
            className="max-h-[220px] min-h-[24px] flex-1 resize-none self-center bg-transparent px-2 py-1 text-[14.5px] font-light leading-6 tracking-wide text-white outline-none placeholder:text-white/25"
            autoFocus
          />
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            title="Send"
            className="ml-0.5 flex h-9 w-9 items-center justify-center self-end rounded-full text-white transition disabled:opacity-25"
            style={{
              background: !value.trim() ? "transparent" : "linear-gradient(135deg, #3B82F6, #7C3AED)",
              boxShadow: !value.trim() ? "none" : "0 0 22px rgba(59,130,246,0.35)",
            }}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </form>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center self-end rounded-full transition hover:bg-white/[0.05] ${
        active ? "text-[#00E5FF]" : "text-white/50 hover:text-white"
      }`}
    >
      <span className="h-[17px] w-[17px]">{children}</span>
    </button>
  );
}