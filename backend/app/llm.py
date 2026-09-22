"""模型接入层：OpenAI 兼容端点 + 失败降级。

MVP 的可靠性优先原则：**任何异常都退回确定性模板**。
演示绝不能因为限流/超时/网络抖动而空转 —— 降级时要如实记录，
前端会显示"本次由模板兜底"，不冒充模型输出。
"""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv

load_dotenv()

_llm: Any = None
_init_done = False


def get_llm() -> Any:
    """惰性构造 LLM；未配置或依赖缺失时返回 None。"""
    global _llm, _init_done
    if _init_done:
        return _llm
    _init_done = True

    base_url = os.getenv("LLM_BASE_URL")
    api_key = os.getenv("LLM_API_KEY")
    model = os.getenv("LLM_MODEL")
    if not (base_url and api_key and model):
        return None
    try:
        from langchain_openai import ChatOpenAI

        _llm = ChatOpenAI(
            model=model,
            base_url=base_url,
            api_key=api_key,
            temperature=0.2,
            timeout=60,
            max_retries=1,
        )
    except Exception:  # pragma: no cover - 依赖缺失即降级
        _llm = None
    return _llm


def llm_available() -> bool:
    return get_llm() is not None


async def narrate(system: str, user: str, fallback: str) -> tuple[str, str]:
    """让模型把结构化产物讲成人话；失败则用模板兜底。

    返回 (文本, 来源)，来源为 "llm" 或 "template"。
    """
    client = get_llm()
    if client is None:
        return fallback, "template"
    try:
        resp = await client.ainvoke([("system", system), ("human", user)])
        text = (getattr(resp, "content", "") or "").strip()
        if len(text) < 10:  # 空回复/占位符一律视为失败
            return fallback, "template"
        return text, "llm"
    except Exception:
        return fallback, "template"
