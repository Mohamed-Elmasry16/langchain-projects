import os
import re
import json
import asyncio
import logging
from typing import AsyncIterator

from dotenv import load_dotenv
from langchain_core.messages import BaseMessage, HumanMessage, AIMessage, ToolMessage
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.base import RunnableSerializable
from langchain_core.callbacks.base import AsyncCallbackHandler


from tools.basic_tools import (
    generate_image, serpapi, write_code, fetch_webpage, calculator,
    get_current_datetime, wikipedia_search, currency_converter, weather,
    unit_converter, uuid_generator, final_answer,
)
from tools.file_tools import (
    read_pdf, read_docx, read_csv, read_excel, read_file, ocr_image,
    summarize_text, youtube_transcript, youtube_search,
)
from memory.memory import get_session_history

load_dotenv()

logger = logging.getLogger("agent")
logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"))




# -------------------------- LLM (Groq, streaming) -----------------------------------------------------
"""from langchain_nvidia_ai_endpoints import ChatNVIDIA


llm = ChatNVIDIA(
  model="z-ai/glm-5.2",
  api_key=os.environ["NIVDIA_API_KEY"], 
  temperature=0,
  max_tokens=16384,
  reasoning_budget=16384,
  chat_template_kwargs={"enable_thinking":True},
)"""

"""from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    model="openai/gpt-oss-20b:free",
    base_url="https://openrouter.ai/api/v1",
    api_key=os.environ["OPENROUTER_API_KEY"],
    temperature=0,
)"""
from langchain_groq import ChatGroq

llm = ChatGroq(
    model=os.environ.get("AGENT_MODEL", "llama-3.3-70b-versatile"),
    api_key=os.environ["GROQ_API_KEY2"],
    temperature=0,
    streaming=True,
)


# -------------------------- tools -----------------------------------------------------
tools = [
    generate_image, serpapi, write_code, fetch_webpage, calculator,
    get_current_datetime, wikipedia_search, currency_converter, weather,
    unit_converter, uuid_generator,
    read_pdf, read_docx, read_csv, read_excel, read_file, ocr_image,
    summarize_text, youtube_transcript, youtube_search]
name2tool = {t.name: t.coroutine or t.func for t in tools}


# -------------------------- prompt -----------------------------------------------------
SYSTEM_PROMPT = (
    "You're a helpful general-purpose assistant called vector made by ENG/Mohamed Waleed Elmasry with access to many tools "
    "(web search, webpage fetching, image generation, file reading, code "
    "writing, and utilities like weather/currency/calculator). "
    "Always use a tool to gather information before answering. "
    "Once you have what you need, structure the answer to give  to the user  "
    "reply to the user in natural language. Do not call the same tool "
    "more than once unless the result clearly failed. "
    "IMPORTANT: When a tool like generate_image returns an image, do NOT "
    "try to embed, reference, or write out any image data, markdown image "
    "syntax, placeholders, or base64 strings in your final_answer text. "
    "The image is already delivered to the user separately. Just confirm "
    "in plain words that the image was generated (e.g. 'Here's the image "
    "you asked for.') without any markdown image tags."
)

prompt = ChatPromptTemplate.from_messages([
    ("system", SYSTEM_PROMPT),
    MessagesPlaceholder(variable_name="chat_history"),
    ("human", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad"),
])


# -------------------------- sanitizing tool output before it goes back to the LLM -----------------------------------------------------
MAX_TOOL_TEXT_CHARS = 2000  # generous but bounded -- keeps token usage predictable


def _sanitize_for_llm(tool_result) -> str:
    """Strip large/base64 payloads and cap length before feeding a tool
    result back to the LLM as context. Images and long documents don't
    need to round-trip through the model -- doing so blows past
    tokens-per-minute limits fast. The full, untouched result still goes
    to the frontend via the tool_end event."""
    data = getattr(tool_result, "data", tool_result)

    if isinstance(data, dict) and "image_base64" in data:
        size_kb = len(data["image_base64"]) // 1024
        return f"Image generated successfully ({size_kb} KB, mime: {data.get('mime_type', 'image/jpeg')})."

    text = str(data)
    if len(text) > MAX_TOOL_TEXT_CHARS:
        return text[:MAX_TOOL_TEXT_CHARS] + f"... [truncated, {len(text)} chars total]"
    return text


def _strip_fake_image_syntax(text: str) -> str:
    """Remove any hallucinated markdown image tags the model might slip
    into a final answer despite instructions not to. The real image
    already went out via tool_end."""
    return re.sub(r"!\[.*?\]\(.*?\)", "", text).strip()


def _extract_answer_if_faked(raw: str) -> str:
    """If the model wrote its final_answer call as raw text/JSON instead
    of a proper tool_calls entry, pull the human-readable answer out of
    it rather than showing a raw JSON blob to the user."""
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group(0))
            if isinstance(parsed, dict) and "answer" in parsed:
                return parsed["answer"]
        except json.JSONDecodeError:
            pass
    return raw


