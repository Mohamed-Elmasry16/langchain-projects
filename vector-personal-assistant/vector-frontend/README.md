# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

---

## Backend integration (added on top of the Lovable scaffold)

This UI is wired to a FastAPI SSE backend (`api.py`, which sits in front of
the LangChain agent in `agent.py`). The relevant pieces:

- **`src/lib/agent-client.ts`** — streams `POST /chat/stream` responses
  using `fetch()` + a manual `ReadableStream` reader (not `EventSource`,
  since `EventSource` can't send a POST body). Parses the same
  `data: {...}\n\n` framing the backend emits.
- **`src/components/vector/VectorOS.tsx`** — owns the conversation state,
  session id, and maps each SSE event (`answer_chunk`, `tool_start`,
  `tool_args_chunk`, `tool_end`, `answer`, `error`, `done`) to UI updates.
- **`src/components/vector/TranscriptPanel.tsx`** — new component; renders
  the live streaming answer text (with a blinking cursor) plus prior
  turns. The original UI had no place to actually show the agent's answer
  text — only a status orb and fake tool-call cards — so this was added.
- **`src/components/vector/ToolStream.tsx`** — tool name → icon/label
  mapping now matches the *real* backend tool names (`serpapi`,
  `generate_image`, `read_pdf`, `weather`, etc.) instead of the mocked
  categories (`search`, `image`, `data`...). Unknown tool names fall back
  to a generic icon so adding a new backend tool never breaks the UI.
- **File uploads** — `FileCards` / drag-and-drop now call the real
  `POST /upload` endpoint via `uploadFile()` in `agent-client.ts`, with
  genuine progress (`XMLHttpRequest.upload.onprogress` — `fetch` has no
  upload-progress event). On success the file's server-side path is
  stored and used when you click Analyze/Summarize/Ask, so the agent's
  `read_pdf`/`read_docx`/etc. tools get a real path to read. Failed
  uploads show an error state on the card and disable those actions
  until it succeeds.
- **Generated images** — when a tool (e.g. `generate_image`) produces an
  image, `api.py` persists it to disk and returns a small `/static/...`
  URL instead of raw base64 over SSE. The UI now renders that image both
  as a thumbnail on the tool call card and inline in the chat bubble.

### Setup

```sh
cp .env.example .env
# edit .env if your API isn't on http://localhost:8000
npm i        # or bun install — bun.lock was removed since dependencies
             # in package.json are unchanged; regenerate it with
             # `bun install` if you use bun
npm run dev
```

Run the backend alongside it (`uvicorn api:app --reload --port 8000`).
`api.py` restricts CORS to an explicit origin allowlist (env var
`CORS_ORIGINS`, comma-separated) rather than `"*"` — it defaults to the
common local Vite ports (5173, 8080). If `npm run dev` prints a
different port, add it to `CORS_ORIGINS` or you'll see CORS errors in
the browser console.

### Remaining gap: the "Ask" action auto-submits a placeholder question

Clicking **Ask** on a file card immediately sends a message referencing
the file's path rather than letting you type your actual question first
(the console is disabled while a turn is in flight). If you want
"Ask" to prefill the input instead of auto-sending, that needs a small
prop added to `CommandConsole` to accept an external value — not done
here to avoid guessing at UX you haven't specified.

