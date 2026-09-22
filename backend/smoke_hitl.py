"""HITL 冒烟测试（图级，不经 HTTP）：L2 应 interrupt → 批准续跑 → 交付并归档。"""

import asyncio

from app import db
from app.graph import get_graph, init_graph

CKPT = "smoke_hitl_1"


async def emit_agg(events):
    async def emit(e):
        events.append(e)
    return emit


async def main() -> None:
    print("[1] init_graph ...", flush=True)
    await init_graph()
    g = get_graph()
    print("[2] graph ready:", type(g.checkpointer).__name__, flush=True)
    events: list[dict] = []

    async def emit(e):
        events.append(e)
        print(f"    EVENT {e.get('agent')}:{e.get('phase')} {str(e.get('detail', ''))[:40]}", flush=True)

    print("[3] ainvoke（第一阶段，等 interrupt）...", flush=True)
    res1 = await g.ainvoke(
        {"question": "帮我看看有哪些风险", "trace": [], "step_count": 0, "llm_calls": 0, "llm_fallbacks": 0},
        {"configurable": {"emit": emit, "thread_id": CKPT, "hitl": True}, "recursion_limit": 25},
    )
    ints = res1.get("__interrupt__") or []
    print("interrupts:", len(ints))
    if not ints:
        print("!! 未触发 interrupt，answer_level =", res1.get("answer_level"))
        return
    v = ints[0].get("value") if isinstance(ints[0], dict) else getattr(ints[0], "value", None)
    print("payload keys:", sorted(v.keys()) if isinstance(v, dict) else type(v).__name__)
    print("level:", v.get("level") if isinstance(v, dict) else "?")
    print("flags:", len(v.get("flags", [])) if isinstance(v, dict) else "?")
    print("finalize 阶段事件数（第一阶段）:", sum(1 for e in events if e.get("agent") == "finalize"))

    from langgraph.types import Command

    events.clear()
    res2 = await g.ainvoke(
        Command(resume={"approved": True}),
        {"configurable": {"emit": emit, "thread_id": CKPT, "hitl": True}, "recursion_limit": 25},
    )
    print("批准后 level:", res2.get("answer_level"))
    print("批准后 answer 头 60 字:", (res2.get("answer") or "").replace("\n", " ")[:60])
    print("llm_calls:", res2.get("llm_calls"), "| llm_fallbacks:", res2.get("llm_fallbacks"))
    print("第二阶段事件:", [f"{e.get('agent')}:{e.get('phase')}" for e in events])
    runs = db.list_runs(CKPT, 5)
    print("已归档（图级不落 runs，由 HTTP 层负责）:", len(runs))


asyncio.run(main())
