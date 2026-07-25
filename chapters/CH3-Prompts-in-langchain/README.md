# 🧠 Prompting in LangChain — Basics to Chain-of-Thought

A hands-on notebook that walks through the core building blocks of prompting in **LangChain**, from constructing a simple template all the way to **Few-Shot** and **Chain-of-Thought (CoT)** prompting — using **Groq's `llama-3.3-70b-versatile`** as the LLM.

---

## 📖 Terminology

Before diving into the code, here's what each term used in the notebook actually means:

| Term | Definition |
|---|---|
| **Prompt** | The text (instructions + input) sent to an LLM to produce a response. |
| **System Prompt / Rules** | Instructions that define the model's role, behavior, tone, and constraints for the whole conversation. |
| **Context** | External/retrieved information (docs, DB rows, search results) injected into the prompt so the model answers using facts rather than guessing. This is the "R" in **RAG**. |
| **RAG (Retrieval-Augmented Generation)** | A pattern where relevant information is *retrieved* from an external source and *fed into* the prompt before generation, grounding the answer in real data. |
| **Query / Question** | The actual request or question coming from the user. |
| **`ChatPromptTemplate`** | A LangChain class that turns a prompt string (with `{placeholders}`) into a reusable, fillable template for chat-based models. |
| **`input_variables`** | The list of placeholder names a `ChatPromptTemplate` expects to be filled in. |
| **`format_messages()`** | The method that renders a template into the final list of messages once real values are provided. |
| **`SystemMessagePromptTemplate` / `HumanMessagePromptTemplate`** | Explicit, message-type-specific ways to build a template, instead of using `("role", "text")` tuples. |
| **LLM (Large Language Model)** | The generative model that receives the prompt and produces text — here, Groq's `llama-3.3-70b-versatile`. |
| **`temperature`** | A setting that controls randomness in the model's output. `0.0` = deterministic/focused answers; higher values = more creative/varied answers. |
| **LCEL (LangChain Expression Language)** | The `\|` (pipe) syntax used to chain components together — e.g. `prompt_template \| llm` — so data flows from one step into the next. |
| **Pipeline / Chain** | A sequence of connected steps (inputs → prompt → model) built using LCEL. |
| **Few-Shot Prompting** | Showing the model a handful of example **input → output** pairs *before* the real request, so it learns the expected pattern (e.g., natural language → SQL) without any fine-tuning. |
| **`FewShotChatMessagePromptTemplate`** | A LangChain helper that formats a list of examples into a repeated message pattern, ready to be inserted into a larger prompt. |
| **Zero-Shot Prompting** | The opposite of few-shot — asking the model to perform a task with *no* examples, only instructions. |
| **Chain-of-Thought (CoT) Prompting** | Instructing the model to break a problem into subproblems, solve each one step-by-step, and then combine them into a final answer — improving accuracy on multi-step reasoning tasks. |
| **No-CoT Prompting** | Explicitly forcing the model to answer directly with no visible reasoning steps — usually faster but less accurate on complex questions. |
| **Implicit/Automatic Reasoning** | Many modern LLMs perform step-by-step reasoning internally by default, even without an explicit CoT instruction in the prompt. |

---

## 🗂️ Notebook Structure

1. **Basic Prompting** — the four core components of a prompt: Rules, Context, Question, Answer
2. **Creating a Prompt Template** — building a `ChatPromptTemplate` with placeholders
3. **Alternative: Message-Specific Templates** — using `SystemMessagePromptTemplate` / `HumanMessagePromptTemplate`
4. **Setting Up the LLM** — configuring `ChatGroq`
5. **Building the Chain (LCEL)** — connecting prompt → model with `|`
6. **Running the Pipeline** — a full RAG-style example (airline policy Q&A)
7. **Few-Shot Prompting** — teaching natural language → SQL translation via examples
8. **Chain-of-Thought Prompting**
   - Without CoT (direct answer)
   - With explicit CoT (step-by-step reasoning)
   - Note on models reasoning automatically by default

---

## ⚙️ Requirements

```bash
pip install langchain langchain-core langchain-groq
```

You'll also need a **Groq API key** — set it in the notebook:

```python
import os
os.environ["GROQ_API_KEY"] = "your-key-here"
```

---

## ▶️ How to Run

1. Install the requirements above.
2. Add your Groq API key.
3. Run the cells top to bottom — each section builds on the previous one's imports and variables.

---

## 💡 Key Takeaway

A good prompt isn't just a question — it's a combination of **rules, context, and the question itself**, structured through templates (`ChatPromptTemplate`), optionally enriched with **examples** (few-shot) or **reasoning steps** (chain-of-thought) to get more accurate, controllable answers from an LLM.
