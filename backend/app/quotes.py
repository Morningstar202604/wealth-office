"""行情层：异步、可插拔、失败降级。

- snapshot：用组合库里的 `last` 快照价（零网络、可复现）。
- eastmoney：东方财富 push2 批量行情（免 key），httpx 异步请求，4s 超时。
- auto：优先东财，失败自动降级快照。不做同步探测线程（旧实现会阻塞事件循环最长 16s）。
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from . import db

EASTMONEY_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get"
_SOURCE_LABEL = {"auto": "东方财富实时价（失败降级快照）", "eastmoney": "东方财富实时价", "snapshot": "组合库快照价"}


def _to_secid(symbol: str) -> str | None:
    """A股/ETF/场内基金 → 东财 secid；现金与场外基金无法映射返回 None。"""
    s = symbol.strip().upper()
    if s == "CASH" or not s.isdigit() or len(s) != 6:
        return None
    if s[0] in "65":  # 沪市股票 / 沪市ETF(51/58)
        return f"1.{s}"
    if s[0] in "03":
        return f"0.{s}"
    if s.startswith(("15", "16")):  # 深市场内基金
        return f"0.{s}"
    return None


def _parse_price(raw: Any) -> float | None:
    """fltt=2：接口返回元为单位的原价（整数/浮点/字符串均可）。"""
    if raw is None or raw == "-" or raw == "" or isinstance(raw, bool):
        return None
    try:
        px = float(raw)
        return px if px > 0 else None
    except (TypeError, ValueError):
        return None


async def _eastmoney_quotes(symbols: list[str]) -> dict[str, float]:
    """东财批量行情；网络失败/缺价返回 {}，由调用方降级。"""
    code_to_symbol: dict[str, str] = {}
    secids: list[str] = []
    for s in symbols:
        sid = _to_secid(s)
        if sid:
            code_to_symbol[sid.split(".", 1)[1]] = s
            secids.append(sid)
    if not secids:
        return {}

    params = {
        "fltt": "2",
        "invt": "2",
        "fields": "f2,f12,f14",
        "secids": ",".join(secids),
        "ut": "fa5fd1943c7b386f172d6893dbfba10b",
    }
    headers = {"User-Agent": "Mozilla/5.0 (wealth-office)"}
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            resp = await client.get(EASTMONEY_URL, params=params, headers=headers)
            resp.raise_for_status()
            payload = resp.json()
    except Exception:  # noqa: BLE001 — 行情失败一律降级，绝不拖垮分析
        return {}

    diff = ((payload or {}).get("data") or {}).get("diff") or []
    if isinstance(diff, dict):
        diff = list(diff.values())
    out: dict[str, float] = {}
    for item in diff:
        if not isinstance(item, dict):
            continue
        sym = code_to_symbol.get(str(item.get("f12") or ""))
        if not sym:
            continue
        px = _parse_price(item.get("f2"))
        if px is not None:
            out[sym] = px
    return out


# 行情缓存：同一批符号 30s 内不重复请求
_cache: dict[str, tuple[float, dict[str, float]]] = {}
_TTL = 30.0


def _snapshot(positions: list[dict[str, Any]]) -> dict[str, float]:
    return {p["symbol"]: float(p["last"]) for p in positions}


async def live_quotes(positions: list[dict[str, Any]]) -> dict[str, float]:
    """按设置取行情：auto/eastmoney → 东财（失败降级快照）；snapshot → 快照价。

    只对非现金标的请求实时价；现金直接用库里价格。
    """
    mode = (await db.get_settings()).get("quote_source_mode", "auto")
    symbols = [p["symbol"] for p in positions if p["kind"] != "现金"]
    if mode == "snapshot" or not symbols:
        return _snapshot(positions)

    key = ",".join(sorted(symbols))
    hit = _cache.get(key)
    if hit and time.time() - hit[0] < _TTL:
        return hit[1]

    got = await _eastmoney_quotes(symbols)
    if not got:
        got = _snapshot(positions)
    _cache[key] = (time.time(), got)
    return got


def quote_source_label() -> str:
    mode = _current_mode
    return _SOURCE_LABEL.get(mode, _SOURCE_LABEL["auto"])


# 最近一次生效的行情源（由分析层更新，供"数据来源"展示）
_current_mode = "auto"


def set_current_mode(mode: str) -> None:
    global _current_mode
    _current_mode = mode


async def invalidate_quotes_cache() -> None:
    _cache.clear()
