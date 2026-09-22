"""工具层：给智能体用的取数函数。

**签名是契约**：真实实现与 MCP server 版本必须与这里完全一致 ——
把本文件的函数体搬进一个 MCP server 的 tool，编排层一行不改（这正是把工具与
编排分离的意义）。因此这里只做"薄壳转发"，真正的取数逻辑在 `data_client.DataClient`。

数据现在来自本地组合库（SQLite，用户可改成本人真实数据），行情可插拔：
默认用库里的快照价（可复现、零网络），装了 yfinance 且有网时可切实时价。
"""

from __future__ import annotations

from typing import Any

from .data_client import DATA


def get_portfolio() -> dict[str, Any]:
    """持仓明细 + 市值/盈亏。"""
    return DATA.get_portfolio()


def concentration(max_pct: float = 40.0) -> dict[str, Any]:
    """集中度诊断：按标的与按行业两个维度，标出超阈值的。"""
    return DATA.concentration(max_pct)


def cashflow_summary() -> dict[str, Any]:
    """本月现金流：收入/支出/结余 + 分类占比。"""
    return DATA.cashflow_summary()


def list_subscriptions() -> dict[str, Any]:
    """订阅盘点：总月支出 + 可疑项。"""
    return DATA.list_subscriptions()


def list_debts() -> dict[str, Any]:
    """负债台账：月供合计 + 负债收入比。"""
    return DATA.list_debts()


def emergency_fund_check() -> dict[str, Any]:
    """应急金覆盖率：现金能撑几个月必要支出。"""
    return DATA.emergency_fund_check()


def data_source() -> dict[str, Any]:
    """数据来源标注（L1 洞察必须带来源）。"""
    return DATA.source()


__all__ = [
    "get_portfolio",
    "concentration",
    "cashflow_summary",
    "list_subscriptions",
    "list_debts",
    "emergency_fund_check",
    "data_source",
]
