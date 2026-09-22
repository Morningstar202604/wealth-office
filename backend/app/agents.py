"""各智能体节点实现。

协作约定（对应架构文档 §1.2）：
- 子 agent 是无状态工具：只收敛自己需要的上下文，绝不读整段对话史。
- 产物是**类型化字典**，不是散文；散文只出现在最后一步。
- 所有节点把过程事件 emit 给前端，让"多智能体在协作"这件事可见。
"""

from __future__ import annotations

import json
import re
from typing import Any

from langchain_core.runnables import RunnableConfig

from .llm import llm_available, narrate
from .tools import demo_data as T

# 前端流水线面板用的角色表
ROSTER: list[dict[str, str]] = [
    {"id": "supervisor", "label": "首席顾问", "role": "意图分类 · 派活 · 汇总", "tone": "blue"},
    {"id": "market", "label": "行情分析员", "role": "持仓 · 集中度 · 盈亏", "tone": "teal"},
    {"id": "ledger", "label": "账本管家", "role": "现金流 · 订阅 · 负债", "tone": "green"},
    {"id": "risk", "label": "风控官", "role": "复核 · 一票否决", "tone": "gold"},
    {"id": "finalize", "label": "文书", "role": "成文 · 分级 · 免责", "tone": "purple"},
]

DISCLAIMER = "以上为基于组合与账本数据的洞察，不构成投资建议；涉及决策的建议已标记待人审。"


def _usage(src: str) -> dict:
    """模型用量增量。

    并行节点（market / ledger 同时跑）绝不能返回累计值 —— 它们在同一超步写同一个键，
    state 的 reducer 负责相加，节点只报自己这一次的增量。
    """
    return {"llm_calls": 1 if src == "llm" else 0, "llm_fallbacks": 0 if src == "llm" else 1}


LABELS = {a["id"]: a["label"] for a in ROSTER}


async def _emit(config: RunnableConfig | None, **event: Any) -> None:
    """把过程事件推给前端；缺 label 时按 agent id 自动补齐，界面事件流才不会出现空白。"""
    if event.get("agent") and not event.get("label"):
        event["label"] = LABELS.get(event["agent"], str(event["agent"]))
    emit = (config or {}).get("configurable", {}).get("emit")
    if emit is not None:
        await emit(event)


# ---------------------------------------------------------------------------
# 1) 首席顾问：意图分类 → 派活
# ---------------------------------------------------------------------------

MARKET_WORDS = ("股票", "基金", "持仓", "仓位", "组合", "收益", "亏", "涨", "跌", "etf", "市值", "集中度", "配置")
LEDGER_WORDS = ("花", "支出", "记账", "账", "预算", "订阅", "会员", "还款", "负债", "房贷", "信用卡", "现金流", "存", "省")


def _rule_route(question: str) -> tuple[str, str]:
    q = question.lower()
    hit_m = [w for w in MARKET_WORDS if w in q]
    hit_l = [w for w in LEDGER_WORDS if w in q]
    if hit_m and hit_l:
        return "both", f"同时命中投资类({','.join(hit_m[:2])})与收支类({','.join(hit_l[:2])})关键词"
    if hit_m:
        return "market", f"命中投资类关键词：{','.join(hit_m[:3])}"
    if hit_l:
        return "ledger", f"命中收支类关键词：{','.join(hit_l[:3])}"
    return "both", "未命中明确关键词，保守起见让两位专家都给一次视角"


async def supervisor(state: dict, config: RunnableConfig) -> dict:
    question = state.get("question", "")
    await _emit(config, agent="supervisor", label="首席顾问", phase="start",
                detail="接收请求，分类意图")

    route, reason = _rule_route(question)
    source = "规则"

    # 让模型试着分类；失败就用规则结果（MVP 的降级策略）
    if llm_available():
        sys_p = (
            "你是理财团队的首席顾问。判断用户的问题该派给哪些专家。"
            '只输出 JSON：{"route":"market|ledger|both","reason":"一句话"}。'
            "market=持仓/行情/配置类，ledger=收支/预算/负债类，both=都涉及或不确定。"
        )
        text, src = await narrate(sys_p, question, "{}")
        if src == "llm":
            try:
                m = re.search(r"\{.*\}", text, re.S)
                data = json.loads(m.group(0)) if m else {}
                if data.get("route") in ("market", "ledger", "both"):
                    route = data["route"]
                    reason = data.get("reason") or reason
                    source = "模型"
            except Exception:
                pass

    await _emit(config, agent="supervisor", phase="done",
                detail=f"分类完成（{source}）→ 派给 {route}：{reason}",
                artifact={"route": route, "reason": reason, "classified_by": source})
    return {"route": route, "route_reason": reason, "step_count": state.get("step_count", 0) + 1}


# ---------------------------------------------------------------------------
# 2) 行情分析员
# ---------------------------------------------------------------------------

