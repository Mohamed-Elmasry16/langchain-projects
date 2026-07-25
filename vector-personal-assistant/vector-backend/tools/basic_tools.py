import time
import base64
import httpx
import urllib.parse
import aiohttp
import os
import uuid
from langchain_core.tools import tool
from pydantic import BaseModel, SecretStr
import asyncio
import numexpr
from datetime import datetime
from zoneinfo import ZoneInfo
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from pydantic import BaseModel
from typing import Any

load_dotenv()

OPENROUTER_API_KEY = SecretStr(os.environ["OPENROUTER_API_KEY"])
SERPAPI_API_KEY = SecretStr(os.environ["SERPAPI_API_KEY"])

# Wikimedia (and many other sites) reject requests with no/blank User-Agent
# or with a generic one -- they 403 them as likely bot/scraper traffic.
# Sending a real UA + identifying contact info is also part of Wikimedia's
# API etiquette policy.
DEFAULT_HEADERS = {
    "User-Agent": "PersonalAssistantAgent/1.0 (+https://example.com/contact; contact@example.com)",
    "Accept": "application/json",
}






class ToolResponse(BaseModel):
    success: bool
    data: Any = None
    error: str | None = None
# ---------------------------- image generation tool ---------------------------------------------------
_last_call_time = 0.0


@tool
async def generate_image(prompt: str) -> ToolResponse:
    """Generate an image from a text prompt. Returns image data as base64."""
    global _last_call_time

    elapsed = time.time() - _last_call_time
    if elapsed < 6:
        await asyncio.sleep(6 - elapsed)

    encoded_prompt = urllib.parse.quote(prompt)
    url = f"https://image.pollinations.ai/prompt/{encoded_prompt}?width=1024&height=1024"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.get(url)
    except httpx.RequestError as e:
        return ToolResponse(success=False, error=f"Request failed: {e}")

    _last_call_time = time.time()

    content_type = response.headers.get("content-type", "")
    if response.status_code == 200 and "image" in content_type:
        b64_image = base64.b64encode(response.content).decode("utf-8")
        return ToolResponse(
            success=True,
            data={"mime_type": content_type, "image_base64": b64_image, "provider": "Pollinations"},
        )
    return ToolResponse(success=False, error=f"Failed. Status: {response.status_code}")


# -------------------------- search tool -----------------------------------------------------
class Article(BaseModel):
    title: str
    source: str
    link: str
    snippet: str

    @classmethod
    def from_serpapi_result(cls, result: dict) -> "Article":
        return cls(
            title=result.get("title", ""),
            source=result.get("source", ""),
            link=result.get("link", ""),
            snippet=result.get("snippet", ""),
        )


class SearchResult(BaseModel):
    query: str
    articles: list[Article]


@tool
async def serpapi(query: str) -> ToolResponse:
    """Use this tool to search the web."""
    params = {
        "api_key": SERPAPI_API_KEY.get_secret_value(),
        "engine": "google",
        "q": query,
    }
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get("https://serpapi.com/search", params=params) as response:
                results = await response.json()
        organic = results.get("organic_results", [])
        articles = [Article.from_serpapi_result(r) for r in organic]
        return ToolResponse(success=True, data=SearchResult(query=query, articles=articles))
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# -------------------------- final answer tool -----------------------------------------------------
@tool
async def final_answer(answer: str, tools_used: list[str]) -> dict[str, str | list[str]]:
    """Use this tool to provide a final answer to the user."""
    return {"answer": answer, "tools_used": tools_used}


# -------------------------- coding tool -----------------------------------------------------
CODE_SYSTEM_PROMPT = """You are a senior software engineer writing production-grade code.

Rules:
- Write clean, correct, working code following language best practices.
- Do not explain your code unless the user explicitly asks for an explanation.
- Return the code inside a properly formatted Markdown code block with the correct language tag.
- Prefer clarity and maintainability over cleverness.
"""


@tool
async def write_code(task_description: str) -> ToolResponse:
    """Use this tool when the user needs code written, fixed, or explained.
    Pass a clear description of the coding task (language, what it should do)."""

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
                        {"role": "system", "content": CODE_SYSTEM_PROMPT},
                        {"role": "user", "content": task_description},
                    ],
                },
            )
    except httpx.RequestError as e:
        return ToolResponse(success=False, error=f"Request failed: {e}")

    if response.status_code != 200:
        return ToolResponse(success=False, error=f"Failed. Status: {response.status_code}")

    data = response.json()
    return ToolResponse(success=True, data=data["choices"][0]["message"]["content"])


# ------------------------------------------fetch_webpage tool-----------------------------------------------
MAX_CHARS = 5000
NOISE_TAGS = ["script", "style", "nav", "footer", "header", "aside", "form", "iframe"]


@tool
async def fetch_webpage(url: str) -> ToolResponse:
    """Fetch the main text content of a webpage given its URL."""
    try:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.get(url)
    except httpx.RequestError as e:
        return ToolResponse(success=False, error=f"Failed to fetch page: {e}")

    if response.status_code != 200:
        return ToolResponse(success=False, error=f"Failed. Status: {response.status_code}")

    soup = BeautifulSoup(response.text, "html.parser")
    for tag in soup(NOISE_TAGS):
        tag.decompose()

    text = soup.get_text(separator=" ", strip=True)
    return ToolResponse(success=True, data=text[:MAX_CHARS])


