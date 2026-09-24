"""行情层单测：secid 映射与价格解析（纯函数），以及快照模式路径。"""

from __future__ import annotations

import pytest
from app import quotes


@pytest.mark.parametrize(
    ("symbol", "secid"),
    [
        ("600519", "1.600519"),
        ("688981", "1.688981"),
        ("000001", "0.000001"),
        ("300750", "0.300750"),
        ("510300", "1.510300"),
        ("159915", "0.159915"),
        ("161725", "0.161725"),
    ],
)
def test_to_secid_mapped(symbol: str, secid: str) -> None:
    assert quotes._to_secid(symbol) == secid


@pytest.mark.parametrize("symbol", ["CASH", "XXXX", "", "12345"])
def test_to_secid_unmappable(symbol: str) -> None:
    assert quotes._to_secid(symbol) is None


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (1253.8, 1253.8),
        (15, 15.0),
        ("46.13", 46.13),
        (None, None),
        ("-", None),
        ("", None),
        (True, None),
        (0, None),
    ],
)
def test_parse_price(raw, expected) -> None:
    assert quotes._parse_price(raw) == expected


async def test_live_quotes_snapshot_mode(monkeypatch) -> None:
    """snapshot 模式不走网络，直接用库内 last。"""
    async def _settings():
        return {"quote_source_mode": "snapshot"}
    monkeypatch.setattr(quotes.db, "get_settings", _settings)
    positions = [
        {"symbol": "600519", "kind": "股票", "last": 1521.0},
        {"symbol": "CASH", "kind": "现金", "last": 55000.0},
    ]
    out = await quotes.live_quotes(positions)
    assert out == {"600519": 1521.0, "CASH": 55000.0}


async def test_live_quotes_falls_back_to_snapshot(monkeypatch) -> None:
    """auto 模式东财失败 → 降级快照价。"""
    async def _settings():
        return {"quote_source_mode": "auto"}
    monkeypatch.setattr(quotes.db, "get_settings", _settings)
    async def _fail(_symbols):
        return {}
    monkeypatch.setattr(quotes, "_eastmoney_quotes", _fail)
    positions = [
        {"symbol": "600519", "kind": "股票", "last": 1521.0},
        {"symbol": "CASH", "kind": "现金", "last": 55000.0},
    ]
    out = await quotes.live_quotes(positions)
    assert out == {"600519": 1521.0, "CASH": 55000.0}