async def market_agent(state: dict, config: RunnableConfig) -> dict:
    await _emit(config, agent="market", label="行情分析员", phase="start",
                detail="拉取持仓与集中度")

    pf = T.get_portfolio()
    conc = T.concentration()

    top = conc["by_asset"][0] if conc["by_asset"] else None
    fallback = (
        f"组合总市值 {pf['total_market_value']:,.0f} 元，浮亏 {pf['total_pnl']:,.0f} 元"
        f"（{pf['total_pnl_pct']}%）。最大单一持仓 {top['name'] if top else '-'} "
        f"占 {top['pct'] if top else 0}%，超过 {conc['threshold_pct']}% 阈值。"
    ) if top else "组合为空。"
    llm_sys = (
        "你是行情分析员。用 2-3 句中文总结持仓结构，必须引用给定数字，"
        "不做任何操作建议，只描述事实。"
    )
    text, src = await narrate(llm_sys, json.dumps({"portfolio": pf, "concentration": conc}, ensure_ascii=False), fallback)

    view = {
        "total_market_value": pf["total_market_value"],
        "total_pnl": pf["total_pnl"],
        "total_pnl_pct": pf["total_pnl_pct"],
        "top_positions": conc["by_asset"][:3],
        "top_industries": conc["by_industry"][:3],
        "threshold_pct": conc["threshold_pct"],
        "breaches": conc["asset_breaches"] + conc["industry_breaches"],
        "summary": text,
        "generated_by": src,
    }
    await _emit(config, agent="market", phase="done",
                detail=f"已产出持仓诊断（{'模型' if src == 'llm' else '模板'}）",
                artifact={"summary": text, "total_market_value": pf["total_market_value"],
                          "total_pnl": pf["total_pnl"], "total_pnl_pct": pf["total_pnl_pct"],
                          "top": view["top_positions"][:1]})
    return {"market_view": view, **_usage(src)}


# ---------------------------------------------------------------------------
# 3) 账本管家
# ---------------------------------------------------------------------------

async def ledger_agent(state: dict, config: RunnableConfig) -> dict:
    await _emit(config, agent="ledger", label="账本管家", phase="start",
                detail="汇总现金流、订阅与负债")

    cf = T.cashflow_summary()
    subs = T.list_subscriptions()
    debts = T.list_debts()
    emergency = T.emergency_fund_check()

    fallback = (
        f"{cf['period']}收入 {cf['income']:,.0f}、支出 {cf['expense']:,.0f}，"
        f"结余 {cf['net']:,.0f}（储蓄率 {cf['savings_rate']}%）。"
        f"订阅月支出 {subs['monthly_total']:,.0f}，负债月供 {debts['monthly_total']:,.0f}"
        f"（占收入 {debts['dti_pct']}%），应急金覆盖 {emergency['months_covered']} 个月"
        f"（目标 {emergency['target_months']} 个月）。"
    )
    llm_sys = "你是账本管家。用 2-3 句中文总结收支与负债状况，引用给定数字，只描述事实，不给操作建议。"
    text, src = await narrate(
        llm_sys,
        json.dumps({"cashflow": cf, "subscriptions": subs, "debts": debts, "emergency": emergency},
                   ensure_ascii=False),
        fallback,
    )

    view = {
        "period": cf["period"], "income": cf["income"], "expense": cf["expense"],
        "net": cf["net"], "savings_rate": cf["savings_rate"],
        "by_category": cf["by_category"][:5],
        "subscription_monthly": subs["monthly_total"],
        "subscription_annual": subs["annual_total"],
        "debt_monthly": debts["monthly_total"], "dti_pct": debts["dti_pct"],
        "high_rate_debts": debts["high_rate"],
        "emergency": emergency,
        "summary": text, "generated_by": src,
    }
    await _emit(config, agent="ledger", phase="done",
                detail=f"已产出收支诊断（{'模型' if src == 'llm' else '模板'}）",
                artifact={"summary": text, "net": cf["net"], "savings_rate": cf["savings_rate"],
                          "emergency_months": emergency["months_covered"]})
    return {"ledger_view": view, **_usage(src)}


# ---------------------------------------------------------------------------
# 4) 风控官（Critic，对建议级输出有一票否决）
# ---------------------------------------------------------------------------

def _run_checks(state: dict) -> list[dict[str, str]]:
    """确定性合规/风险检查 —— 不依赖模型，规则永远比模型可靠。"""
    flags: list[dict[str, str]] = []
    mv = state.get("market_view") or {}
    lv = state.get("ledger_view") or {}

    for b in mv.get("breaches", []):
        name = b.get("name") or b.get("industry")
        flags.append({"level": "warn", "code": "CONCENTRATION",
                      "text": f"{name} 占比 {b.get('pct')}% 超过 {mv.get('threshold_pct')}% 单一持仓阈值"})
    em = (lv.get("emergency") or {})
    if em and not em.get("ok"):
        flags.append({"level": "warn", "code": "EMERGENCY_FUND",
                      "text": f"应急金仅覆盖 {em.get('months_covered')} 个月，低于 {em.get('target_months')} 个月目标"})
    for d in lv.get("high_rate_debts", []):
        flags.append({"level": "warn", "code": "HIGH_RATE_DEBT",
                      "text": f"{d['name']} 利率 {d['rate'] * 100:.1f}%，属高息负债"})
    if lv.get("dti_pct", 0) > 40:
        flags.append({"level": "warn", "code": "DTI",
                      "text": f"负债收入比 {lv['dti_pct']}% 超过 40% 警戒线"})
    if lv.get("savings_rate", 100) < 20:
        flags.append({"level": "warn", "code": "SAVINGS_RATE",
                      "text": f"储蓄率 {lv.get('savings_rate')}% 偏低"})
    return flags


