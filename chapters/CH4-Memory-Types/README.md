# 🧠 LangChain Memory Types — Legacy vs. Modern

A visual guide to conversational memory in LangChain: how each **legacy** memory class works, why it was deprecated, and what to use **instead** in modern LangChain apps.

> ⚠️ All memory classes below (`Conversation*Memory`) are **deprecated**. They're documented here for learning purposes and for maintaining older codebases. New projects should use `RunnableWithMessageHistory` (or LangGraph) instead.

---

## 🗺️ The Big Picture

```mermaid
flowchart LR
    A[User Message] --> B{Memory Strategy}
    B --> C[Buffer<br/>keep everything]
    B --> D[Buffer Window<br/>keep last K]
    B --> E[Summary<br/>compress via LLM]
    B --> F[Summary Buffer<br/>summary + last K]
    C --> G[LLM]
    D --> G
    E --> G
    F --> G
```

---

## 🔄 Deprecation Map

```mermaid
flowchart TD
    subgraph Legacy["🗄️ Legacy API (deprecated)"]
        L1["ConversationBufferMemory"]
        L2["ConversationBufferWindowMemory"]
        L3["ConversationSummaryMemory"]
        L4["ConversationSummaryBufferMemory"]
    end

    subgraph Modern["✅ Modern API (recommended)"]
        M1["RunnableWithMessageHistory"]
        M2["RunnableWithMessageHistory<br/>+ custom trimming (k)"]
        M3["RunnableWithMessageHistory<br/>+ LLM summarization"]
        M4["RunnableWithMessageHistory<br/>+ summary & recent-message buffer"]
    end

    L1 -.replaced by.-> M1
    L2 -.replaced by.-> M2
    L3 -.replaced by.-> M3
    L4 -.replaced by.-> M4

    style Legacy fill:#3a1f1f,stroke:#c0392b,color:#fff
    style Modern fill:#1f3a2a,stroke:#27ae60,color:#fff
```

All four modern replacements are built on the **same foundation** — `RunnableWithMessageHistory` — the difference is *how much history* gets passed to the model and *how* it's trimmed or compressed.

---

## 1️⃣ ConversationBufferMemory → `RunnableWithMessageHistory`

Stores the **entire conversation**, forever. Nothing is ever dropped.

```mermaid
sequenceDiagram
    participant U as User
    participant Mem as Buffer Memory
    participant L as LLM

    U->>Mem: "Hi, I'm Mohamed"
    U->>Mem: "I live in Cairo"
    U->>Mem: "I'm an AI Engineer"
    U->>Mem: "What do you know about me?"
    Mem->>L: Full history (all 4 messages)
    L->>U: "You're Mohamed, from Cairo, an AI Engineer!"
```

| | |
|---|---|
| **Stores** | Entire conversation |
| **Token usage** | 📈 High, grows forever |
| **Best for** | Short chats, learning, debugging |
| **Risk** | Eventually exceeds the model's context window |
| **Replacement** | `RunnableWithMessageHistory` (unbounded `InMemoryChatMessageHistory`) |

---

## 2️⃣ ConversationBufferWindowMemory → `RunnableWithMessageHistory` + trimming

Keeps only the **last K messages** — older ones silently fall off.

```mermaid
flowchart LR
    subgraph Window["Sliding Window (k=2 turns)"]
        direction LR
        M1["❌ Hi, I'm Mohamed"] -.dropped.-> M2["✅ I live in Cairo"]
        M2 --> M3["✅ I'm an AI Engineer"]
    end
    M3 --> Q["What do you know about me?"]
    Q --> LLM["LLM sees only ✅ messages"]
```

| | |
|---|---|
| **Stores** | Last `k` conversation turns |
| **Token usage** | 📉 Low, fixed size |
| **Best for** | Support bots, short-context tasks |
| **Risk** | Forgets names/facts mentioned outside the window |
| **Replacement** | A custom `BaseChatMessageHistory` subclass that trims `self.messages` to the last `k` on every `add_messages()` call, plugged into `RunnableWithMessageHistory` via `ConfigurableFieldSpec` |

---

## 3️⃣ ConversationSummaryMemory → `RunnableWithMessageHistory` + summarization

Instead of storing raw messages, an **LLM call** rewrites a running summary every time.

