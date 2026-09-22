"""DataClient：统一数据出口。

上层（agents / API）只认这里，不直接碰 db 或行情源 —— 这正是"签名不变即可换 MCP server"
的意义：把 `DataClient` 的方法搬进一个 MCP server 的 tool，编排层一行不改。

三条能力：
1. **统一出口**：持仓/账本/订阅/负债/设置全部经由本类读取，杜绝散点访问。
2. **来源标注**：每个结果带 `source`，满足"L1 洞察永远带数据来源"的合规要求。
3. **可插拔行情源 + TTL 缓存**：默认 `SnapshotSource`（库里存的快照价，可复现、零网络）；
   装了 `yfinance` 且有网时可切 `YFinanceSource`。行情数据带 TTL 缓存，避免重复取数。
"""

from __future__ import annotations

import time
from typing import Any, Protocol

from .. import db


class QuoteSource(Protocol):
    """行情源契约（对应旧任务"收敛行情实现、契约对齐"的意图）。"""

    name: str

    def quotes(self, symbols: list[str]) -> dict[str, float]:
        """symbol → 最新价。取不到的 symbol 不出现在返回里（调用方按缺价降级）。"""
        ...


class SnapshotSource:
    """默认源：用组合库里存的 `last` 快照价。零网络、结果可复现。"""

    name = "组合库快照价"

    def quotes(self, symbols: list[str]) -> dict[str, float]:
        out: dict[str, float] = {}
        for p in db.list_positions():
            if not symbols or p["symbol"] in symbols:
                out[p["symbol"]] = float(p["last"])
        return out


class YFinanceSource:
    """可选源：真实行情。需要 `pip install yfinance` 且可联网，否则自动降级回快照价。

    A股映射：6 开头 → `.SS`（上交所），0/3 开头 → `.SZ`（深交所）；
    场外基金/现金没有 Yahoo 代码 → 单标的取不到就跳过，调用方按缺价降级，绝不拖垮整轮分析。
    """

    name = "yfinance 实时价"

    @staticmethod
    def _to_yahoo(symbol: str) -> str | None:
        import re

        s = symbol.strip().upper()
        if s == "CASH":
            return None
        if "." in s:
            return s
        if re.fullmatch(r"6\d{5}", s):
            return f"{s}.SS"
        if re.fullmatch(r"[03]\d{5}", s):
            return f"{s}.SZ"
        return None

    def quotes(self, symbols: list[str]) -> dict[str, float]:
        import yfinance as yf  # 延迟导入：没装也不影响启动

        out: dict[str, float] = {}
        for s in symbols:
            ysym = self._to_yahoo(s)
            if not ysym:
                continue
            try:
                tk = yf.Ticker(ysym)
                px = tk.fast_info.get("last_price") if hasattr(tk, "fast_info") else None
                if not px:
                    h = tk.history(period="1d")
                    px = float(h["Close"].iloc[-1]) if len(h) else None
                if px:
                    out[s] = float(px)
            except Exception:
                continue  # 单个标的取不到就跳过，绝不让一个限流毁掉整轮分析
        return out


# 实时源探测结果缓存：(时刻, 决策时的mode, 是否可用)。失败后 10 分钟内不重试，
# 避免每轮请求都被限流拖慢；mode 变化（设置面板切换行情源）立即重新决策。
_probe: tuple[float, str, bool] | None = None
_PROBE_TTL = 600.0


def _quote_mode() -> str:
    """行情源偏好：auto（默认，探测可用性）| snapshot（快照价）| yfinance（实时价）。"""
    return db.get_settings().get("quote_source_mode", "auto")


def _probe_yfinance() -> bool:
    """探测 yfinance 是否真的能取到价。**必须在后台线程里跑并限时**：
    被限流时 yfinance 内部重试可能拖很久，绝不能让它卡住分析主路径。"""
    import threading

    result = {"ok": False}

    def _run() -> None:
        try:
            result["ok"] = bool(YFinanceSource().quotes(["600519.SS"]))
        except Exception:
            result["ok"] = False

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(timeout=8.0)
    return result["ok"] and not t.is_alive()


