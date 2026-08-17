"""LLM brain — OpenAI-compatible client on the LiteLLM gateway.

Every call degrades gracefully: if the gateway is unconfigured/unreachable,
callers get None and fall back to deterministic behavior, so the heartbeat
(pings, briefs, captures) never dies with the brain.
"""
import asyncio
import json
import logging
from openai import AsyncOpenAI
from . import config

TRANSIENT = ("503", "UNAVAILABLE", "overloaded", "timed out", "timeout")
QUOTA = ("429", "RESOURCE_EXHAUSTED", "quota")


def next_model(current: str | None) -> str | None:
    """Next rung on the quota ladder after `current` (None when exhausted)."""
    ladder = [config.LLM_MODEL] + [m for m in config.LLM_LADDER if m != config.LLM_MODEL]
    cur = current or config.LLM_MODEL
    try:
        i = ladder.index(cur)
    except ValueError:
        return ladder[0]
    return ladder[i + 1] if i + 1 < len(ladder) else None

log = logging.getLogger("llm")

_client: AsyncOpenAI | None = None


def client() -> AsyncOpenAI | None:
    global _client
    if not config.require_llm():
        return None
    if _client is None:
        _client = AsyncOpenAI(base_url=config.LITELLM_BASE_URL, api_key=config.LITELLM_API_KEY)
    return _client


SYSTEM_PERSONA = """You are Pranav OS — the external executive of Pranav Singh Puri:
4th-year BTech CSE, startup CTO-level intern (6 parallel projects), published
researcher (7 papers) preparing for a masters abroad, learning trading daily,
building a newsletter startup, learning tech, ramping into gym.

Voice: terse, instrument-precise, zero corporate softness. Like a sharp chief
of staff who respects his time. Never lecture. Never shame. When he drifts,
mirror it in one line and surface the smallest concrete next action (2-minute
entry). Always give him the choice; always name trade-offs in his own currency
(his floors, his arcs, his sleep ledger).

Hard rules: floors not streaks; plans bend, never die; propose, he disposes."""


async def chat(messages: list[dict], system: str | None = None, max_tokens: int = 3000,
               model: str | None = None, _retry: bool = True) -> str | None:
    """Plain chat completion. Returns None on any failure."""
    c = client()
    if c is None:
        return None
    try:
        resp = await c.chat.completions.create(
            model=model or config.LLM_MODEL,
            messages=[{"role": "system", "content": system or SYSTEM_PERSONA}] + messages,
            max_tokens=max_tokens,
            temperature=0.4,
        )
        return resp.choices[0].message.content
    except Exception as e:
        err = str(e)
        log.warning("LLM chat failed (%s): %s", model or config.LLM_MODEL, err[:160])
        if _retry and any(t in err for t in TRANSIENT):
            await asyncio.sleep(4)
            return await chat(messages, system=system, max_tokens=max_tokens, model=model, _retry=False)
        if any(q in err for q in QUOTA):
            nm = next_model(model)
            if nm:
                return await chat(messages, system=system, max_tokens=max_tokens, model=nm)
        elif model and model != config.LLM_MODEL:
            return await chat(messages, system=system, max_tokens=max_tokens, model=config.LLM_MODEL)
        return None


async def json_call(prompt: str, system: str | None = None, max_tokens: int = 4000,
                    model: str | None = None, _retry: bool = True) -> dict | list | None:
    """Ask for strict JSON; parse defensively. Returns None on failure."""
    c = client()
    if c is None:
        return None
    try:
        resp = await c.chat.completions.create(
            model=model or config.LLM_MODEL,
            messages=[
                {"role": "system", "content": (system or SYSTEM_PERSONA) + "\n\nRespond with VALID JSON only. No prose, no markdown fences."},
                {"role": "user", "content": prompt},
            ],
            max_tokens=max_tokens,
            temperature=0.2,
        )
        raw = resp.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.strip("`")
            raw = raw[raw.find("\n") + 1:] if "\n" in raw else raw
        return json.loads(raw)
    except Exception as e:
        err = str(e)
        log.warning("LLM json_call failed (%s): %s", model or config.LLM_MODEL, err[:160])
        if _retry and any(t in err for t in TRANSIENT):
            await asyncio.sleep(4)
            return await json_call(prompt, system=system, max_tokens=max_tokens, model=model, _retry=False)
        if any(q in err for q in QUOTA):
            nm = next_model(model)
            if nm:
                return await json_call(prompt, system=system, max_tokens=max_tokens, model=nm)
        elif model and model != config.LLM_MODEL:
            return await json_call(prompt, system=system, max_tokens=max_tokens, model=config.LLM_MODEL)
        return None
