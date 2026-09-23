"""FastAPI 入口：SSE 流式输出 + 组合库/历史 API + 静态前端托管。

前端通过 POST /api/ask 建立 SSE 流，逐个事件看到"哪位 Agent 在干活"。
每轮问答落 `runs` 表 → 跨会话可回放（审计链）。
"""

from __future__ import annotations

import asyncio
import json
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .agents import DISCLAIMER, ROSTER
from .graph import MAX_STEPS, get_graph, init_graph
from .llm import get_llm
from .tools.data_client import DATA

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent.parent  # wealth-office/
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    # 图 + 持久化 checkpointer 必须在事件循环里 await 构建
    await init_graph()
    from . import scheduler

    scheduler.start()
    yield
    await scheduler.stop()


app = FastAPI(title="随身理财公司 · MVP", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def asset_cache_headers(request, call_next):
    """缓存策略：index.html 永不缓存（发版即生效）；带内容哈希的 assets 长缓存。"""
    response = await call_next(request)
    if request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
    return response


def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


@app.get("/api/health")
async def health() -> dict:
    llm = get_llm()
    return {
        "ok": True,
        "llm_configured": llm is not None,
        "model": os.getenv("LLM_MODEL", ""),
        "endpoint": os.getenv("LLM_BASE_URL", ""),
    }


@app.get("/api/roster")
async def roster() -> dict:
    return {
        "agents": ROSTER,
        "max_steps": MAX_STEPS,
        "disclaimer": DISCLAIMER,
        "source": DATA.source(),
    }


# ---------------------------------------------------------------------------
# 组合库（真实数据源）：读写用户自己的持仓 / 账本 / 负债
# ---------------------------------------------------------------------------


@app.get("/api/portfolio")
async def portfolio() -> dict:
    DATA.invalidate()
    return {
        "positions": db.list_positions(),
        "transactions": db.list_transactions(),
        "subscriptions": db.list_subscriptions(),
        "debts": db.list_debts(),
        "settings": db.get_settings(),
        "source": DATA.source(),
    }


@app.put("/api/portfolio/positions")
async def put_positions(payload: dict) -> dict:
    rows = (payload or {}).get("positions") or []
    if not isinstance(rows, list):
        return JSONResponse({"error": "positions must be a list"}, status_code=400)
    out = db.replace_positions(rows)
    DATA.invalidate()
    return out


@app.post("/api/portfolio/transactions")
async def post_transaction(payload: dict) -> dict:
    try:
        out = db.add_transaction(
            str(payload.get("day", "")).strip(),
            str(payload.get("item", "")).strip(),
            str(payload.get("category", "其他")).strip() or "其他",
            float(payload.get("amount", 0) or 0),
        )
        DATA.invalidate()
        return out
    except Exception as exc:
        return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=400)


@app.delete("/api/portfolio/transactions/{tx_id}")
async def delete_transaction(tx_id: int) -> dict:
    out = db.delete_transaction(tx_id)
    DATA.invalidate()
    return out


@app.put("/api/portfolio/debts")
async def put_debts(payload: dict) -> dict:
    rows = (payload or {}).get("debts") or []
    out = db.replace_debts(rows if isinstance(rows, list) else [])
    DATA.invalidate()
    return out


@app.post("/api/portfolio/reset")
async def reset_portfolio() -> dict:
    out = db.reset_to_seed()
    DATA.invalidate()
    return out


# ---------------------------------------------------------------------------
# 运行历史（跨会话持久化 / 审计链）
# ---------------------------------------------------------------------------


@app.get("/api/history")
async def history(thread_id: str | None = None, limit: int = 50) -> dict:
    return {"runs": db.list_runs(thread_id, limit)}


# ---------------------------------------------------------------------------
# 问答：SSE 流式
# ---------------------------------------------------------------------------


