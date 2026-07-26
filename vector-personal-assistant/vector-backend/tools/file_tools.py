import io
import re
import httpx
import os
from langchain_core.tools import tool
from pydantic import SecretStr

import pypdf
import docx
import pandas as pd
import pytesseract
from PIL import Image
from pdf2image import convert_from_bytes
from youtube_transcript_api import YouTubeTranscriptApi
from dotenv import load_dotenv

from pydantic import BaseModel
from typing import Any

load_dotenv()

OPENROUTER_API_KEY = SecretStr(os.environ["OPENROUTER_API_KEY"])
YOUTUBE_API_KEY = SecretStr(os.environ["YOUTUBE_API_KEY"])


class ToolResponse(BaseModel):
    success: bool
    data: Any = None
    error: str | None = None
# -------------------------- PDF reader (with OCR fallback) -----------------------------------------------------
@tool
async def read_pdf(file_path: str, lang: str = "eng+ara") -> ToolResponse:
    """Extract text from a PDF file on disk, given its absolute path (as returned by the /upload endpoint).
    Falls back to OCR automatically if the PDF is scanned (no selectable text)."""
    try:
        with open(file_path, "rb") as f:
            file_bytes = f.read()
        reader = pypdf.PdfReader(io.BytesIO(file_bytes))
        text = "\n".join(page.extract_text() or "" for page in reader.pages)

        if len(text.strip()) < 20:
            images = convert_from_bytes(file_bytes)
            text = "\n".join(pytesseract.image_to_string(img, lang=lang) for img in images)

        return ToolResponse(success=True, data=text[:8000])
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# -------------------------- DOCX reader -----------------------------------------------------
@tool
async def read_docx(file_path: str) -> ToolResponse:
    """Extract text from a Word (.docx) file on disk, given its absolute path (as returned by the /upload endpoint)."""
    try:
        with open(file_path, "rb") as f:
            file_bytes = f.read()
        document = docx.Document(io.BytesIO(file_bytes))
        text = "\n".join(p.text for p in document.paragraphs)
        return ToolResponse(success=True, data=text[:8000])
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# -------------------------- CSV reader -----------------------------------------------------
@tool
async def read_csv(file_path: str) -> ToolResponse:
    """Read a CSV file on disk, given its absolute path (as returned by the /upload endpoint). Returns a summary (columns, row count, first rows)."""
    try:
        with open(file_path, "rb") as f:
            file_bytes = f.read()
        df = pd.read_csv(io.BytesIO(file_bytes))
        summary = {
            "columns": list(df.columns),
            "row_count": len(df),
            "preview": df.head(5).to_dict(orient="records"),
        }
        return ToolResponse(success=True, data=summary)
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# -------------------------- Excel reader (all sheets) -----------------------------------------------------
@tool
async def read_excel(file_path: str) -> ToolResponse:
    """Read an Excel (.xlsx) file on disk, given its absolute path (as returned by the /upload endpoint). Returns all sheet names and a preview of each."""
    try:
        with open(file_path, "rb") as f:
            file_bytes = f.read()
        excel_file = pd.ExcelFile(io.BytesIO(file_bytes))

        sheets_summary = {}
        for sheet_name in excel_file.sheet_names:
            df = excel_file.parse(sheet_name)
            sheets_summary[sheet_name] = {
                "columns": list(df.columns),
                "row_count": len(df),
                "preview": df.head(5).to_dict(orient="records"),
            }

        return ToolResponse(
            success=True,
            data={"sheet_names": excel_file.sheet_names, "sheets": sheets_summary},
        )
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# -------------------------- unified file reader -----------------------------------------------------
@tool
async def read_file(file_path: str) -> ToolResponse:
    """Read a file (PDF, DOCX, XLSX, CSV, or TXT) on disk, given its absolute path (as returned by the /upload endpoint). File type is detected from the extension."""
    extension = file_path.lower().split(".")[-1]

    if extension == "pdf":
        return await read_pdf.ainvoke({"file_path": file_path})
    elif extension == "docx":
        return await read_docx.ainvoke({"file_path": file_path})
    elif extension in ("xlsx", "xls"):
        return await read_excel.ainvoke({"file_path": file_path})
    elif extension == "csv":
        return await read_csv.ainvoke({"file_path": file_path})
    elif extension == "txt":
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                text = f.read()
            return ToolResponse(success=True, data=text[:8000])
        except Exception as e:
            return ToolResponse(success=False, error=str(e))
    else:
        return ToolResponse(success=False, error=f"Unsupported file type: .{extension}")


