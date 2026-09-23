"""定时晨报（M2）。

后台 asyncio 任务按 `settings.report_interval_minutes`（默认 1440 = 每天一次）生成晨报：
走同一条 LangGraph 编排，但 `configurable.hitl=False` —— 无人在场过不了人审闸门，
而晨报本身是事实陈述 + 风险提示（finalize 提示词禁止操作建议），属 L1 信息交付。
结果归档到 `runs` 表（thread_id='cron'），前端历史面板与 `GET /api/reports` 均可见。

调度与生成解耦：`generate_report()` 也暴露为 `POST /api/reports/generate` 的手动触发，
演示/验证不必等下一个周期。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timedelta
from typing import Any

from . import db

REPORT_QUESTION = (
    "生成今日晨报：汇总我的组合现状与账本概况，只描述事实与风险提示，不给操作建议。"
)

_state: dict[str, Any] = {
    "task": None,
    "running": False,
    "last_run_at": None,
    "next_run_at": None,
    "last_error": None,
    "generated": 0,
}
# 设置面板保存周期后立刻唤醒 loop，不必等当前 sleep 结束
_wake: asyncio.Event | None = None


def _interval_seconds() -> float:
    st = db.get_settings()
    try:
        minutes = float(st.get("report_interval_minutes") or 1440)
    # aqg: top-level boundary
    except Exception:  # noqa: BLE001 — 读配置失败回退默认日更
        minutes = 1440.0
    return max(60.0, minutes * 60.0)  # 下限 1 分钟，防止把模型打爆


def notify_settings_changed() -> None:
    """PUT /api/settings 保存周期后调用：打断当前 sleep，按新 interval 重排。"""
    if _wake is not None:
        _wake.set()


async def generate_report() -> dict[str, Any]:
    """跑一遍编排生成晨报并归档（thread_id='cron'）。定时与手动触发共用。"""
    from .graph import MAX_STEPS, get_graph

    events: list[dict[str, Any]] = []

    async def emit(event: dict) -> None:
        events.append(event)

    result = await get_graph().ainvoke(
        {
            "question": REPORT_QUESTION,
            "trace": [],
            "step_count": 0,
            "llm_calls": 0,
            "llm_fallbacks": 0,
        },
        {
            "configurable": {
                "emit": emit,
                "thread_id": f"cron_{uuid.uuid4().hex}",
                "hitl": False,
            },
            "recursion_limit": MAX_STEPS,
        },
    )
    db.save_run(
        thread_id="cron",
        question=REPORT_QUESTION,
        answer=result.get("answer", ""),
        level=result.get("answer_level", ""),
        route=result.get("route", ""),
        route_reason=result.get("route_reason", ""),
        llm_calls=result.get("llm_calls", 0),
        llm_fallbacks=result.get("llm_fallbacks", 0),
        trace=events,
    )
    _state["generated"] += 1
    _state["last_run_at"] = datetime.now().astimezone().isoformat(timespec="seconds")
    return result


async def _loop() -> None:
    global _wake
    _wake = asyncio.Event()
    try:
        while True:
            interval = _interval_seconds()
            _state["next_run_at"] = (
                datetime.now() + timedelta(seconds=interval)
            ).isoformat(timespec="seconds")
            # 短切片 sleep：设置变更通过 notify_settings_changed() 立刻打断
            remaining = interval
            _wake.clear()
            while remaining > 0:
                slice_s = min(remaining, 5.0)
                try:
                    await asyncio.wait_for(_wake.wait(), timeout=slice_s)
                    break  # 被唤醒：读新 interval 重排 next_run_at
                except asyncio.TimeoutError:
                    remaining -= slice_s
            _state["running"] = True
            try:
                await generate_report()
                _state["last_error"] = None
            except Exception as exc:  # noqa: BLE001 — 记录晨报失败原因
                _state["last_error"] = f"{type(exc).__name__}: {exc}"
            finally:
                _state["running"] = False
    finally:
        _wake = None


def start() -> None:
    if _state["task"] is None:
        _state["task"] = asyncio.create_task(_loop())


async def stop() -> None:
    global _wake
    t = _state["task"]
    if t is None:
        return
    _state["task"] = None
    if _wake is not None:
        _wake.set()
    t.cancel()
    try:
        await t
    except asyncio.CancelledError:
        pass
    # aqg: top-level boundary
    except Exception:  # noqa: BLE001 — 关停路径吞掉非取消异常
        pass
    _wake = None


def status() -> dict[str, Any]:
    return {
        "enabled": _state["task"] is not None,
        "interval_minutes": _interval_seconds() / 60,
        "running": _state["running"],
        "last_run_at": _state["last_run_at"],
        "next_run_at": _state["next_run_at"],
        "last_error": _state["last_error"],
        "generated": _state["generated"],
    }
