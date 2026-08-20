"""Give config the env vars it demands at import, so pure-logic tests run
without a real .env or database (nothing here connects to Postgres)."""
import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token")
os.environ.setdefault("DATABASE_URL", "postgresql://localhost/test")