# -------------------------- OCR (with language support) -----------------------------------------------------
@tool
async def ocr_image(image_path: str, lang: str = "eng+ara") -> ToolResponse:
    """Extract text from an image on disk (OCR), given its absolute path (as returned by the /upload endpoint).
    lang examples: 'eng', 'ara', 'eng+ara' for both languages."""
    try:
        image = Image.open(image_path)
        text = pytesseract.image_to_string(image, lang=lang)
        return ToolResponse(success=True, data=text.strip())
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# -------------------------- Summarizer (with options) -----------------------------------------------------
@tool
async def summarize_text(
    text: str, max_words: int = 150, style: str = "paragraph", language: str = "auto"
) -> ToolResponse:
    """Summarize a long piece of text.
    style: 'paragraph' or 'bullet'. language: 'auto', 'arabic', or 'english'."""

    instructions = f"Summarize the text in no more than {max_words} words."
    if style == "bullet":
        instructions += " Format the summary as bullet points."
    if language != "auto":
        instructions += f" Write the summary in {language}."

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY.get_secret_value()}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "nvidia/nemotron-3-ultra-550b-a55b:free",
                    "messages": [
                        {"role": "system", "content": instructions},
                        {"role": "user", "content": text[:12000]},
                    ],
                },
            )
    except httpx.RequestError as e:
        return ToolResponse(success=False, error=f"Request failed: {e}")

    if response.status_code != 200:
        return ToolResponse(success=False, error=f"Failed. Status: {response.status_code}")

    data = response.json()
    return ToolResponse(success=True, data=data["choices"][0]["message"]["content"])


# -------------------------- YouTube helpers -----------------------------------------------------
def _extract_video_id(video_url_or_id: str) -> str:
    if "watch?v=" in video_url_or_id:
        return video_url_or_id.split("watch?v=")[1].split("&")[0]
    elif "youtu.be/" in video_url_or_id:
        return video_url_or_id.split("youtu.be/")[1].split("?")[0]
    return video_url_or_id


def _parse_duration(iso_duration: str) -> str:
    """Convert ISO 8601 duration (e.g. PT1H2M10S) to a readable format like 1:02:10."""
    match = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", iso_duration)
    hours, minutes, seconds = (int(g) if g else 0 for g in match.groups())
    if hours:
        return f"{hours}:{minutes:02d}:{seconds:02d}"
    return f"{minutes}:{seconds:02d}"


# -------------------------- YouTube transcript + metadata -----------------------------------------------------
@tool
async def youtube_transcript(video_url_or_id: str) -> ToolResponse:
    """Fetch the transcript, title, channel, and duration of a YouTube video given its URL or video ID."""
    try:
        video_id = _extract_video_id(video_url_or_id)

        async with httpx.AsyncClient(timeout=15) as client:
            api_response = await client.get(
                "https://www.googleapis.com/youtube/v3/videos",
                params={
                    "id": video_id,
                    "part": "snippet,contentDetails",
                    "key": YOUTUBE_API_KEY.get_secret_value(),
                },
            )
        items = api_response.json().get("items", [])
        if not items:
            return ToolResponse(success=False, error="Video not found.")

        snippet = items[0]["snippet"]
        duration = _parse_duration(items[0]["contentDetails"]["duration"])

        transcript = YouTubeTranscriptApi.get_transcript(video_id)
        full_text = " ".join(chunk["text"] for chunk in transcript)

        return ToolResponse(
            success=True,
            data={
                "title": snippet.get("title"),
                "channel": snippet.get("channelTitle"),
                "duration": duration,
                "transcript": full_text[:8000],
            },
        )
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# -------------------------- YouTube search -----------------------------------------------------
@tool
async def youtube_search(query: str, max_results: int = 5) -> ToolResponse:
    """Search YouTube for videos matching a query. Returns titles, channels, and video links."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            search_response = await client.get(
                "https://www.googleapis.com/youtube/v3/search",
                params={
                    "q": query,
                    "part": "snippet",
                    "type": "video",
                    "maxResults": max_results,
                    "key": YOUTUBE_API_KEY.get_secret_value(),
                },
            )
        items = search_response.json().get("items", [])

        results = [
            {
                "title": item["snippet"]["title"],
                "channel": item["snippet"]["channelTitle"],
                "video_url": f"https://www.youtube.com/watch?v={item['id']['videoId']}",
            }
            for item in items
        ]
        return ToolResponse(success=True, data=results)
    except Exception as e:
        return ToolResponse(success=False, error=str(e))