@app.post("/api/ask")
async def ask(payload: dict):
    question = ((payload or {}).get("question") or "").strip()
    # thread_id 只用于历史归档（runs 表）；checkpointer 用**每轮独立**的 id，
    # 否则同一 thread 的旧 checkpoint 会把上一轮的 market_view/answer 残留进这一轮。
    thread_id = ((payload or {}).get("thread_id") or "").strip() or uuid.uuid4().hex
    ckpt_id = uuid.uuid4().hex
    if not question:
        return JSONResponse({"error": "question required"}, status_code=400)

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        trace_events: list[dict] = []

        async def emit(event: dict) -> None:
            trace_events.append(event)
            await queue.put({"type": "event", **event})

        async def run() -> None:
            try:
                result = await get_graph().ainvoke(
                    {
                        "question": question,
                        "trace": [],
                        "step_count": 0,
                        "llm_calls": 0,
                        "llm_fallbacks": 0,
                    },
                    {
                        "configurable": {
                            "emit": emit,
                            "thread_id": ckpt_id,
                            "hitl": True,
                        },
                        "recursion_limit": MAX_STEPS,
                    },
                )
                # 人审闸门：L2 建议级会在 finalize 里 interrupt，图在此暂停等用户决策
                interrupts = result.get("__interrupt__") or []
                if interrupts:
                    info = interrupts[0]
                    info = (
                        info.get("value")
                        if isinstance(info, dict)
                        else getattr(info, "value", info)
                    )
                    payload = (
                        dict(info) if isinstance(info, dict) else {"preview": str(info)}
                    )
                    await queue.put(
                        {
                            "type": "confirm_required",
                            "ckpt_id": ckpt_id,
                            "thread_id": thread_id,
                            "question": question,
                            **payload,
                        }
                    )
                    return  # 不落库：等 /api/resume 续跑完成后再归档
                try:  # 落库失败绝不能打断交付
                    db.save_run(
                        thread_id=thread_id,
                        question=question,
                        answer=result.get("answer", ""),
                        level=result.get("answer_level", ""),
                        route=result.get("route", ""),
                        route_reason=result.get("route_reason", ""),
                        llm_calls=result.get("llm_calls", 0),
                        llm_fallbacks=result.get("llm_fallbacks", 0),
                        trace=trace_events,
                    )
                except Exception:
                    pass
                await queue.put(
                    {
                        "type": "final",
                        "answer": result.get("answer", ""),
                        "level": result.get("answer_level", ""),
                        "route": result.get("route", ""),
                        "route_reason": result.get("route_reason", ""),
                        "llm_calls": result.get("llm_calls", 0),
                        "llm_fallbacks": result.get("llm_fallbacks", 0),
                    }
                )
            except Exception as exc:  # 让前端看到真实错误，不静默
                await queue.put(
                    {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
                )
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        yield sse({"type": "start", "question": question})
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield sse(item)
        finally:
            if not task.done():
                task.cancel()
            yield sse({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/resume")
async def resume(payload: dict):
    """人审决策后续跑： approved=True 交付建议级汇报；False 交付"已扣留"文案。两者都归档。"""
    ckpt_id = str((payload or {}).get("ckpt_id") or "").strip()
    thread_id = str((payload or {}).get("thread_id") or "").strip() or ckpt_id
    approved = bool((payload or {}).get("approved"))
    if not ckpt_id:
        return JSONResponse({"error": "ckpt_id required"}, status_code=400)

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        trace_events: list[dict] = []

        async def emit(event: dict) -> None:
            trace_events.append(event)
            await queue.put({"type": "event", **event})

        async def run() -> None:
            try:
                from langgraph.types import Command

                result = await get_graph().ainvoke(
                    Command(resume={"approved": approved}),
                    {
                        "configurable": {
                            "emit": emit,
                            "thread_id": ckpt_id,
                            "hitl": True,
                        },
                        "recursion_limit": MAX_STEPS,
                    },
                )
                try:  # 落库失败绝不能打断交付
                    db.save_run(
                        thread_id=thread_id,
                        question=result.get("question", ""),
                        answer=result.get("answer", ""),
                        level=result.get("answer_level", ""),
                        route=result.get("route", ""),
                        route_reason=result.get("route_reason", ""),
                        llm_calls=result.get("llm_calls", 0),
                        llm_fallbacks=result.get("llm_fallbacks", 0),
                        trace=trace_events,
                    )
                except Exception:
                    pass
                await queue.put(
                    {
                        "type": "final",
                        "answer": result.get("answer", ""),
                        "level": result.get("answer_level", ""),
                        "route": result.get("route", ""),
                        "route_reason": result.get("route_reason", ""),
                        "llm_calls": result.get("llm_calls", 0),
                        "llm_fallbacks": result.get("llm_fallbacks", 0),
                    }
                )
            except Exception as exc:
                await queue.put(
                    {"type": "error", "message": f"{type(exc).__name__}: {exc}"}
                )
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        yield sse({"type": "resume_started", "ckpt_id": ckpt_id, "approved": approved})
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield sse(item)
        finally:
            if not task.done():
                task.cancel()
            yield sse({"type": "done"})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# 定时晨报（M2）：后台调度 + 手动触发 + 查询
# ---------------------------------------------------------------------------


@app.post("/api/reports/generate")
async def generate_report_now() -> dict:
    from . import scheduler

    result = await scheduler.generate_report()
    return {
        "ok": True,
        "answer": result.get("answer", ""),
        "level": result.get("answer_level", ""),
        "route": result.get("route", ""),
    }


@app.get("/api/reports")
async def reports(limit: int = 20) -> dict:
    return {"reports": db.list_runs("cron", limit)}


@app.get("/api/scheduler")
async def scheduler_status() -> dict:
    from . import scheduler

    return scheduler.status()


# ---------------------------------------------------------------------------
# 设置：前端可视化调整后端配置（账本假设 / 晨报周期 / 行情源）
# ---------------------------------------------------------------------------

SETTING_KEYS = {
    "monthly_income": float,
    "emergency_target_months": float,
    "report_interval_minutes": float,
    "essential_categories": str,
    "quote_source_mode": str,
}
QUOTE_MODES = ("auto", "snapshot", "yfinance", "eastmoney")


@app.get("/api/settings")
async def get_settings_all() -> dict:
    from . import scheduler

    return {
        "settings": db.get_settings(),
        "scheduler": scheduler.status(),
        "health": await health(),
        "source": DATA.source(),
    }


@app.put("/api/settings")
async def put_settings(payload: dict) -> dict:
    updates = (payload or {}).get("settings")
    if not isinstance(updates, dict) or not updates:
        return JSONResponse({"error": "settings object required"}, status_code=400)

    applied: dict[str, str] = {}
    errors: list[str] = []
    for key, raw in updates.items():
        if key not in SETTING_KEYS:
            errors.append(f"未知配置项：{key}")
            continue
        try:
            if SETTING_KEYS[key] is float:
                v = float(raw)
                if key == "report_interval_minutes" and v < 1:
                    errors.append("晨报周期不能小于 1 分钟")
                    continue
                if v < 0:
                    errors.append(f"{key} 不能为负数")
                    continue
                applied[key] = str(v)
            else:
                sval = str(raw).strip()
                if key == "quote_source_mode" and sval not in QUOTE_MODES:
                    errors.append(f"行情源只能是 {'/'.join(QUOTE_MODES)}")
                    continue
                applied[key] = sval
        except (TypeError, ValueError):
            errors.append(f"{key} 的值不合法：{raw!r}")

    for k, v in applied.items():
        db.set_setting(k, v)
    DATA.invalidate()
    return {
        "ok": True,
        "applied": applied,
        "errors": errors,
        "settings": db.get_settings(),
    }


# 前端构建产物：若已 build 就直接托管（单端口，免跨域）
if FRONTEND_DIST.is_dir():
    # index.html 显式 no-store：浏览器每次都拿最新入口，避免"改了代码用户刷新却没变化"
    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(
            FRONTEND_DIST / "index.html",
            headers={"Cache-Control": "no-store"},
        )

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="web")
else:

    @app.get("/")
    async def placeholder() -> dict:
        return {
            "message": "前端尚未构建。执行：cd frontend && npm install && npm run build",
            "api": [
                "/api/health",
                "/api/roster",
                "/api/portfolio",
                "/api/history",
                "POST /api/ask",
            ],
        }
