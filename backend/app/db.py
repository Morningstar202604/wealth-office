"""组合库 + 运行历史持久化（stdlib sqlite3，零额外依赖）。

数据出口统一走 `tools/data_client.py`（DataClient）；本模块只负责**存取**，
不含任何分析逻辑。库文件：`backend/data/wealth.db`（首次运行自动建表并种子示例数据）。

三条设计约束：
1. 签名稳定、可替换 —— 上层只认本模块的读写函数，将来换 Postgres 只改这里。
2. 首次种子 = 一套"典型中产家庭"示例数据，用户可通过 API 替换成自己的真实持仓。
3. 每一轮问答落 `runs` 表 → 跨会话可回放（对应架构文档 §3.2 的"审计链"）。
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "wealth.db"

_lock = threading.Lock()
_inited = False

# --------------------------------------------------------------------------
# 首次种子：一个典型的中产家庭账户（用户可改成本人真实数据）
# --------------------------------------------------------------------------

SEED_POSITIONS = [
    {"symbol": "600519", "name": "贵州茅台", "kind": "股票", "industry": "白酒",
     "shares": 100, "cost": 1680.00, "last": 1521.00},
    {"symbol": "510300", "name": "沪深300ETF", "kind": "ETF", "industry": "宽基指数",
     "shares": 8000, "cost": 3.85, "last": 4.06},
    {"symbol": "110011", "name": "易方达中小盘混合", "kind": "基金", "industry": "主动权益",
     "shares": 12000, "cost": 4.10, "last": 3.58},
    {"symbol": "CASH", "name": "活期现金", "kind": "现金", "industry": "现金",
     "shares": 1, "cost": 46200.00, "last": 46200.00},
]

SEED_TRANSACTIONS = [
    {"day": "09-02", "item": "工资入账", "category": "收入", "amount": 24800.0},
    {"day": "09-03", "item": "房租", "category": "居住", "amount": -5200.0},
    {"day": "09-05", "item": "外卖餐饮", "category": "餐饮", "amount": -1860.0},
    {"day": "09-07", "item": "视频会员（年付）", "category": "订阅", "amount": -258.0},
    {"day": "09-09", "item": "通勤地铁", "category": "交通", "amount": -320.0},
    {"day": "09-11", "item": "健身私教", "category": "订阅", "amount": -1999.0},
    {"day": "09-13", "item": "添置家电", "category": "购物", "amount": -4300.0},
    {"day": "09-15", "item": "基金定投", "category": "投资", "amount": -3000.0},
    {"day": "09-17", "item": "云盘会员", "category": "订阅", "amount": -168.0},
    {"day": "09-19", "item": "聚餐", "category": "餐饮", "amount": -960.0},
    {"day": "09-20", "item": "信用卡还款", "category": "还款", "amount": -3200.0},
]

SEED_SUBSCRIPTIONS = [
    {"name": "云盘会员", "monthly": 14.0, "note": "可合并到家庭共享"},
    {"name": "健身私教", "monthly": 1999.0, "note": "占订阅支出绝大部分"},
    {"name": "流媒体", "monthly": 21.5, "note": "与年付会员功能重叠"},
]

SEED_DEBTS = [
    {"name": "房贷", "monthly": 6800.0, "balance": 1280000.0, "rate": 0.0345},
    {"name": "信用卡分期", "monthly": 900.0, "balance": 7200.0, "rate": 0.13},
]

SEED_SETTINGS = {
    "monthly_income": "24800",
    "emergency_target_months": "6",
    # 应急金覆盖所需的"必要月支出"口径：居住 + 餐饮 + 交通 三类（不含投资/还款/订阅）
    "essential_categories": "居住,餐饮,交通",
    # 定时晨报周期（分钟）；默认一天一次
    "report_interval_minutes": "1440",
    "data_note": "seed",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS positions (
    symbol   TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    kind     TEXT NOT NULL,
    industry TEXT NOT NULL,
    shares   REAL NOT NULL,
    cost     REAL NOT NULL,
    last     REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS transactions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    day      TEXT NOT NULL,
    item     TEXT NOT NULL,
    category TEXT NOT NULL,
    amount   REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS subscriptions (
    name    TEXT PRIMARY KEY,
    monthly REAL NOT NULL,
    note    TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS debts (
    name     TEXT PRIMARY KEY,
    monthly  REAL NOT NULL,
    balance  REAL NOT NULL,
    rate     REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id     TEXT NOT NULL,
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL,
    level         TEXT NOT NULL DEFAULT '',
    route         TEXT NOT NULL DEFAULT '',
    route_reason  TEXT NOT NULL DEFAULT '',
    llm_calls     INTEGER NOT NULL DEFAULT 0,
    llm_fallbacks INTEGER NOT NULL DEFAULT 0,
    trace_json    TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs(thread_id, id);
"""


