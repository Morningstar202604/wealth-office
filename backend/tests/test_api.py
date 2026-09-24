"""API 集成测试：走真实 FastAPI 应用（内存临时库，行情走快照，全程无网络）。"""

from __future__ import annotations

import json

import httpx
import pytest
from app import db, main
from app import quotes as quotes_mod


@pytest.fixture(autouse=True)
async def _temp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "wealth.db")
    await db.init_db()
    yield
    await db.close_db()


@pytest.fixture
async def client(_temp_db, monkeypatch):
    # 测试环境行情一律走快照，避免网络请求
    async def _snap(positions):
        return {p["symbol"]: float(p["last"]) for p in positions}
    monkeypatch.setattr(quotes_mod, "live_quotes", _snap)

    transport = httpx.ASGITransport(app=main.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


async def test_health(client) -> None:
    r = await client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


async def test_dashboard_shape(client) -> None:
    r = await client.get("/api/dashboard")
    assert r.status_code == 200
    d = r.json()
    assert d["positions"]
    assert "totals" in d and "total_market_value" in d["totals"]
    assert "flags" in d
    assert d["source"]["seeded"] is True


async def test_add_and_delete_transaction(client) -> None:
    r = await client.post("/api/transactions", json={
        "date": "2026-09-25", "item": "测试支出", "category": "餐饮", "amount": -66.0,
    })
    assert r.status_code == 200
    tx_id = r.json()["id"]
    d = (await client.get("/api/dashboard")).json()
    assert any(t["id"] == tx_id for t in d["transactions"])
    assert d["source"]["seeded"] is False  # 用户数据标记

    r = await client.delete(f"/api/transactions/{tx_id}")
    assert r.json()["deleted"] == 1


async def test_bad_transaction_400(client) -> None:
    r = await client.post("/api/transactions", json={"date": "", "item": "", "amount": 0})
    assert r.status_code == 400


async def test_add_and_delete_position(client) -> None:
    r = await client.post("/api/positions", json={
        "symbol": "000001", "name": "平安银行", "kind": "股票", "industry": "银行",
        "shares": 100, "cost": 10.0, "last": 11.5,
    })
    assert r.status_code == 200
    d = (await client.get("/api/dashboard")).json()
    assert any(p["symbol"] == "000001" for p in d["positions"])
    await client.delete("/api/positions/000001")


async def test_settings_validation(client) -> None:
    r = await client.put("/api/settings", json={"settings": {
        "report_time": "25:99",
        "quote_source_mode": "badmode",
        "monthly_income": "abc",
    }})
    body = r.json()
    assert len(body["errors"]) == 3


async def test_settings_apply(client) -> None:
    r = await client.put("/api/settings", json={"settings": {"monthly_income": "30000"}})
    assert r.status_code == 200
    assert r.json()["errors"] == []
    st = (await client.get("/api/settings")).json()["settings"]
    assert st["monthly_income"] == "30000"


async def _sse_events(resp) -> list[dict]:
    body = (await resp.aread()).decode()
    out = []
    for line in body.splitlines():
        if line.startswith("data: "):
            out.append(json.loads(line[6:]))
    return out


async def test_ask_sse_flow(client) -> None:
    async with client.stream("POST", "/api/ask", json={"question": "我这个月的钱都花到哪了？"}) as resp:
        assert resp.status_code == 200
        events = await _sse_events(resp)
    types = [e["type"] for e in events]
    assert types[0] == "start"
    assert "final" in types
    assert types[-1] == "done"
    final = next(e for e in events if e["type"] == "final")
    assert final["route"] == "ledger"
    assert "收入" in final["answer"]
    assert "结余" in final["answer"]


async def test_ask_missing_question_400(client) -> None:
    r = await client.post("/api/ask", json={})
    assert r.status_code == 400


async def test_history_archival(client) -> None:
    async with client.stream("POST", "/api/ask", json={"question": "我的组合怎么样？", "thread_id": "t1"}) as resp:
        await resp.aread()
    runs = (await client.get("/api/history?thread_id=t1")).json()["runs"]
    assert len(runs) == 1
    assert runs[0]["question"] == "我的组合怎么样？"


async def test_manual_report(client) -> None:
    r = await client.post("/api/reports/generate")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert "总市值" in body["answer"]


# ---------------------------------------------------------------------------
# 会话管理 / 导出 / 趋势（新增能力）
# ---------------------------------------------------------------------------

async def test_sessions_lifecycle(client) -> None:
    # 新建会话（默认标题）
    r = await client.post("/api/sessions")
    assert r.status_code == 200
    sid = r.json()["id"]
    tid = r.json()["thread_id"]

    # 问答落库应自动登记会话，且默认标题被首个问题覆盖
    async with client.stream("POST", "/api/ask", json={"question": "测试问答一", "thread_id": tid}) as resp:
        await resp.aread()
    sess = (await client.get("/api/sessions")).json()["sessions"]
    assert any(s["thread_id"] == tid and s["title"] == "测试问答一" for s in sess)

    # 重命名
    r = await client.patch(f"/api/sessions/{sid}", json={"title": "改名后的会话"})
    assert r.status_code == 200
    sess = (await client.get("/api/sessions")).json()["sessions"]
    assert any(s["id"] == sid and s["title"] == "改名后的会话" for s in sess)

    # 重命名后的标题在后续问答中保持（自定义标题不覆盖）
    async with client.stream("POST", "/api/ask", json={"question": "测试问答二", "thread_id": tid}) as resp:
        await resp.aread()
    sess = (await client.get("/api/sessions")).json()["sessions"]
    assert any(s["id"] == sid and s["title"] == "改名后的会话" for s in sess)

    # 删除会话应连带删除该 thread 的问答
    await client.delete(f"/api/sessions/{sid}")
    sess = (await client.get("/api/sessions")).json()["sessions"]
    assert all(s["thread_id"] != tid for s in sess)
    runs = (await client.get(f"/api/history?thread_id={tid}")).json()["runs"]
    assert runs == []


async def test_settings_new_keys(client) -> None:
    r = await client.put("/api/settings", json={"settings": {
        "voice_input": "on",
        "compact_numbers": "off",
        "savings_goal": "25",
        "auto_refresh": "on",
        "auto_refresh_seconds": "120",
        "bad_key": "x",
    }})
    body = r.json()
    assert body["errors"] == ["未知配置项：bad_key"]
    st = body["settings"]
    assert st["voice_input"] == "on"
    assert st["savings_goal"] == "25"

    # 越界值被拒绝
    r = await client.put("/api/settings", json={"settings": {"savings_goal": "200"}})
    assert r.json()["errors"]


async def test_export_and_trend(client) -> None:
    r = await client.get("/api/export")
    body = r.json()
    assert body["version"] == 2
    assert body["positions"] and body["transactions"] and body["settings"]

    r = await client.get("/api/trend?months=6")
    body = r.json()
    assert body["months"]
    m = body["months"][-1]
    assert "income" in m and "expense" in m and "net" in m
    assert m["income"] > 0 and m["expense"] > 0
