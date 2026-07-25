import json
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.messages import (
    BaseMessage,
    SystemMessage,
    ToolMessage,
    AIMessage,
    HumanMessage,
)
from langchain_core.prompts import (
    ChatPromptTemplate,
    SystemMessagePromptTemplate,
    HumanMessagePromptTemplate,
)
from langchain_groq import ChatGroq


# -------------------------- storage location -----------------------------------------------------
STORAGE_DIR = Path("chat_sessions")
STORAGE_DIR.mkdir(exist_ok=True)


# -------------------------- rough token estimator (no tiktoken needed) -----------------------------------------------------
def _estimate_tokens(text: str) -> int:
    """Rough estimate: ~1 token per 4 characters. Good enough to cap context size."""
    return len(text) // 4


def _message_text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, list):
        # some messages (e.g. tool results) can have list content
        content = " ".join(str(c) for c in content)
    return str(content)


# -------------------------- serialization helpers (to save/load messages as JSON) -----------------------------------------------------
_MESSAGE_TYPES = {
    "human": HumanMessage,
    "ai": AIMessage,
    "system": SystemMessage,
    "tool": ToolMessage,
}


def _message_to_dict(message: BaseMessage) -> dict:
    data = {"type": message.type, "content": message.content}
    if isinstance(message, AIMessage) and message.tool_calls:
        data["tool_calls"] = message.tool_calls
    if isinstance(message, ToolMessage):
        data["tool_call_id"] = message.tool_call_id
    return data


def _dict_to_message(data: dict) -> BaseMessage:
    msg_type = data["type"]
    cls = _MESSAGE_TYPES.get(msg_type, HumanMessage)
    kwargs = {"content": data["content"]}
    if msg_type == "ai" and "tool_calls" in data:
        kwargs["tool_calls"] = data["tool_calls"]
    if msg_type == "tool" and "tool_call_id" in data:
        kwargs["tool_call_id"] = data["tool_call_id"]
    return cls(**kwargs)


# -------------------------- the memory class itself -----------------------------------------------------
class ConversationSummaryBufferMessageHistory(BaseChatMessageHistory, BaseModel):
    """Keeps the last `k` messages (on safe boundaries, never splitting
    an AIMessage(tool_calls) from its ToolMessage results), summarizing
    everything older. Also enforces a max token budget as a hard ceiling.
    Persists to a JSON file per session_id so history survives restarts.
    """

    model_config = {"arbitrary_types_allowed": True}

    session_id: str
    messages: list[BaseMessage] = Field(default_factory=list)
    llm: Any = Field(default_factory=lambda: ChatGroq(model="llama-3.3-70b-versatile"))
    k: int = 5
    max_tokens: int = 3000

    def __init__(self, session_id: str, llm: Any = None, k: int = 5, max_tokens: int = 3000):
        super().__init__(
            session_id=session_id,
            llm=llm or ChatGroq(model="llama-3.3-70b-versatile"),
            k=k,
            max_tokens=max_tokens,
        )
        self._load()

    # ---------------- persistence ----------------
    def _file_path(self) -> Path:
        return STORAGE_DIR / f"{self.session_id}.json"

    def _load(self) -> None:
        path = self._file_path()
        if path.exists():
            raw = json.loads(path.read_text(encoding="utf-8"))
            self.messages = [_dict_to_message(m) for m in raw]

    def _save(self) -> None:
        raw = [_message_to_dict(m) for m in self.messages]
        self._file_path().write_text(json.dumps(raw, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---------------- safe boundary splitting ----------------
    def _split_at_safe_boundary(self, messages: list[BaseMessage], keep: int) -> tuple[list[BaseMessage], list[BaseMessage]]:
        """Never let `recent` start with a ToolMessage whose parent
        AIMessage(tool_calls) got cut off into `old`."""
        if len(messages) <= keep:
            return [], messages

        split_index = len(messages) - keep
        while split_index < len(messages) and isinstance(messages[split_index], ToolMessage):
            split_index += 1

        return messages[:split_index], messages[split_index:]

    # ---------------- core add_messages logic ----------------
    def add_messages(self, messages: list[BaseMessage]) -> None:
        existing_summary: SystemMessage | None = None
        if len(self.messages) > 0 and isinstance(self.messages[0], SystemMessage):
            existing_summary = self.messages.pop(0)

        self.messages.extend(messages)

        old_messages: list[BaseMessage] = []

        # 1) trim by message count (k), on a safe boundary
        if len(self.messages) > self.k:
            old_messages, self.messages = self._split_at_safe_boundary(self.messages, self.k)

        # 2) hard safety net: trim by token budget too, in case k messages
        #    themselves are huge (e.g. long fetched webpage text)
        while self.messages:
            total_tokens = sum(_estimate_tokens(_message_text(m)) for m in self.messages)
            if total_tokens <= self.max_tokens:
                break
            # move the oldest remaining message (on a safe boundary) into old_messages
            more_old, self.messages = self._split_at_safe_boundary(self.messages, len(self.messages) - 1)
            old_messages.extend(more_old)

        if not old_messages:
            if existing_summary:
                self.messages = [existing_summary] + self.messages
            self._save()
            return

        # 3) summarize whatever got dropped
        existing_summary_text = existing_summary.content if existing_summary else "No previous summary."
        old_messages_text = "\n".join(f"{m.type}: {_message_text(m)}" for m in old_messages)

        summary_prompt = ChatPromptTemplate.from_messages([
            SystemMessagePromptTemplate.from_template(
                "Given the existing conversation summary and the new messages, "
                "generate a new summary of the conversation. Keep as much "
                "relevant information as possible, but be concise."
            ),
            HumanMessagePromptTemplate.from_template(
                "Existing conversation summary:\n{existing_summary}\n\n"
                "New messages:\n{old_messages}"
            ),
        ])

        new_summary = self.llm.invoke(
            summary_prompt.format_messages(
                existing_summary=existing_summary_text,
                old_messages=old_messages_text,
            )
        )

        self.messages = [SystemMessage(content=new_summary.content)] + self.messages
        self._save()

    def clear(self) -> None:
        self.messages = []
        path = self._file_path()
        if path.exists():
            path.unlink()


# -------------------------- session factory (used by RunnableWithMessageHistory) -----------------------------------------------------
_session_store: dict[str, ConversationSummaryBufferMessageHistory] = {}


def get_session_history(session_id: str) -> ConversationSummaryBufferMessageHistory:
    """Returns (or creates) the memory object for a given session_id.
    Pass this function to RunnableWithMessageHistory(get_session_history=...)."""
    if session_id not in _session_store:
        _session_store[session_id] = ConversationSummaryBufferMessageHistory(
            session_id=session_id, k=5, max_tokens=3000
        )
    return _session_store[session_id]