def _conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def _rows(cur: sqlite3.Cursor) -> list[dict[str, Any]]:
    return [dict(r) for r in cur.fetchall()]


def init_db() -> None:
    """建表 + 首次种子。幂等，可反复调用。"""
    global _inited
    if _inited:
        return
    with _lock:
        if _inited:
            return
        conn = _conn()
        try:
            conn.executescript(SCHEMA)
            if conn.execute("SELECT COUNT(*) FROM positions").fetchone()[0] == 0:
                conn.executemany(
                    "INSERT INTO positions(symbol,name,kind,industry,shares,cost,last)"
                    " VALUES(:symbol,:name,:kind,:industry,:shares,:cost,:last)",
                    SEED_POSITIONS,
                )
            if conn.execute("SELECT COUNT(*) FROM transactions").fetchone()[0] == 0:
                conn.executemany(
                    "INSERT INTO transactions(day,item,category,amount)"
                    " VALUES(:day,:item,:category,:amount)",
                    SEED_TRANSACTIONS,
                )
            if conn.execute("SELECT COUNT(*) FROM subscriptions").fetchone()[0] == 0:
                conn.executemany(
                    "INSERT INTO subscriptions(name,monthly,note) VALUES(:name,:monthly,:note)",
                    SEED_SUBSCRIPTIONS,
                )
            if conn.execute("SELECT COUNT(*) FROM debts").fetchone()[0] == 0:
                conn.executemany(
                    "INSERT INTO debts(name,monthly,balance,rate)"
                    " VALUES(:name,:monthly,:balance,:rate)",
                    SEED_DEBTS,
                )
            for k, v in SEED_SETTINGS.items():
                conn.execute(
                    "INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)", (k, v)
                )
            conn.commit()
        finally:
            conn.close()
        _inited = True


def reset_to_seed() -> dict[str, Any]:
    """清空并重新种子（演示/测试用）。"""
    with _lock:
        conn = _conn()
        try:
            for t in ("positions", "transactions", "subscriptions", "debts", "settings"):
                conn.execute(f"DELETE FROM {t}")
            conn.commit()
        finally:
            conn.close()
    global _inited
    _inited = False
    init_db()
    return {"ok": True, "reset": True}


# --------------------------------------------------------------------------
# 读
# --------------------------------------------------------------------------

def list_positions() -> list[dict[str, Any]]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            return _rows(conn.execute("SELECT * FROM positions ORDER BY symbol"))
        finally:
            conn.close()


def list_transactions() -> list[dict[str, Any]]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            return _rows(conn.execute("SELECT * FROM transactions ORDER BY id"))
        finally:
            conn.close()


def list_subscriptions() -> list[dict[str, Any]]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            return _rows(conn.execute("SELECT * FROM subscriptions ORDER BY name"))
        finally:
            conn.close()


def list_debts() -> list[dict[str, Any]]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            return _rows(conn.execute("SELECT * FROM debts ORDER BY name"))
        finally:
            conn.close()


def get_settings() -> dict[str, str]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            return {r["key"]: r["value"] for r in _rows(conn.execute("SELECT * FROM settings"))}
        finally:
            conn.close()


# --------------------------------------------------------------------------
# 写
# --------------------------------------------------------------------------

