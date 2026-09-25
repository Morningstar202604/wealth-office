"""API 集成测试：走真实 FastAPI 应用（内存临时库，行情走快照，全程无网络）。"""

from __future__ import annotations

import json
from datetime import datetime

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


async def test_ask_regenerate_replaces_last(client) -> None:
    """重新生成：run 数量不变（替换而非追加），且最后一条是重新生成的结果。"""
    tid = "regen-test"
    async with client.stream("POST", "/api/ask", json={"question": "我的组合怎么样？", "thread_id": tid}) as resp:
        await resp.aread()
    async with client.stream("POST", "/api/ask", json={"question": "我的组合怎么样？", "thread_id": tid, "regenerate": True}) as resp:
        await resp.aread()
    runs = (await client.get(f"/api/history?thread_id={tid}")).json()["runs"]
    assert len(runs) == 1, "重新生成后不应追加新记录"
    assert runs[0]["question"] == "我的组合怎么样？"
    assert "总市值" in runs[0]["answer"]


async def test_ai_misconfig_falls_back_to_template(client) -> None:
    """AI 配置了但端点不可达 → 自动降级模板（不冒充模型输出）。"""
    r = await client.put("/api/settings", json={"settings": {
        "ai_enabled": "on",
        "ai_base_url": "http://127.0.0.1:1/v1",  # 必然连接失败
        "ai_api_key": "test-key",
        "ai_model": "test-model",
    }})
    assert r.status_code == 200
    async with client.stream("POST", "/api/ask", json={"question": "我的组合怎么样？", "thread_id": "ai-fallback"}) as resp:
        events = await _sse_events(resp)
    final = next(e for e in events if e["type"] == "final")
    assert final["llm"] == "template"
    assert "总市值" in final["answer"]


async def test_nl_add_rule_and_fallback(client) -> None:
    """一句话记账：规则解析直接入账；读不懂时 422 引导；空输入 400。"""
    r = await client.post("/api/nl-add", json={"text": "昨天打车 32 元"})
    assert r.status_code == 200
    d = r.json()
    assert d["source"] == "rule"
    assert d["transaction"]["amount"] == -32
    assert d["transaction"]["category"] == "交通"
    assert d["transaction"]["item"] == "打车"

    r2 = await client.post("/api/nl-add", json={"text": "工资 8000 已到账"})
    assert r2.status_code == 200
    assert r2.json()["transaction"]["amount"] == 8000
    assert r2.json()["transaction"]["category"] == "收入"

    # 规则拿不到金额 + 测试环境无 AI 配置 → 422 引导
    r3 = await client.post("/api/nl-add", json={"text": "乱七八糟"})
    assert r3.status_code == 422

    r4 = await client.post("/api/nl-add", json={"text": "  "})
    assert r4.status_code == 400

    # 入账后流水可查
    r5 = (await client.get("/api/dashboard")).json()
    assert any(t["item"] == "打车" and t["amount"] == -32 for t in r5["transactions"])


async def test_csv_import_preview_and_commit(client) -> None:
    """账单 CSV：解析/列映射/预览 → 批量入账 → 流水可查。"""
    csv_text = (
        "交易时间,交易类型,交易对方,金额\n"
        "2026-09-10 12:00:00,支出,滴滴出行,32.00\n"
        "2026-09-11 08:00:00,收入,工资,8000\n"
        "2026-09-12 20:00:00,支出,某某超市,56.50\n"
    )
    r = await client.post("/api/import/csv", json={"content": csv_text})
    assert r.status_code == 200
    d = r.json()
    assert d["total"] == 3
    assert d["mapping"]["date"] == 0 and d["mapping"]["amount"] == 3 and d["mapping"]["desc"] == 2
    by_desc = {p["item"]: p for p in d["preview"]}
    assert by_desc["滴滴出行"]["amount"] == -32
    assert by_desc["滴滴出行"]["category"] == "交通"
    assert by_desc["工资"]["amount"] == 8000
    assert by_desc["工资"]["category"] == "收入"

    r2 = await client.post("/api/import/commit", json={"rows": d["preview"]})
    assert r2.status_code == 200
    assert r2.json()["imported"] == 3

    r3 = (await client.get("/api/dashboard")).json()
    assert any(t["item"] == "滴滴出行" and t["amount"] == -32 for t in r3["transactions"])
    assert any(t["item"] == "工资" and t["amount"] == 8000 for t in r3["transactions"])

    # 表头不可识别 → 422
    r4 = await client.post("/api/import/csv", json={"content": "foo,bar\n1,2\n"})
    assert r4.status_code == 422

    # 空内容 → 400
    r5 = await client.post("/api/import/csv", json={"content": ""})
    assert r5.status_code == 400


async def test_debt_due_day(client) -> None:
    """负债扣款日：保存与归一化（非法值回退空）。"""
    r = await client.post("/api/debts", json={"name": "车贷", "monthly": 2000, "balance": 80000, "rate": 0.05, "due_day": "28"})
    assert r.status_code == 200
    d = (await client.get("/api/dashboard")).json()
    item = next(x for x in d["debts"]["items"] if x["name"] == "车贷")
    assert item["due_day"] == "28"

    await client.post("/api/debts", json={"name": "车贷", "monthly": 2000, "balance": 80000, "rate": 0.05, "due_day": "abc"})
    d2 = (await client.get("/api/dashboard")).json()
    item2 = next(x for x in d2["debts"]["items"] if x["name"] == "车贷")
    assert item2["due_day"] == ""


