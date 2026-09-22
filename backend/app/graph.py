"""LangGraph 编排：Supervisor + 双专家并行 → 风控复核 → 成文。

拓扑（与架构文档 §1.2 一致）：

    START → supervisor ─┬─→ market ─┐
                        └─→ ledger ─┴─→ risk → finalize → END

- 条件边返回**列表**即为 fan-out：`both` 时两位专家在同一超步并行跑，风控官等两者都完成后再执行。
- 步数由 `recursion_limit` 硬熔断（无限再委派是多智能体生产环境第一大事故源）。
- 图在**事件循环里**构建（`init_graph()`），以便挂上持久化的 `AsyncSqliteSaver`。
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from .agents import finalize, ledger_agent, market_agent, risk_agent, supervisor
from .state import PipelineState

MAX_STEPS = 25  # 拓扑固定，25 已是宽裕上限；超了说明出现了环

_GRAPH: Any = None


def route_selector(state: PipelineState) -> list[str]:
    """Supervisor 的分派决策 → 目标节点列表。"""
    route = state.get("route", "both")
    if route == "market":
        return ["market"]
    if route == "ledger":
        return ["ledger"]
    return ["market", "ledger"]


def _compile(checkpointer: Any = None) -> Any:
    g = StateGraph(PipelineState)
    g.add_node("supervisor", supervisor)
    g.add_node("market", market_agent)
    g.add_node("ledger", ledger_agent)
    g.add_node("risk", risk_agent)
    g.add_node("finalize", finalize)

    g.add_edge(START, "supervisor")
    g.add_conditional_edges("supervisor", route_selector, ["market", "ledger"])
    g.add_edge("market", "risk")
    g.add_edge("ledger", "risk")
    g.add_edge("risk", "finalize")
    g.add_edge("finalize", END)

    return g.compile(checkpointer=checkpointer)


async def _make_checkpointer() -> Any:
    """持久化 checkpointer。

    ⚠️ 必须用 `AsyncSqliteSaver`：本服务用 `GRAPH.ainvoke`，**同步的 SqliteSaver
    会抛 `NotImplementedError: does not support async methods`**（踩过一次）。
    退化顺序：AsyncSqliteSaver → InMemorySaver → 无 checkpointer。
    """
    from . import db as _db

    _db.init_db()
    try:
        import aiosqlite
        from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

        conn = await aiosqlite.connect(str(_db.DB_PATH.parent / "checkpoints.db"))
        return AsyncSqliteSaver(conn)
    except Exception:
        try:
            from langgraph.checkpoint.memory import InMemorySaver

            return InMemorySaver()
        except Exception:
            return None


async def init_graph() -> Any:
    """在事件循环内构建图（必须 await 到 aiomode 的 checkpointer）。幂等。"""
    global _GRAPH
    if _GRAPH is None:
        _GRAPH = _compile(await _make_checkpointer())
    return _GRAPH


def get_graph() -> Any:
    """取图。`init_graph()` 已在服务启动时 await 过，这里同步取即可。"""
    if _GRAPH is None:
        raise RuntimeError("graph not initialized; call await init_graph() at startup")
    return _GRAPH