def _clean_final_text(raw: str) -> str:
    """Single choke point for anything about to be shown to the user as
    a final answer, regardless of which code path produced it."""
    text = _extract_answer_if_faked(raw or "")
    text = _strip_fake_image_syntax(text)
    return text or "I couldn't produce a response for that request."


# -------------------------- streaming callback handler -----------------------------------------------------
class QueueCallbackHandler(AsyncCallbackHandler):
    """Pushes every streamed chunk into an asyncio.Queue as it arrives."""

    def __init__(self, queue: asyncio.Queue):
        self.queue = queue
        self.final_answer_seen = False

    async def __aiter__(self):
        while True:
            if self.queue.empty():
                await asyncio.sleep(0.05)
                continue
            item = await self.queue.get()
            if item == "<<DONE>>":
                return
            if item:
                yield item

    async def on_llm_new_token(self, *args, **kwargs) -> None:
        chunk = kwargs.get("chunk")
        if chunk:
            tool_calls = chunk.message.additional_kwargs.get("tool_calls")
            if tool_calls and tool_calls[0]["function"]["name"] == "final_answer":
                self.final_answer_seen = True
            await self.queue.put(chunk)

    async def on_llm_end(self, *args, **kwargs) -> None:
        if self.final_answer_seen:
            await self.queue.put("<<DONE>>")
        else:
            await self.queue.put("<<STEP_END>>")