async def test_budgets_lifecycle(client) -> None:
    """预算：设置本月总预算+分类预算 → 实时使用率计算；非法月份拒绝。"""
    month = datetime.now().astimezone().strftime("%Y-%m")
    r = await client.put("/api/budgets", json={"month": month, "budgets": [
        {"category": "__total", "amount": 5000},
        {"category": "餐饮", "amount": 800},
    ]})
    assert r.status_code == 200
    assert r.json()["count"] == 2

    d = (await client.get(f"/api/budgets?month={month}")).json()
    assert d["month"] == month
    assert d["usage"]["total_budget"] == 5000
    assert d["usage"]["total_spent"] > 0
    assert d["usage"]["total_pct"] > 0
    assert d["usage"]["days_left"] >= 1
    cats = {c["category"]: c for c in d["usage"]["categories"]}
    assert "餐饮" in cats
    assert cats["餐饮"]["budget"] == 800

    # 非法月份拒绝
    r2 = await client.put("/api/budgets", json={"month": "2026-13", "budgets": []})
    assert r2.status_code == 400

    # 重置后预算被清空
    await client.post("/api/portfolio/reset")
    d2 = (await client.get(f"/api/budgets?month={month}")).json()
    assert d2["usage"]["total_budget"] == 0


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


# ---------------------------------------------------------------------------
# 审查修复回归：边界 / 迁移 / 重置 / 鉴权
# ---------------------------------------------------------------------------

async def test_trend_bad_months(client) -> None:
    """months=0 / 负数不再触发 SQL LIMIT 0 崩溃，落到最小 1 个月。"""
    r0 = await client.get("/api/trend?months=0")
    assert r0.status_code == 200 and len(r0.json()["months"]) >= 1
    rn = await client.get("/api/trend?months=-5")
    assert rn.status_code == 200 and len(rn.json()["months"]) >= 1
    rb = await client.get("/api/trend?months=999")
    assert rb.status_code == 200 and len(rb.json()["months"]) <= 24


async def test_transaction_bad_amount_and_date(client) -> None:
    """金额非数字 / 日期格式非法返回 400，而不是 500。"""
    r = await client.post("/api/transactions", json={
        "date": "2026-09-25", "item": "坏金额", "category": "餐饮", "amount": "abc",
    })
    assert r.status_code == 400
    r = await client.post("/api/transactions", json={
        "date": "2026/09/25", "item": "坏日期", "category": "餐饮", "amount": -66,
    })
    assert r.status_code == 400
    r = await client.post("/api/transactions", json={
        "date": "2026-09-25", "item": "零金额", "category": "餐饮", "amount": 0,
    })
    assert r.status_code == 400
    # 合法请求仍成功
    r = await client.post("/api/transactions", json={
        "date": "2026-09-25", "item": "正常", "category": "餐饮", "amount": -66,
    })
    assert r.status_code == 200


async def test_migrate_sessions_from_runs(client) -> None:
    """旧库：已有 runs 但无 sessions，启动时应迁移出会话，标题取首问。"""
    # 模拟旧版本库：runs 存在但 sessions 表无对应记录（绕过 save_run 的自动登记）
    tid = "legacy-thread-1"
    conn = await db._conn()
    for q, a in (("第一个问题", "x"), ("第二个问题", "y")):
        await conn.execute(
            "INSERT INTO runs(thread_id,question,answer,level,flags_json,created_at)"
            " VALUES(?,?,?,?,?,?)",
            (tid, q, a, "L2 建议", "[]", "2026-09-01T08:00:00+08:00"),
        )
    await conn.commit()
    await db._migrate_sessions_from_runs()
    sess = await db.list_sessions()
    match = [s for s in sess if s["thread_id"] == tid]
    assert match and match[0]["title"] == "第一个问题"


async def test_reset_to_seed_keeps_data_note(client) -> None:
    """恢复示例数据后，data_note 仍保持 seed 标记，不应误报用户数据。"""
    r = await client.post("/api/transactions", json={
        "date": "2026-09-25", "item": "临时", "category": "餐饮", "amount": -10,
    })
    assert r.status_code == 200
    d = (await client.get("/api/dashboard")).json()
    assert d["source"]["seeded"] is False

    r = await client.post("/api/portfolio/reset")
    assert r.status_code == 200
    d = (await client.get("/api/dashboard")).json()
    assert d["source"]["seeded"] is True
    assert d["positions"]  # 种子持仓仍在


async def test_deleting_all_positions_does_not_reseed(client, monkeypatch) -> None:
    """用户清空全部持仓后重启服务，不得重新灌入种子数据。"""
    for p in await db.list_positions():
        await db.delete_position(p["symbol"])
    d = (await client.get("/api/dashboard")).json()
    assert d["positions"] == []

    # 模拟重启：重新 init_db（settings 表已有数据，不应触发 seed）
    await db.close_db()
    await db.init_db()
    d = (await client.get("/api/dashboard")).json()
    assert d["positions"] == []


async def test_api_token_auth(client, monkeypatch) -> None:
    """设置 API_TOKEN 后：未带口令 401，带 query token 200。"""
    monkeypatch.setenv("API_TOKEN", "secret-review")
    # 首次请求已发生 token 相关初始化，直接验证 401 分支
    r = await client.get("/api/health")
    assert r.status_code == 200  # health 不做鉴权

    r = await client.get("/api/dashboard")
    assert r.status_code == 401
    r = await client.get("/api/dashboard?token=secret-review")
    assert r.status_code == 200
