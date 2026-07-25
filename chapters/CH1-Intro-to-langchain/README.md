# Intro to LangChain

A beginner-friendly notebook covering the core building blocks of **LangChain** — prompts, chains, and tool integration — using Groq for text generation and Hugging Face FLUX.1 for image generation.

## Concepts Covered

### 1. Chat Models
- `ChatGroq` — connecting to an LLM (LLaMA 3.3 70B) through Groq
- **Temperature control** — using two instances of the same model with different `temperature` values to compare deterministic output (`0.0`) vs. creative/varied output (`0.9`)

### 2. Prompt Templates
- `SystemMessagePromptTemplate` — defines the AI's role/persona
- `HumanMessagePromptTemplate` — defines the user's task/instructions
- `ChatPromptTemplate.from_messages([...])` — combining system + human messages into one structured prompt
- Using **input variables** (e.g. `{article}`, `{name}`) to make templates reusable with different data
- `PromptTemplate` — a simpler, single-string template (used later for the image prompt)

### 3. LCEL (LangChain Expression Language)
- Building chains with the `|` pipe operator to connect components in sequence
- Using dict-based input mapping (`{"article": lambda x: x["article"], ...}`) to shape data flowing into a prompt
- Passing output from one chain as input into the next (chaining multiple LLM calls together)
- Wrapping final output into structured dicts for easy handoff between steps

### 4. Runnables
- Wrapping plain Python functions (like an image-generation function) as LangChain **Runnables**, so non-LLM logic can be plugged directly into an LCEL chain alongside prompts and models

### 5. Multi-Modal / Tool Integration
- Combining an LLM step (generating a text prompt) with a non-text tool (`InferenceClient` + FLUX.1-schnell) in the same chain
- Shows LangChain isn't limited to text-in/text-out — it can orchestrate calls to other APIs and services as pipeline steps

## Requirements

```bash
pip install langchain langchain-groq langchain-core huggingface_hub matplotlib
```

## API Keys

- **Groq API key** → console.groq.com
- **Hugging Face access token** → huggingface.co/settings/tokens

Don't hardcode keys in the notebook — use a `.env` file and `load_dotenv()` instead. The current notebook has real-looking keys hardcoded; rotate and remove them before sharing.

## How to run

Open `intro-to-langchain.ipynb` and run the cells top to bottom — each concept is introduced with a markdown cell right before the code that demonstrates it.