```mermaid
flowchart TD
    A["Hi, I'm Mohamed"] --> S1["📝 Summary:<br/>User is Mohamed"]
    S1 --> B["I live in Egypt"] --> S2["📝 Summary:<br/>User is Mohamed, lives in Egypt"]
    S2 --> C["I'm a CS graduate"] --> S3["📝 Summary:<br/>Mohamed, Egypt, CS graduate"]
    S3 --> Q["What do you know about me?"]
    Q --> LLM["LLM receives only the latest summary"]
```

| | |
|---|---|
| **Stores** | One continuously-updated summary |
| **Token usage** | 📉 Low, but costs an **extra LLM call** per turn |
| **Best for** | Long-running assistants where full history isn't needed |
| **Risk** | Summary can drop or distort details over time |
| **Replacement** | A custom `BaseChatMessageHistory` subclass whose `add_messages()` calls the LLM to regenerate a `SystemMessage` summary each time, wired into `RunnableWithMessageHistory` |

---

## 4️⃣ ConversationSummaryBufferMemory → `RunnableWithMessageHistory` + summary + window

The **hybrid**: old messages become a summary, recent messages stay verbatim.

```mermaid
flowchart TD
    subgraph Old["Older messages"]
        O1["Hi, I'm Mohamed"]
        O2["I live in Egypt"]
        O3["I'm a CS graduate"]
    end
    subgraph Recent["Kept verbatim (last k)"]
        R1["I enjoy reading new info"]
    end

    Old --> Sum["📝 Summarize via LLM"]
    Sum --> Combined["Summary + Recent Messages"]
    Recent --> Combined
    Combined --> LLM["LLM"]
```

| | |
|---|---|
| **Stores** | Summary (old) **+** raw messages (recent) |
| **Token usage** | ⚖️ Medium — balanced |
| **Best for** | Production chatbots needing both long-term & recent context |
| **Risk** | Most complex to implement/reason about |
| **Replacement** | A custom `BaseChatMessageHistory` subclass combining both strategies above: trims to the last `k` messages and folds anything older into a `SystemMessage` summary |

---

## 📊 Side-by-Side Comparison

| Memory Type | Stores | Token Usage | Extra LLM Calls? | Loses Info? |
|---|---|---|---|---|
| `ConversationBufferMemory` | Everything | 🔴 High (grows forever) | No | Never |
| `ConversationBufferWindowMemory` | Last `k` turns | 🟢 Low (fixed) | No | Yes, older messages |
| `ConversationSummaryMemory` | Running summary | 🟢 Low | Yes, every turn | Yes, fine detail |
| `ConversationSummaryBufferMemory` | Summary + last `k` | 🟡 Medium | Yes, when window overflows | Only oldest detail |

---

## 🛠️ The One Pattern Behind All Modern Replacements

Regardless of which strategy you need, the modern approach always follows the same shape:

```mermaid
flowchart LR
    A["ChatPromptTemplate<br/>+ MessagesPlaceholder"] --> B["pipeline = prompt \| llm"]
    B --> C["Custom BaseChatMessageHistory<br/>(defines what 'memory' means)"]
    C --> D["RunnableWithMessageHistory<br/>(wires history into the pipeline)"]
    D --> E["invoke(..., config={'session_id': ...})"]
```

- **What differs** between the four modern examples is only the `BaseChatMessageHistory` subclass's `add_messages()` logic (keep all / keep last k / summarize / summarize + keep last k).
- **What stays the same** is the `ChatPromptTemplate` → `pipeline` → `RunnableWithMessageHistory` wiring.

---

## ⚙️ Requirements

```bash
pip install langchain langchain-core langchain-classic langchain-groq pydantic
```

```python
import os
os.environ["GROQ_API_KEY"] = "your-key-here"
```

---

## ✅ Recommendation

| If you need... | Use... |
|---|---|
| Simple prototyping, short chats | `RunnableWithMessageHistory` (unbounded) |
| Fixed, predictable memory cost | `RunnableWithMessageHistory` + trimming (`k`) |
| Long conversations, don't need exact wording | `RunnableWithMessageHistory` + summarization |
| Production apps needing both long-term + recent context | `RunnableWithMessageHistory` + summary + recent window |

**Never** start a new project with the legacy `Conversation*Memory` classes — they're kept only for maintaining old code.
