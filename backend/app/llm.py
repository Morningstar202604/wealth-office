"""模型接入：httpx 直连任何 OpenAI 兼容端点（豆包 / DeepSeek / 通义千问 / Agnes 等）。

配置来源（优先级）：
1. 设置中心的「AI 回答」配置（ai_enabled=on 且 base/key/model 非空时生效）
2. 环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL

未配置或调用失败 → 返回确定性模板（服务层兜底），不冒充模型输出。
"""

from __future__ import annotations

import json
import os
from collections.abc import AsyncIterator

import httpx
from dotenv import load_dotenv

load_dotenv()

_client: httpx.AsyncClient | None = None
_cfg: dict[str, str] | None = None


async def _config() -> dict[str, str] | None:
    global _cfg
    if _cfg is not None:
        return _cfg or None

    # 1) 设置中心（数据库）优先：ai_enabled=on 且三要素齐全
    try:
        from . import db

        s = await db.get_settings()
        base = (s.get("ai_base_url") or "").strip().rstrip("/")
        key = (s.get("ai_api_key") or "").strip()
        model = (s.get("ai_model") or "").strip()
        if s.get("ai_enabled") == "on" and base and key and model:
            _cfg = {"base": base, "key": key, "model": model}
            return _cfg
    except Exception:  # noqa: BLE001 — 读取失败不影响后续
        pass

    # 2) 环境变量兜底
    base = os.getenv("LLM_BASE_URL", "").strip().rstrip("/")
    key = os.getenv("LLM_API_KEY", "").strip()
    model = os.getenv("LLM_MODEL", "").strip()
    _cfg = {"base": base, "key": key, "model": model} if base and key and model else {}
    return _cfg or None


def invalidate() -> None:
    """设置中心修改 AI 配置后调用，使下次调用重新读取。"""
    global _cfg
    _cfg = None


async def llm_available() -> bool:
    return await _config() is not None


def _client_ref() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(timeout=60.0)
    return _client


async def aclose() -> None:
    global _client
    if _client is not None and not _client.is_closed:
        await _client.aclose()


async def stream_narrate(system: str, user: str, fallback: str) -> AsyncIterator[tuple[str, str]]:
    """流式调用；失败或空流时整体退回模板。

    产出 (文本增量, 来源)。来源一旦为 'llm'，后续增量保持 llm；模板只产出一次。
    """
    cfg = await _config()
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
