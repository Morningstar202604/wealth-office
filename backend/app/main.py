"""FastAPI 入口：REST + SSE 流式问答 + 最小鉴权 + 静态前端托管。

鉴权：设置 API_TOKEN 后，所有 /api/* 需带 `Authorization: Bearer <口令>`
或查询参数 `?token=<口令>`；未设置则仅限本机/内网使用。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager, suppress
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, db, llm, scheduler, service
from .quotes import invalidate_quotes_cache

log = logging.getLogger(__name__)

APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent.parent  # wealth-office/
FRONTEND_DIST = PROJECT_DIR / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    await db.init_db()
    await scheduler.start()
    yield
    await scheduler.stop()
    await llm.aclose()
    await db.close_db()


app = FastAPI(title="随身理财公司", version="1.0.0", lifespan=lifespan)

_dev_origins = {"http://127.0.0.1:5199", "http://localhost:5199"}
if os.getenv("CORS_ALLOW_ALL") == "1":  # 仅调试用
    _dev_origins = None
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(_dev_origins) if _dev_origins is not None else ["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# 最小鉴权：API_TOKEN 未设置 = 开放（仅限本机/内网）；设置后所有 /api/* 需带口令
# ---------------------------------------------------------------------------

@app.middleware("http")
async def api_auth(request: Request, call_next):
    path = request.url.path
    if path.startswith("/api/") and path != "/api/health":
        key = os.getenv("API_TOKEN", "").strip()
        if key:
            token = request.query_params.get("token", "")
            header = request.headers.get("authorization", "")
            if token != key and header != f"Bearer {key}":
                return JSONResponse({"error": "需要访问口令"}, status_code=401)
    return await call_next(request)


# ---------------------------------------------------------------------------
# 健康 / 引导 / 仪表盘
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "llm_configured": llm.llm_available(),
        "model": os.getenv("LLM_MODEL", ""),
    }


@app.get("/api/bootstrap")
async def bootstrap() -> dict:
    settings = await db.get_settings()
    return {
        "settings": settings,
        "scheduler": scheduler.status(),
        "health": {
            "llm_configured": llm.llm_available(),
            "model": os.getenv("LLM_MODEL", ""),
        },
        "source": (await analysis.collect_dashboard())["source"],
    }


@app.get("/api/dashboard")
async def dashboard() -> dict:
    return await analysis.collect_dashboard()


# ---------------------------------------------------------------------------
# 数据录入（持仓 / 流水 / 负债）
# ---------------------------------------------------------------------------

@app.post("/api/positions")
async def create_position(payload: dict) -> dict:
    try:
        out = await db.add_position(payload or {})
    except Exception as exc:  # noqa: BLE001 — 坏输入回 400
        return JSONResponse({"error": str(exc)}, status_code=400)
    await invalidate_quotes_cache()
    return out


@app.delete("/api/positions/{symbol}")
async def remove_position(symbol: str) -> dict:
    out = await db.delete_position(symbol)
    await invalidate_quotes_cache()
    return out


@app.post("/api/transactions")
async def create_transaction(payload: dict) -> dict:
    import re

    date = str(payload.get("date") or "").strip()
    item = str(payload.get("item") or "").strip()
    category = str(payload.get("category") or "其他").strip() or "其他"
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        return JSONResponse({"error": "日期需为 YYYY-MM-DD 格式"}, status_code=400)
    if not item:
        return JSONResponse({"error": "名称必填"}, status_code=400)
    try:
        amount = float(payload.get("amount", 0) or 0)
    except (TypeError, ValueError):
        return JSONResponse({"error": "金额不合法"}, status_code=400)
    if amount == 0:
        return JSONResponse({"error": "金额不能为 0"}, status_code=400)
    try:
        return await db.add_transaction(date, item, category, amount)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=400)


@app.delete("/api/transactions/{tx_id}")
async def remove_transaction(tx_id: int) -> dict:
    return await db.delete_transaction(tx_id)


@app.post("/api/debts")
async def create_debt(payload: dict) -> dict:
    try:
        out = await db.add_debt(payload or {})
    except Exception as exc:  # noqa: BLE001
        return JSONResponse({"error": str(exc)}, status_code=400)
    return out


@app.delete("/api/debts/{name}")
async def remove_debt(name: str) -> dict:
    return await db.delete_debt(name)


@app.post("/api/portfolio/reset")
async def reset_portfolio() -> dict:
    out = await db.reset_to_seed()
    await invalidate_quotes_cache()
    return out


# ---------------------------------------------------------------------------
# 设置
# ---------------------------------------------------------------------------

NUMERIC_KEYS = ("monthly_income", "emergency_target_months", "savings_goal", "auto_refresh_seconds")
QUOTE_MODES = ("auto", "snapshot", "eastmoney")
ONOFF_KEYS = (
    "voice_input", "show_export", "expand_process", "show_suggestions",
    "auto_refresh", "compact_numbers",
)
NUMERIC_RANGES: dict[str, tuple[float, float]] = {
    "monthly_income": (0, 1e12),
    "emergency_target_months": (0, 120),
    "savings_goal": (0, 100),
    "auto_refresh_seconds": (30, 86400),
}


@app.get("/api/settings")
async def get_settings() -> dict:
    return {"settings": await db.get_settings(), "scheduler": scheduler.status()}


@app.put("/api/settings")
async def put_settings(payload: dict) -> dict:
    updates = (payload or {}).get("settings")
    if not isinstance(updates, dict) or not updates:
        return JSONResponse({"error": "settings 对象必填"}, status_code=400)

    applied: dict[str, str] = {}
    errors: list[str] = []
    for key, raw in updates.items():
        if key in NUMERIC_KEYS:
            try:
                v = float(raw)
                lo, hi = NUMERIC_RANGES[key]
                if v < lo or v > hi:
                    errors.append(f"{key} 需在 {lo:g}–{hi:g} 之间")
                    continue
                applied[key] = str(int(v)) if float(v).is_integer() else str(v)
            except (TypeError, ValueError):
                errors.append(f"{key} 的值不合法：{raw!r}")
        elif key in ONOFF_KEYS:
            if raw not in ("on", "off"):
                errors.append(f"{key} 只能是 on/off")
                continue
            applied[key] = raw
        elif key == "quote_source_mode":
            if raw not in QUOTE_MODES:
                errors.append(f"行情源只能是 {'/'.join(QUOTE_MODES)}")
                continue
            applied[key] = raw
        elif key == "report_time":
            import re

            if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", str(raw).strip()):
                errors.append("晨报时间需为 HH:MM（24 小时制）")
                continue
            applied[key] = str(raw).strip()
        elif key == "essential_categories":
            cats = [c for c in str(raw).split(",") if c.strip()]
            if not cats:
                errors.append("必要支出类别不能为空")
                continue
            applied[key] = ",".join(cats)
        else:
            errors.append(f"未知配置项：{key}")

    for k, v in applied.items():
        await db.set_setting(k, v)
    if "quote_source_mode" in applied:
        await invalidate_quotes_cache()
    if "report_time" in applied:
        await scheduler.notify_settings_changed()
    return {
        "ok": True,
        "applied": applied,
        "errors": errors,
        "settings": await db.get_settings(),
    }


# ---------------------------------------------------------------------------
# 问答：SSE 流式
# ---------------------------------------------------------------------------

def sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


async def _sse_stream(first: dict, runner) -> StreamingResponse:
    """把 runner(emit, put) 产生的事件转成 SSE；断连时取消任务，不继续 yield。"""

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()

        async def emit(event: dict) -> None:
            await queue.put({"type": "event", **event})

        async def run() -> None:
            try:
                await runner(emit)
            except Exception as exc:  # noqa: BLE001 — 让前端看到真实错误
                await queue.put({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
            finally:
                await queue.put(None)

        task = asyncio.create_task(run())
        yield sse(first)
        try:
            while True:
                item = await queue.get()
                if item is None:
                    break
                yield sse(item)
            yield sse({"type": "done"})
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/ask")
async def ask(payload: dict):
    question = ((payload or {}).get("question") or "").strip()
    if not question:
        return JSONResponse({"error": "question required"}, status_code=400)
    thread_id = ((payload or {}).get("thread_id") or "").strip() or uuid.uuid4().hex

    async def runner(emit) -> None:
        result = await service.run_question(question, emit)
        try:
            await db.save_run(
                thread_id=thread_id,
                question=question,
                answer=result["answer"],
                level=result["level"],
                flags=result["flags"],
            )
        except Exception:  # noqa: BLE001 — 落库失败不打断交付
            log.exception("save_run failed")
        await emit({
            "type": "final",
            "answer": result["answer"],
            "level": result["level"],
            "route": result["route"],
            "route_reason": result["route_reason"],
            "metrics": result["metrics"],
            "flags": result["flags"],
            "llm": result["llm"],
        })

    return await _sse_stream({"type": "start", "question": question}, runner)


# ---------------------------------------------------------------------------
# 历史 / 晨报
# ---------------------------------------------------------------------------

@app.get("/api/history")
async def history(thread_id: str | None = None, limit: int = 50) -> dict:
    return {"runs": await db.list_runs(thread_id, limit)}


# ---------------------------------------------------------------------------
# 会话管理（多会话）
# ---------------------------------------------------------------------------

@app.get("/api/sessions")
async def sessions() -> dict:
    return {"sessions": await db.list_sessions()}


@app.post("/api/sessions")
async def create_session(payload: dict | None = None) -> dict:
    title = str((payload or {}).get("title") or "新会话").strip()
    return await db.create_session(title=title)


@app.patch("/api/sessions/{session_id}")
async def rename_session(session_id: int, payload: dict) -> dict:
    title = str(payload.get("title") or "").strip()
    if not title:
        return JSONResponse({"error": "标题不能为空"}, status_code=400)
    return await db.rename_session(session_id, title)


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: int) -> dict:
    return await db.delete_session(session_id)


# ---------------------------------------------------------------------------
# 数据导出 / 月度趋势
# ---------------------------------------------------------------------------

@app.get("/api/export")
async def export_data() -> dict:
    return await db.export_data()


@app.get("/api/trend")
async def trend(months: int = 6) -> dict:
    return {"months": await db.monthly_trend(max(1, min(months, 24)))}


@app.get("/api/reports")
async def reports(limit: int = 20) -> dict:
    return {"reports": await db.list_runs("cron", limit)}


@app.post("/api/reports/generate")
async def generate_report_now() -> dict:
    try:
        result = await scheduler.generate_report()
    except Exception as exc:  # noqa: BLE001 — 手动触发失败要给可读错误
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=500)
    return {"ok": True, "answer": result["answer"], "level": result["level"]}


@app.get("/api/scheduler")
async def scheduler_status() -> dict:
    return scheduler.status()


# ---------------------------------------------------------------------------
# 静态前端托管（同域单端口）
# ---------------------------------------------------------------------------

if FRONTEND_DIST.is_dir():
    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        return FileResponse(
            FRONTEND_DIST / "index.html",
            headers={"Cache-Control": "no-store"},
        )

    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="web")
else:
    @app.get("/", include_in_schema=False)
    async def placeholder() -> dict:
        return {"message": "前端未构建：cd frontend && npm install && npm run build"}
