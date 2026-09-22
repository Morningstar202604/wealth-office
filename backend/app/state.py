"""图状态定义（先定 schema，再写节点 —— 顺序不能反）。

三条来自多智能体生产实践的约定：
1. 类型化状态先行：字段先定义好，每个节点只写自己负责的字段。
2. 追加型字段用 reducer（`trace` 用 operator.add），覆盖型字段直接赋值 ——
   混用是"两个 agent 看到了不同版本状态"这类诡异 bug 的头号来源。
3. 成本/步数计数器进状态，超限可熔断。
"""

from __future__ import annotations

from operator import add
from typing import Annotated, Literal, TypedDict

Route = Literal["market", "ledger", "both"]


class TraceEvent(TypedDict, total=False):
    """给前端流水线面板用的一条事件。"""

    agent: str  # 节点 id
    label: str  # 中文职责名
    phase: str  # start | done | warn
    detail: str  # 一行说明
    artifact: dict  # 结构化产物（前端可展开）


class PipelineState(TypedDict, total=False):
    # ---- 输入 ----
    question: str

    # ---- 首席顾问（Supervisor）----
    route: Route
    route_reason: str

    # ---- 专家工件（类型化，不是散文）----
    market_view: dict
    ledger_view: dict

    # ---- 风控官复核 ----
    risk_review: dict

    # ---- 交付 ----
    answer: str
    answer_level: str  # L1 洞察 | L2 建议(需人审)
    disclaimer: str

    # ---- 计量（并行节点同时写 → 必须是 reducer，否则 InvalidUpdateError）----
    llm_calls: Annotated[int, add]
    llm_fallbacks: Annotated[int, add]
    step_count: int

    # ---- 事件流（追加型）----
    trace: Annotated[list[TraceEvent], add]