# --------------------------------calculator tool-------------------------
@tool
async def calculator(expression: str) -> ToolResponse:
    """Evaluate a math expression, e.g. '12 * (3 + 4)', 'sqrt(16)', 'sin(0)', 'log(10)'."""
    try:
        result = numexpr.evaluate(expression).item()
        return ToolResponse(success=True, data=result)
    except Exception as e:
        return ToolResponse(success=False, error=f"Invalid expression: {e}")


# --------------------------------current_datetime tool-------------------------
@tool
async def get_current_datetime() -> ToolResponse:
    """Returns the current date and time."""
    now = datetime.now(ZoneInfo("Africa/Cairo"))
    return ToolResponse(success=True, data=now.strftime("%Y-%m-%d %H:%M:%S %Z"))


# --------------------------------wikipedia_search tool-------------------------
@tool
async def wikipedia_search(query: str) -> ToolResponse:
    """Search Wikipedia and return a short summary of the topic."""
    encoded_query = urllib.parse.quote(query)
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{encoded_query}"

    try:
        async with httpx.AsyncClient(timeout=15, headers=DEFAULT_HEADERS) as client:
            response = await client.get(url)
    except httpx.RequestError as e:
        return ToolResponse(success=False, error=f"Request failed: {e}")

    if response.status_code == 403:
        return ToolResponse(success=False, error="Wikipedia blocked the request (403). Try again or use a different source.")
    if response.status_code != 200:
        return ToolResponse(success=False, error=f"No Wikipedia page found for '{query}'.")

    data = response.json()
    return ToolResponse(success=True, data=data.get("extract", "No summary available."))


# --------------------------------currency_converter tool-------------------------
@tool
async def currency_converter(amount: float, from_currency: str, to_currency: str) -> ToolResponse:
    """Convert an amount from one currency to another, e.g. amount=100, from_currency='USD', to_currency='EGP'."""
    url = (
        f"https://api.frankfurter.app/latest"
        f"?amount={amount}&from={from_currency.upper()}&to={to_currency.upper()}"
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(url)
    except httpx.RequestError as e:
        return ToolResponse(success=False, error=f"Request failed: {e}")

    if response.status_code != 200:
        return ToolResponse(success=False, error=f"Failed. Status: {response.status_code}")

    data = response.json()
    result = data.get("rates", {}).get(to_currency.upper())
    if result is None:
        return ToolResponse(success=False, error=f"Could not convert to {to_currency}.")

    return ToolResponse(
        success=True,
        data={"amount": amount, "from": from_currency.upper(), "to": to_currency.upper(), "result": result},
    )


# --------------------------------weather tool-------------------------
@tool
async def weather(city: str) -> ToolResponse:
    """Get current weather details for a city: temperature, humidity, wind, and rain chance."""
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            geo_response = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": city, "count": 1},
            )
            geo_data = geo_response.json()
            results = geo_data.get("results")
            if not results:
                return ToolResponse(success=False, error=f"City '{city}' not found.")

            lat, lon = results[0]["latitude"], results[0]["longitude"]

            weather_response = await client.get(
                "https://api.open-meteo.com/v1/forecast",
                params={
                    "latitude": lat,
                    "longitude": lon,
                    "current": "temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m",
                },
            )
            current = weather_response.json().get("current", {})

        return ToolResponse(
            success=True,
            data={
                "city": city,
                "temperature_celsius": current.get("temperature_2m"),
                "humidity_percent": current.get("relative_humidity_2m"),
                "rain_mm": current.get("precipitation"),
                "windspeed_kmh": current.get("wind_speed_10m"),
            },
        )
    except Exception as e:
        return ToolResponse(success=False, error=str(e))


# --------------------------------unit_converter tool-------------------------
_UNIT_TABLE = {
    ("km", "miles"): 0.621371,
    ("miles", "km"): 1.60934,
    ("kg", "lbs"): 2.20462,
    ("lbs", "kg"): 0.453592,
    ("meters", "feet"): 3.28084,
    ("feet", "meters"): 0.3048,
}


@tool
async def unit_converter(value: float, from_unit: str, to_unit: str) -> ToolResponse:
    """Convert a value between common units, e.g. value=10, from_unit='km', to_unit='miles'.
    Supports: km/miles, kg/lbs, meters/feet, celsius/fahrenheit."""
    from_unit, to_unit = from_unit.lower(), to_unit.lower()

    if from_unit == "celsius" and to_unit == "fahrenheit":
        return ToolResponse(success=True, data=(value * 9 / 5) + 32)
    if from_unit == "fahrenheit" and to_unit == "celsius":
        return ToolResponse(success=True, data=(value - 32) * 5 / 9)

    factor = _UNIT_TABLE.get((from_unit, to_unit))
    if factor is None:
        return ToolResponse(success=False, error=f"Unsupported conversion: {from_unit} -> {to_unit}")

    return ToolResponse(success=True, data=value * factor)


# --------------------------------uuid_generator tool-------------------------
@tool
async def uuid_generator() -> ToolResponse:
    """Generate a random unique identifier (UUID)."""
    return ToolResponse(success=True, data=str(uuid.uuid4()))
    