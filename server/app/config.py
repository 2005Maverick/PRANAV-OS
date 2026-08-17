"""Central config — everything from .env, validated at startup."""
import os
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]
LITELLM_BASE_URL = os.environ.get("LITELLM_BASE_URL", "")
LITELLM_API_KEY = os.environ.get("LITELLM_API_KEY", "")
LLM_MODEL = os.environ.get("LLM_MODEL", "gemini-flash-latest")
LLM_MODEL_LITE = os.environ.get("LLM_MODEL_LITE", LLM_MODEL)
LLM_MODEL_DEEP = os.environ.get("LLM_MODEL_DEEP", LLM_MODEL)
# quota ladder: on daily-quota 429s the brain falls through these, in order
LLM_LADDER = [m.strip() for m in os.environ.get(
    "LLM_LADDER",
    "gemini-3.5-flash,gemini-3-flash-preview,gemini-3.1-flash-lite,gemini-flash-lite-latest",
).split(",") if m.strip()]
TZ = ZoneInfo(os.environ.get("TIMEZONE", "Asia/Kolkata"))
EVENING_CLOSE = os.environ.get("EVENING_CLOSE", "22:30")
DEFAULT_WAKE = os.environ.get("DEFAULT_WAKE", "07:45")

# Set after Pranav presses /start the first time (persisted in DB, cached here)
OWNER_CHAT_ID: int | None = None


def require_llm() -> bool:
    """True if the LLM gateway is configured (not the CHANGEME placeholder)."""
    return bool(LITELLM_API_KEY) and not LITELLM_API_KEY.startswith("CHANGEME")
