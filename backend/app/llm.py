"""模型接入：httpx 直连任何 OpenAI 兼容端点（豆包 / DeepSeek / 通义千问等）。

未配置或调用失败 → 返回确定性模板（服务层兜底），不冒充模型输出。
"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator

import httpx
from dotenv import load_dotenv

load_dotenv()

_client: httpx.AsyncClient | None = None
_cfg: dict[str, str] | None = None


def _config() -> dict[str, str] | None:
    global _cfg
    if _cfg is None:
        base = os.getenv("LLM_BASE_URL", "").strip().rstrip("/")
        key = os.getenv("LLM_API_KEY", "").strip()
        model = os.getenv("LLM_MODEL", "").strip()
        _cfg = {"base": base, "key": key, "model": model} if base and key and model else {}
    return _cfg or None


def llm_available() -> bool:
    return _config() is not None


def _client_ref() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()


async def narrate(system: str, user: str, fallback: str) -> tuple[str, str]:
    """整段调用；失败返回 (fallback, 'template')。"""
    cfg = _config()
    if cfg is None:
        return fallback, "template"
    try:
        payload = {
            "model": cfg["model"],
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "stream": False,
        }
        resp = await _client_ref().post(
            f"{cfg['base']}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {cfg['key']}"},
        )
        resp.raise_for_status()
        text = (resp.json().get("choices") or [{}])[0].get("message", {}).get("content", "")
        if len(str(text).strip()) < 10:
            return fallback, "template"
        return str(text).strip(), "llm"
    except Exception:  # noqa: BLE001 — 任何异常都走模板兜底
        return fallback, "template"


async def stream_narrate(system: str, user: str, fallback: str) -> AsyncIterator[tuple[str, str]]:
    """流式调用；失败或空流时整体退回模板。

    产出 (文本增量, 来源)。来源一旦为 'llm'，后续增量保持 llm；模板只产出一次。
    """
    cfg = _config()
    if cfg is None:
        yield fallback, "template"
        return
    try:
        payload = {
            "model": cfg["model"],
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
            "stream": True,
        }
        async with _client_ref().stream(
            "POST",
            f"{cfg['base']}/chat/completions",
            json=payload,
            headers={"Authorization": f"Bearer {cfg['key']}"},
        ) as resp:
            resp.raise_for_status()
            got_any = False
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if chunk == "[DONE]":
                    break
                import json

                try:
                    delta = json.loads(chunk)["choices"][0]["delta"].get("content", "")
                except Exception:  # noqa: BLE001 — 跳过无法解析的帧
                    continue
                if delta:
                    got_any = True
                    yield delta, "llm"
            if not got_any:
                yield fallback, "template"
    except Exception:  # noqa: BLE001 — 流中断整体退回模板
        yield fallback, "template"
