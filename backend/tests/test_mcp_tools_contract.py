"""Behavior Lock for MCP server tool contract（covers: R1, R2, R3）。"""

from __future__ import annotations

import inspect

from app import mcp_server
from app.tools import demo_data


def _registered_tools() -> dict:
    return {t.name: t for t in mcp_server.server._tool_manager.list_tools()}


def _prop_names(tool) -> list[str]:
    return list(tool.parameters.get("properties", {}))


def test_r1_tool_names_match_demo_data_all() -> None:
    assert set(_registered_tools()) == set(demo_data.__all__)


def test_r2_parameter_names_match_signature() -> None:
    tools = _registered_tools()
    for name in demo_data.__all__:
        src_params = list(inspect.signature(getattr(demo_data, name)).parameters)
        assert _prop_names(tools[name]) == src_params, name


def test_r2_concentration_default_max_pct() -> None:
    props = _registered_tools()["concentration"].parameters["properties"]
    assert "max_pct" in props
    assert float(props["max_pct"]["default"]) == 40.0


def test_r2_zero_arg_tools_have_no_required_params() -> None:
    tools = _registered_tools()
    for name in ("get_portfolio", "cashflow_summary", "data_source"):
        params = tools[name].parameters
        assert params.get("properties", {}) == {} or not params.get("required"), name


def test_r3_get_portfolio_returns_dict() -> None:
    out = demo_data.get_portfolio()
    assert isinstance(out, dict)
    assert "positions" in out
    assert "source" in out


def test_r3_every_demo_tool_callable_returns_dict() -> None:
    for name in demo_data.__all__:
        fn = getattr(demo_data, name)
        kwargs = {"max_pct": 40.0} if name == "concentration" else {}
        out = fn(**kwargs)
        assert isinstance(out, dict), name