def pick_quote_source() -> QuoteSource:
    """按设置决策行情源：
    - snapshot：始终快照价（可复现、零网络）
    - yfinance：用户明确选择 → 直接用实时源（单标的失败自动降级快照）
    - auto：探测可用性（限 8s、结果缓存 10min）后再定
    """
    global _probe
    mode = _quote_mode()
    if mode == "snapshot":
        return SnapshotSource()
    if mode == "yfinance":
        return YFinanceSource()
    now = time.time()
    if _probe and _probe[1] == mode and now - _probe[0] < _PROBE_TTL:
        return YFinanceSource() if _probe[2] else SnapshotSource()
    usable = False
    try:
        import yfinance  # noqa: F401

        usable = _probe_yfinance()
    except Exception:
        usable = False
    _probe = (now, mode, usable)
    return YFinanceSource() if usable else SnapshotSource()


class DataClient:
    def __init__(
        self,
        quote_source: QuoteSource | None = None,
        ttl_seconds: float = 30.0,
    ) -> None:
        self._quote_source = quote_source  # None = auto：能用实时源就用，否则快照价
        self._ttl = ttl_seconds
        self._cache: dict[str, tuple[float, Any]] = {}

    def _quotes(self) -> QuoteSource:
        return self._quote_source if self._quote_source is not None else pick_quote_source()

    # ---- 缓存 ----
    def _cached(self, key: str, producer):
        hit = self._cache.get(key)
        if hit and (time.time() - hit[0]) < self._ttl:
            return hit[1]
        val = producer()
        self._cache[key] = (time.time(), val)
        return val

    def invalidate(self) -> None:
        self._cache.clear()

    # ---- 来源标注 ----
    def source(self) -> dict[str, Any]:
        st = db.get_settings()
        return {
            "portfolio": "本地组合库（SQLite）",
            "ledger": "本地账本（SQLite）",
            "quotes": self._quotes().name,
            "quote_mode": _quote_mode(),
            "seeded": st.get("data_note", "seed") != "user",
        }

    # ---- 行情 ----
    def _live_quotes(self) -> dict[str, float]:
        pos = db.list_positions()
        symbols = [p["symbol"] for p in pos if p["kind"] != "现金"]
        try:
            got = self._quotes().quotes(symbols)
        except Exception:
            got = {}
        if got:
            return got
        # 行情源不可用 → 降级到快照价（绝不让分析空手而归）
        return SnapshotSource().quotes([])

    # ---- 组合 ----
    def get_portfolio(self) -> dict[str, Any]:
        """持仓明细 + 市值/盈亏。"""

        def build() -> dict[str, Any]:
            rows, total_mv, total_cost = [], 0.0, 0.0
            live = self._live_quotes()
            for p in db.list_positions():
                last = live.get(p["symbol"], float(p["last"]))
                mv = p["shares"] * last
                cost = p["shares"] * p["cost"]
                total_mv += mv
                total_cost += cost
                rows.append({
                    "symbol": p["symbol"], "name": p["name"], "kind": p["kind"],
                    "industry": p["industry"], "market_value": round(mv, 2),
                    "cost": round(cost, 2), "pnl": round(mv - cost, 2),
                    "pnl_pct": round((mv - cost) / cost * 100, 2) if cost else 0.0,
                    "last": round(last, 4),
                })
            return {
                "positions": rows,
                "total_market_value": round(total_mv, 2),
                "total_cost": round(total_cost, 2),
                "total_pnl": round(total_mv - total_cost, 2),
                "total_pnl_pct": round((total_mv - total_cost) / total_cost * 100, 2)
                if total_cost else 0.0,
                "source": self.source(),
            }

        return self._cached("portfolio", build)

    def concentration(self, max_pct: float = 40.0) -> dict[str, Any]:
        """集中度诊断：按标的与按行业两个维度，标出超阈值的。"""

        def build() -> dict[str, Any]:
            pf = self.get_portfolio()
            total = pf["total_market_value"]
            by_asset, by_industry = [], []
            for p in pf["positions"]:
                if total:
                    by_asset.append({
                        "name": p["name"],
                        "pct": round(p["market_value"] / total * 100, 1),
                    })
            agg: dict[str, float] = {}
            for p in pf["positions"]:
                agg[p["industry"]] = agg.get(p["industry"], 0.0) + p["market_value"]
            for k, v in sorted(agg.items(), key=lambda kv: -kv[1]):
                by_industry.append({
                    "industry": k,
                    "pct": round(v / total * 100, 1) if total else 0.0,
                })
            return {
                "threshold_pct": max_pct,
                "by_asset": sorted(by_asset, key=lambda x: -x["pct"]),
                "by_industry": by_industry,
                "asset_breaches": [a for a in by_asset if a["pct"] > max_pct],
                "industry_breaches": [
                    i for i in by_industry
                    if i["pct"] > max_pct and i["industry"] != "现金"
                ],
                "max_asset_pct": max([a["pct"] for a in by_asset], default=0.0),
            }

        return self._cached(f"conc:{max_pct}", build)

    # ---- 账本 ----
    def cashflow_summary(self) -> dict[str, Any]:
        """本月现金流：收入/支出/结余 + 分类占比。"""

        def build() -> dict[str, Any]:
            txs = db.list_transactions()
            income = sum(t["amount"] for t in txs if t["amount"] > 0)
            expense = sum(-t["amount"] for t in txs if t["amount"] < 0)
            by_cat: dict[str, float] = {}
            for t in txs:
                if t["amount"] < 0:
                    by_cat[t["category"]] = by_cat.get(t["category"], 0.0) + -t["amount"]
            ranked = sorted(by_cat.items(), key=lambda kv: -kv[1])
            days = [t["day"] for t in txs]
            period = f"{min(days)} ~ {max(days)}" if days else "本期无流水"
            subs = self.list_subscriptions()
            return {
                "period": period,
                "income": round(income, 2),
                "expense": round(expense, 2),
                "net": round(income - expense, 2),
                "savings_rate": round((income - expense) / income * 100, 1) if income else 0.0,
                "by_category": [{"category": k, "amount": round(v, 2)} for k, v in ranked],
                "subscription_total": subs["monthly_total"],
            }

        return self._cached("cashflow", build)

    def list_subscriptions(self) -> dict[str, Any]:
        """订阅盘点：总月支出 + 收入占比。"""

        def build() -> dict[str, Any]:
            items = db.list_subscriptions()
            total = sum(s["monthly"] for s in items)
            income = self._monthly_income()
            return {
                "items": items,
                "monthly_total": round(total, 2),
                "annual_total": round(total * 12, 2),
                "income_share_pct": round(total / income * 100, 1) if income else 0.0,
            }

        return self._cached("subs", build)

    def list_debts(self) -> dict[str, Any]:
        """负债台账：月供合计 + 负债收入比。"""

        def build() -> dict[str, Any]:
            items = db.list_debts()
            monthly = sum(d["monthly"] for d in items)
            income = self._monthly_income()
            return {
                "items": items,
                "monthly_total": round(monthly, 2),
                "dti_pct": round(monthly / income * 100, 1) if income else 0.0,
                "high_rate": [d for d in items if d["rate"] >= 0.08],
            }

        return self._cached("debts", build)

    def emergency_fund_check(self) -> dict[str, Any]:
        """应急金覆盖率：现金能撑几个月的必要支出。"""

        def build() -> dict[str, Any]:
            st = db.get_settings()
            cats = [c for c in st.get("essential_categories", "居住,餐饮,交通").split(",") if c]
            essential = sum(
                -t["amount"] for t in db.list_transactions()
                if t["amount"] < 0 and t["category"] in cats
            )
            essential += sum(d["monthly"] for d in db.list_debts())  # 月供也是刚性支出
            cash = 0.0
            for p in db.list_positions():
                if p["kind"] == "现金":
                    cash += p["shares"] * p["last"]
            target = float(st.get("emergency_target_months", 6))
            months = cash / essential if essential else 0.0
            return {
                "cash": round(cash, 2),
                "essential_monthly": round(essential, 2),
                "months_covered": round(months, 1),
                "target_months": target,
                "essential_categories": cats,
                "ok": months >= target,
            }

        return self._cached("emg", build)

    def _monthly_income(self) -> float:
        st = db.get_settings()
        try:
            return float(st.get("monthly_income", 0) or 0)
        except Exception:
            return 0.0


# 单例：所有调用方共用一份缓存
DATA = DataClient()
