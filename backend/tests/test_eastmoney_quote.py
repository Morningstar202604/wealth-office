"""Behavior Lock for eastmoney 行情源（covers: R1, R2, R3, R4）。"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from app.tools import data_client
from app.tools.data_client import EastmoneySource, SnapshotSource

# ---- R1: secid 映射 ----


@pytest.mark.parametrize(
    ("symbol", "secid"),
    [
        ("600519", "1.600519"),
        ("688981", "1.688981"),
        ("000001", "0.000001"),
        ("300750", "0.300750"),
        ("510300", "1.510300"),
        ("159915", "0.159915"),
    ],
)
def test_to_secid_mapped(symbol: str, secid: str) -> None:
    assert EastmoneySource._to_secid(symbol) == secid


@pytest.mark.parametrize("symbol", ["CASH", "110011", "XXXX", ""])
def test_to_secid_unmappable_returns_none(symbol: str) -> None:
    assert EastmoneySource._to_secid(symbol) is None


# ---- R2: ulist 响应解析（f2/100 缩放） ----


def _ulist_payload(diff: list[dict]) -> dict:
    return {"data": {"total": len(diff), "diff": diff}}


def test_quotes_parses_scaled_integer_prices() -> None:
    payload = _ulist_payload(
        [
            {"f2": 125380, "f12": "600519", "f14": "贵州茅台"},
            {"f2": 1171, "f12": "000001", "f14": "平安银行"},
            {"f2": 4613, "f12": "510300", "f14": "沪深300ETF华泰柏瑞"},
        ]
    )
    resp = type("R", (), {"json": lambda self: payload, "status_code": 200})()
    with patch.object(EastmoneySource, "_get", return_value=payload):
        out = EastmoneySource().quotes(["600519", "000001", "510300"])
    assert out == {"600519": 1253.80, "000001": 11.71, "510300": 46.13}
    assert resp is not None


def test_quotes_skips_missing_or_dash_price() -> None:
    payload = _ulist_payload(
        [
            {"f2": "-", "f12": "600519", "f14": "贵州茅台"},
            {"f2": None, "f12": "000001", "f14": "平安银行"},
        ]
    )
    with patch.object(EastmoneySource, "_get", return_value=payload):
        assert EastmoneySource().quotes(["600519", "000001"]) == {}


def test_quotes_empty_when_no_mappable_symbols() -> None:
    with patch.object(EastmoneySource, "_get") as g:
        assert EastmoneySource().quotes(["CASH", "110011"]) == {}
        g.assert_not_called()


# ---- R3: 网络异常降级 ----


def test_quotes_network_error_returns_empty_dict() -> None:
    with patch.object(EastmoneySource, "_get", side_effect=RuntimeError("disconnect")):
        assert EastmoneySource().quotes(["600519"]) == {}


# ---- R4: 模式路由 + auto 降级 ----


def test_quote_modes_include_eastmoney() -> None:
    from app.main import QUOTE_MODES

    assert "eastmoney" in QUOTE_MODES
    assert set(QUOTE_MODES) >= {"auto", "snapshot", "yfinance", "eastmoney"}


def test_pick_quote_source_eastmoney_mode() -> None:
    with patch.object(data_client, "_quote_mode", return_value="eastmoney"):
        src = data_client.pick_quote_source()
    assert isinstance(src, EastmoneySource)


def test_auto_prefers_eastmoney_when_probe_ok(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(data_client, "_quote_mode", lambda: "auto")
    monkeypatch.setattr(data_client, "_probe", None)
    monkeypatch.setattr(data_client, "_probe_eastmoney", lambda: True)
    src = data_client.pick_quote_source()
    assert isinstance(src, EastmoneySource)


def test_auto_falls_back_snapshot_when_eastmoney_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(data_client, "_quote_mode", lambda: "auto")
    monkeypatch.setattr(data_client, "_probe", None)
    monkeypatch.setattr(data_client, "_probe_eastmoney", lambda: False)
    monkeypatch.setattr(data_client, "_probe_yfinance", lambda: False)
    src = data_client.pick_quote_source()
    assert isinstance(src, SnapshotSource)


# ---- 真实 _probe_eastmoney（不 mock 探测函数本身，抓缩进/返回值回归） ----


def test_probe_eastmoney_true_when_quotes_nonempty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(EastmoneySource, "quotes", lambda self, syms: {"600519": 1.0})
    assert data_client._probe_eastmoney() is True


def test_probe_eastmoney_false_when_quotes_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(EastmoneySource, "quotes", lambda self, syms: {})
    assert data_client._probe_eastmoney() is False
