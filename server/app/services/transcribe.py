"""Voice transcription via Gemini native REST (accepts audio/ogg from Telegram)."""
import base64
import logging

import httpx

from .. import config

log = logging.getLogger("transcribe")

GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta"


async def transcribe(audio: bytes, mime: str = "audio/ogg") -> str | None:
    """Return transcript text, or None on failure. Uses the daily-tier model."""
    if not config.require_llm():
        return None
    url = f"{GEMINI_BASE}/models/{config.LLM_MODEL}:generateContent"
    body = {
        "contents": [{
            "parts": [
                {"inline_data": {"mime_type": mime,
                                 "data": base64.b64encode(audio).decode()}},
                {"text": "Transcribe this audio exactly. Mixed Hindi/English is fine — "
                         "transliterate Hindi to Latin script. Return ONLY the transcript text."},
            ],
        }],
        "generationConfig": {"maxOutputTokens": 2000},
    }
    import asyncio
    for attempt in (1, 2, 3):
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(url, json=body,
                                      headers={"x-goog-api-key": config.LITELLM_API_KEY})
                r.raise_for_status()
                parts = r.json()["candidates"][0]["content"]["parts"]
                text = " ".join(p.get("text", "") for p in parts).strip()
                return text or None
        except Exception as e:
            log.warning("transcribe attempt %d failed: %s", attempt, e)
            if attempt < 3 and ("503" in str(e) or "429" in str(e)):
                await asyncio.sleep(5 * attempt)
                continue
            return None
    return None