def replace_positions(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """整体替换持仓（用户录入自己的真实组合）。"""
    init_db()
    clean = []
    for p in rows:
        clean.append({
            "symbol": str(p.get("symbol", "")).strip(),
            "name": str(p.get("name", "")).strip(),
            "kind": str(p.get("kind", "股票")).strip() or "股票",
            "industry": str(p.get("industry", "其他")).strip() or "其他",
            "shares": float(p.get("shares", 0) or 0),
            "cost": float(p.get("cost", 0) or 0),
            "last": float(p.get("last", 0) or 0),
        })
    clean = [p for p in clean if p["symbol"]]
    with _lock:
        conn = _conn()
        try:
            conn.execute("DELETE FROM positions")
            conn.executemany(
                "INSERT INTO positions(symbol,name,kind,industry,shares,cost,last)"
                " VALUES(:symbol,:name,:kind,:industry,:shares,:cost,:last)",
                clean,
            )
            conn.execute(
                "INSERT INTO settings(key,value) VALUES('data_note','user') "
                "ON CONFLICT(key) DO UPDATE SET value='user'"
            )
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "count": len(clean)}


def add_transaction(day: str, item: str, category: str, amount: float) -> dict[str, Any]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            cur = conn.execute(
                "INSERT INTO transactions(day,item,category,amount) VALUES(?,?,?,?)",
                (day, item, category, float(amount)),
            )
            conn.commit()
            return {"ok": True, "id": cur.lastrowid}
        finally:
            conn.close()


def delete_transaction(tx_id: int) -> dict[str, Any]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            cur = conn.execute("DELETE FROM transactions WHERE id=?", (int(tx_id),))
            conn.commit()
            return {"ok": True, "deleted": cur.rowcount}
        finally:
            conn.close()


def replace_debts(rows: list[dict[str, Any]]) -> dict[str, Any]:
    init_db()
    clean = [{
        "name": str(d.get("name", "")).strip(),
        "monthly": float(d.get("monthly", 0) or 0),
        "balance": float(d.get("balance", 0) or 0),
        "rate": float(d.get("rate", 0) or 0),
    } for d in rows]
    clean = [d for d in clean if d["name"]]
    with _lock:
        conn = _conn()
        try:
            conn.execute("DELETE FROM debts")
            conn.executemany(
                "INSERT INTO debts(name,monthly,balance,rate) VALUES(:name,:monthly,:balance,:rate)",
                clean,
            )
            conn.commit()
        finally:
            conn.close()
    return {"ok": True, "count": len(clean)}


def set_setting(key: str, value: str) -> dict[str, Any]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (str(key), str(value)),
            )
            conn.commit()
        finally:
            conn.close()
    return {"ok": True}


# --------------------------------------------------------------------------
# 运行历史（跨会话持久化 / 审计链）
# --------------------------------------------------------------------------

def save_run(
    thread_id: str,
    question: str,
    answer: str,
    level: str,
    route: str,
    route_reason: str,
    llm_calls: int,
    llm_fallbacks: int,
    trace: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    init_db()
    created = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    with _lock:
        conn = _conn()
        try:
            cur = conn.execute(
                "INSERT INTO runs(thread_id,question,answer,level,route,route_reason,"
                "llm_calls,llm_fallbacks,trace_json,created_at)"
                " VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    thread_id or "default",
                    question,
                    answer,
                    level or "",
                    route or "",
                    route_reason or "",
                    int(llm_calls or 0),
                    int(llm_fallbacks or 0),
                    json.dumps(trace or [], ensure_ascii=False),
                    created,
                ),
            )
            conn.commit()
            return {"ok": True, "id": cur.lastrowid}
        finally:
            conn.close()


def list_runs(thread_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    init_db()
    with _lock:
        conn = _conn()
        try:
            if thread_id:
                cur = conn.execute(
                    "SELECT * FROM runs WHERE thread_id=? ORDER BY id DESC LIMIT ?",
                    (thread_id, int(limit)),
                )
            else:
                cur = conn.execute(
                    "SELECT * FROM runs ORDER BY id DESC LIMIT ?", (int(limit),)
                )
            out = _rows(cur)
        finally:
            conn.close()
    for r in out:
        try:
            r["trace"] = json.loads(r.pop("trace_json") or "[]")
        except Exception:
            r["trace"] = []
    return out
