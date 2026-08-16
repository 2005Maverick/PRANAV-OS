"""asyncpg pool + tiny helpers. All SQL lives in the services that own it."""
import asyncpg
from . import config

_pool: asyncpg.Pool | None = None


async def init_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(config.DATABASE_URL, min_size=1, max_size=5)
    return _pool


def pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError("DB pool not initialised — call init_pool() first")
    return _pool


async def fetch(query: str, *args):
    return await pool().fetch(query, *args)


async def fetchrow(query: str, *args):
    return await pool().fetchrow(query, *args)


async def fetchval(query: str, *args):
    return await pool().fetchval(query, *args)


async def execute(query: str, *args):
    return await pool().execute(query, *args)


async def get_setting(key: str) -> str | None:
    return await fetchval("SELECT value FROM settings WHERE key=$1", key)


async def set_setting(key: str, value: str):
    await execute(
        """INSERT INTO settings(key,value) VALUES($1,$2)
           ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value""",
        key, value,
    )