async def risk_agent(state: dict, config: RunnableConfig) -> dict:
    await _emit(config, agent="risk", label="风控官", phase="start",
                detail="复核两位专家的结论与合规边界")

    flags = _run_checks(state)
    verdict = "pass" if not flags else "warn"

    fallback = (
        "复核通过：未发现超阈值项，本回答停留在洞察级。"
        if not flags else
        "发现 " + str(len(flags)) + " 项需提示：" + "；".join(f["text"] for f in flags)
        + "。以上均为事实陈述，若升级为操作建议须经用户确认。"
    )
    llm_sys = (
        "你是风控官，负责复核同事的结论。用 2-3 句中文指出风险点，"
        "必须引用给定的检查项，不复述没有依据的数字，不给出具体买卖操作。"
    )
    text, src = await narrate(
        llm_sys,
        json.dumps({"flags": flags, "market": state.get("market_view"),
                    "ledger": state.get("ledger_view")}, ensure_ascii=False),
        fallback,
    )

    review = {"verdict": verdict, "flags": flags, "summary": text,
              "requires_human_review": bool(flags), "generated_by": src}
    await _emit(config, agent="risk", phase="done",
                detail=f"复核结论：{verdict}（{len(flags)} 项提示）",
                artifact={"verdict": verdict, "flags": flags})
    return {"risk_review": review, **_usage(src)}


# ---------------------------------------------------------------------------
# 5) 文书：成文 + 自治分级 + 人审闸门（HITL）+ 免责
# ---------------------------------------------------------------------------

WITHHELD_NOTICE = (
    "该轮汇报为**建议级（L2）**，你选择了扣留，内容未交付。\n\n"
    "涉及具体决策的建议必须经你确认后才会展示（合规要求）；"
    "重新提问仍可随时获得纯洞察级（L1）的事实陈述。"
)


async def finalize(state: dict, config: RunnableConfig) -> dict:
    await _emit(config, agent="finalize", label="文书", phase="start", detail="汇总成文并分级")

    review = state.get("risk_review") or {}
    level = "L2 建议（需人审）" if review.get("requires_human_review") else "L1 洞察"

    # ---- 人审闸门（HITL）：L2 建议级交付前必须等用户批准 ----
    # 定时任务等无人在场的场景传 configurable.hitl=False 跳过闸门（产物仍是事实陈述）。
    cfg = (config or {}).get("configurable", {})
    if level.startswith("L2") and cfg.get("hitl", True):
        from langgraph.types import interrupt

        preview_parts = []
        if state.get("market_view"):
            preview_parts.append(state["market_view"]["summary"])
        if state.get("ledger_view"):
            preview_parts.append(state["ledger_view"]["summary"])
        decision = interrupt({
            "kind": "l2_review",
            "level": level,
            "flags": review.get("flags", []),
            "preview": "\n\n".join(preview_parts) or "（专家结论见上方步骤卡）",
        })
        approved = bool(decision.get("approved", False)) if isinstance(decision, dict) else bool(decision)
        if not approved:
            await _emit(config, agent="finalize", phase="done",
                        detail="已扣留（用户未确认）",
                        artifact={"level": "L2 已扣留", "generated_by": "hitl"})
            return {
                "answer": f"{WITHHELD_NOTICE}\n\n— {DISCLAIMER}",
                "answer_level": "L2 已扣留",
                "disclaimer": DISCLAIMER,
                **_usage("hitl"),
            }
        await _emit(config, agent="finalize", phase="start", detail="人审通过，开始成文")

    parts = []
    if state.get("market_view"):
        parts.append(state["market_view"]["summary"])
    if state.get("ledger_view"):
        parts.append(state["ledger_view"]["summary"])
    if review.get("summary"):
        parts.append(review["summary"])
    fallback = "\n\n".join(parts)

    llm_sys = (
        "你是理财团队的文书。把专家结论整合成一段给用户看的中文汇报："
        "先一句话结论，再分点列出关键数字，最后一行标注风险提示。"
        "不要新增任何未给出的数字，不要给出买卖指令。"
    )
    text, src = await narrate(llm_sys, json.dumps({
        "market": state.get("market_view"), "ledger": state.get("ledger_view"),
        "risk": review, "level": level,
    }, ensure_ascii=False), fallback)

    answer = f"{text}\n\n— {DISCLAIMER}"
    await _emit(config, agent="finalize", phase="done",
                detail=f"已交付（{level}）",
                artifact={"level": level, "generated_by": src})
    return {"answer": answer, "answer_level": level, "disclaimer": DISCLAIMER, **_usage(src)}
