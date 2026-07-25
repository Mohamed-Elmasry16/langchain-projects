import { useEffect, useRef } from "react";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  isError?: boolean;
  /** Full URL to an image the agent generated during this turn, if any. */
  imageUrl?: string;
};

/**
 * Very small markdown-ish renderer: bold (**text**), bullet lines
 * (- item / * item), and paragraph breaks. Intentionally lightweight
 * rather than pulling in a markdown dependency -- the agent's answers
 * are short-to-medium prose with occasional lists/bold, not full docs.
 */
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={`${keyPrefix}-${i}`} className="font-medium text-white">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={`${keyPrefix}-${i}`}>{part}</span>;
  });
}

function MarkdownLite({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let listBuffer: string[] = [];

  const flushList = (key: string) => {
    if (listBuffer.length === 0) return;
    blocks.push(
      <ul key={key} className="my-1.5 ml-4 list-disc space-y-1 text-white/75">
        {listBuffer.map((item, i) => (
          <li key={i} className="text-[13.5px] font-light leading-relaxed">
            {renderInline(item, `${key}-li-${i}`)}
          </li>
        ))}
      </ul>,
    );
    listBuffer = [];
  };

  lines.forEach((line, idx) => {
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      listBuffer.push(bulletMatch[1]);
      return;
    }
    flushList(`list-${idx}`);

    if (line.trim() === "") {
      blocks.push(<div key={`sp-${idx}`} className="h-2" />);
      return;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (headingMatch) {
      blocks.push(
        <div
          key={`h-${idx}`}
          className="mt-2 mb-1 text-[12px] font-medium uppercase tracking-[0.2em] text-[#00E5FF]/80"
        >
          {renderInline(headingMatch[2], `h-${idx}`)}
        </div>,
      );
      return;
    }

    blocks.push(
      <p key={`p-${idx}`} className="text-[13.5px] font-light leading-relaxed text-white/85">
        {renderInline(line, `p-${idx}`)}
      </p>,
    );
  });
  flushList("list-end");

  return <>{blocks}</>;
}

export function TranscriptPanel({ messages }: { messages: ChatMessage[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastContent = messages[messages.length - 1]?.content;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, lastContent]);

  if (messages.length === 0) return null;

  return (
    <div
      ref={scrollRef}
      className="relative z-10 mx-auto flex w-full max-w-[680px] flex-1 flex-col gap-4 overflow-y-auto px-6 pb-4 pt-2"
      style={{ scrollbarWidth: "thin" }}
    >
      {messages.map((m) => (
        <div
          key={m.id}
          className={`flex flex-col gap-1 ${m.role === "user" ? "items-end" : "items-start"}`}
          style={{ animation: "v-log-in 0.35s ease-out both" }}
        >
          <span className="text-[9.5px] font-light tracking-[0.35em] text-white/25">
            {m.role === "user" ? "YOU" : "VECTOR"}
          </span>
          <div
            className={`max-w-full rounded-2xl border px-4 py-3 ${
              m.role === "user"
                ? "border-white/[0.06] bg-white/[0.04] text-white/90"
                : m.isError
                  ? "border-red-500/20 bg-red-500/[0.06] text-red-200"
                  : "border-white/[0.05] bg-white/[0.02]"
            }`}
          >
            {m.role === "user" ? (
              <p className="text-[13.5px] font-light leading-relaxed">{m.content}</p>
            ) : (
              <div>
                <MarkdownLite text={m.content || ""} />
                {m.imageUrl && (
                  <img
                    src={m.imageUrl}
                    alt="Generated"
                    className="mt-2 max-h-72 rounded-xl border border-white/[0.08] object-contain"
                  />
                )}
                {m.streaming && (
                  <span
                    className="ml-0.5 inline-block h-[13px] w-[2px] translate-y-[2px] bg-[#00E5FF]"
                    style={{ animation: "v-blink 1s step-end infinite" }}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