# -------------------------- the agent executor -----------------------------------------------------
class CustomAgentExecutor:
    def __init__(self, session_id: str, max_iterations: int = 5):
        self.session_id = session_id
        self.memory = get_session_history(session_id)
        self.max_iterations = max_iterations
        self.agent: RunnableSerializable = (
            {
                "input": lambda x: x["input"],
                "chat_history": lambda x: x["chat_history"],
                "agent_scratchpad": lambda x: x.get("agent_scratchpad", []),
            }
            | prompt
            | llm.bind_tools(tools, tool_choice="auto")
        )

    async def stream(self, user_input: str, streamer: QueueCallbackHandler) -> AsyncIterator[dict]:
        """Yields events as the agent runs:
        {"type": "tool_start", "tool": name}
        {"type": "tool_args_chunk", "chunk": str}
        {"type": "tool_end", "tool": name, "result": ...}   # FULL result (base64 etc.) for the frontend
        {"type": "answer_chunk", "content": str}
        {"type": "answer", "content": str}
        {"type": "error", "content": str}                   # distinct from a normal answer
        {"type": "done"}
        """
        count = 0
        agent_scratchpad: list[BaseMessage] = []

        while count < self.max_iterations:
            output = None
            announced_tools: set = set()

            response = self.agent.with_config(callbacks=[streamer])
            try:
                async for token in response.astream({
                    "input": user_input,
                    "chat_history": self.memory.messages,
                    "agent_scratchpad": agent_scratchpad,
                }):
                    output = token if output is None else output + token

                    tool_calls = token.additional_kwargs.get("tool_calls")
                    if tool_calls:
                        for tc in tool_calls:
                            tool_name = tc.get("function", {}).get("name")
                            if tool_name and tool_name not in announced_tools:
                                announced_tools.add(tool_name)
                                yield {"type": "tool_start", "tool": tool_name}

                            arg_chunk = tc.get("function", {}).get("arguments")
                            if arg_chunk:
                                yield {"type": "tool_args_chunk", "chunk": arg_chunk}
                    elif token.content:
                        yield {"type": "answer_chunk", "content": token.content}
            except Exception as e:
                logger.exception("Provider error during agent stream (session=%s)", self.session_id)
                fallback_text = (
                    "I ran into a provider error trying to use a tool for that "
                    "request. Could you rephrase, or ask something that needs "
                    "fewer/simpler tool calls?"
                )
                yield {"type": "error", "content": str(e)}
                yield {"type": "answer", "content": fallback_text}
                self.memory.add_messages([
                    HumanMessage(content=user_input),
                    AIMessage(content=fallback_text),
                ])
                yield {"type": "done"}
                return

            if output is None:
                fallback_text = "I didn't get a response from the model for that request."
                yield {"type": "answer", "content": fallback_text}
                self.memory.add_messages([
                    HumanMessage(content=user_input),
                    AIMessage(content=fallback_text),
                ])
                yield {"type": "done"}
                return

            ai_message = AIMessage(
                content=output.content or "",
                tool_calls=output.tool_calls,
            )
            agent_scratchpad.append(ai_message)

            if not ai_message.tool_calls:
                fallback_text = _clean_final_text(ai_message.content)
                yield {"type": "answer", "content": fallback_text}
                self.memory.add_messages([
                    HumanMessage(content=user_input),
                    AIMessage(content=fallback_text),
                ])
                yield {"type": "done"}
                return

            # Handle every tool call the model made this turn, not just the
            # first -- some providers/models legitimately return more than
            # one when tool_choice="auto".
            saw_final_answer = False
            final_answer_text = ""

            for tc in ai_message.tool_calls:
                tool_name = tc["name"]
                tool_args = tc["args"]
                tool_call_id = tc["id"]

                if tool_name == "final_answer":
                    saw_final_answer = True
                    final_answer_text = _clean_final_text(tool_args.get("answer", ""))
                    # A model that emits final_answer alongside other tool
                    # calls in the same turn is a request to stop here; we
                    # don't execute further tools after seeing it.
                    break

                tool_fn = name2tool.get(tool_name)
                if tool_fn is None:
                    logger.warning("Model requested unknown tool: %s", tool_name)
                    agent_scratchpad.append(
                        ToolMessage(content=f"Unknown tool: {tool_name}", tool_call_id=tool_call_id)
                    )
                    continue

                try:
                    tool_result = (
                        await tool_fn(**tool_args)
                        if asyncio.iscoroutinefunction(tool_fn)
                        else tool_fn(**tool_args)
                    )
                except Exception as e:
                    logger.exception("Tool %s failed (session=%s)", tool_name, self.session_id)
                    tool_result = f"Tool error: {e}"

                llm_facing_content = _sanitize_for_llm(tool_result)
                agent_scratchpad.append(
                    ToolMessage(content=llm_facing_content, tool_call_id=tool_call_id)
                )
                yield {"type": "tool_end", "tool": tool_name, "result": tool_result}

            if saw_final_answer:
                yield {"type": "answer", "content": final_answer_text}
                self.memory.add_messages([
                    HumanMessage(content=user_input),
                    AIMessage(content=final_answer_text),
                ])
                yield {"type": "done"}
                return

            count += 1

        yield {"type": "answer", "content": "I couldn't complete the task in time."}
        yield {"type": "done"}


# -------------------------- quick manual test -----------------------------------------------------
async def _test():
    executor = CustomAgentExecutor(session_id="test_session")
    queue = asyncio.Queue()
    streamer = QueueCallbackHandler(queue)

    async for event in executor.stream(
        "who is harry potter and where he lived and what is the weather in this country now and generate an image of him",
        streamer,
    ):
        if event["type"] == "answer_chunk":
            print(event["content"], end="", flush=True)
        elif event["type"] == "answer":
            print("\n\n=== FINAL ANSWER ===")
            print(event["content"])
        elif event["type"] == "error":
            print(f"\n[ERROR] {event['content']}")
        elif event["type"] == "tool_start":
            print(f"\n[calling {event['tool']}...]")
        elif event["type"] == "tool_args_chunk":
            print(event["chunk"], end="", flush=True)
        elif event["type"] == "tool_end":
            result = event["result"]
            data = getattr(result, "data", result)
            if isinstance(data, dict) and "image_base64" in data:
                print(f"\n[{event['tool']} -> image received, {len(data['image_base64'])//1024} KB]")
            else:
                print(f"\n[{event['tool']} -> {result}]")


if __name__ == "__main__":
    asyncio.run(_test())
