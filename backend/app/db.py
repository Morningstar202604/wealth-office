"""组合库 + 运行历史持久化（aiosqlite，单连接串行，不阻塞事件循环）。

所有函数都是异步的；连接在启动时创建（WAL 模式）。
首次运行自动建表并种入一套示例数据（相对当前日期生成，保证"本月"口径随时可看）。
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any

import aiosqlite

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "wealth.db"

_db: aiosqlite.Connection | None = None
_inited = False

# --------------------------------------------------------------------------
# 种子数据：一套典型中产家庭的示例（用户可在"记账"页改成自己的真实数据）
# --------------------------------------------------------------------------

SEED_POSITIONS = [
    {"symbol": "600519", "name": "贵州茅台", "kind": "股票", "industry": "白酒",
     "shares": 100, "cost": 1680.00, "last": 1521.00},
    {"symbol": "510300", "name": "沪深300ETF", "kind": "ETF", "industry": "宽基指数",
     "shares": 8000, "cost": 3.85, "last": 4.06},
    {"symbol": "110011", "name": "易方达中小盘混合", "kind": "基金", "industry": "主动权益",
     "shares": 12000, "cost": 4.10, "last": 3.58},
    {"symbol": "CASH", "name": "活期现金", "kind": "现金", "industry": "现金",
     "shares": 1, "cost": 55000.00, "last": 55000.00},
]

# day_in_month: 尽量落在本月已过去的日期（今日之前），保证"本月"口径成立
SEED_TRANSACTIONS = [
    (2, "工资入账", "收入", 24800.0),
    (3, "房租", "居住", -5200.0),
    (5, "外卖餐饮", "餐饮", -1860.0),
    (7, "视频会员（年付）", "订阅", -258.0),
    (9, "通勤地铁", "交通", -320.0),
    (11, "健身私教", "订阅", -1999.0),
    (13, "添置家电", "购物", -4300.0),
    (15, "基金定投", "投资", -3000.0),
    (17, "云盘会员", "订阅", -168.0),
    (19, "聚餐", "餐饮", -960.0),
    (20, "信用卡还款", "还款", -3200.0),
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
    # 应急金覆盖所需的"必要月支出"口径：居住 + 餐饮 + 交通 三类
    "essential_categories": "居住,餐饮,交通",
    # 行情源：auto（东财优先，失败降级快照）| snapshot | eastmoney
    "quote_source_mode": "auto",
    # 定时晨报时间（HH:MM）
    "report_time": "08:00",
    "data_note": "seed",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS positions (
    symbol   TEXT PRIMARY KEY,
    name     TEXT NOT NULL,
    kind     TEXT NOT NULL DEFAULT '股票',
    industry TEXT NOT NULL DEFAULT '其他',
    shares   REAL NOT NULL,
    cost     REAL NOT NULL,
    last     REAL NOT NULL,
    buy_date TEXT,
    fee      REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS transactions (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    date     TEXT NOT NULL,
    item     TEXT NOT NULL,
    category TEXT NOT NULL,
    amount   REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_month ON transactions(date);
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
    flags_json    TEXT NOT NULL DEFAULT '[]',
    created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_thread ON runs(thread_id, id);
"""


def _seed_date(day: int) -> str:
    """种子流水的日期：本月已过去的日期（不晚于今天）。"""
    now = datetime.now()
    return now.replace(day=min(day, now.day)).strftime("%Y-%m-%d")


async def init_db() -> None:
    global _db, _inited
    if _inited:
        return
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    _db = await aiosqlite.connect(str(DB_PATH))
    _db.row_factory = aiosqlite.Row
    await _db.execute("PRAGMA journal_mode=WAL")
    await _db.executescript(SCHEMA)
    if await _count("positions") == 0:
        await _seed_all()
    await _db.commit()
    _inited = True


async def close_db() -> None:
    global _db, _inited
    if _db is not None:
        await _db.close()
    _db = None
    _inited = False


async def _conn() -> aiosqlite.Connection:
    if _db is None:
        await init_db()
    assert _db is not None
    return _db


async def _count(table: str) -> int:
    cur = await _db.execute(f"SELECT COUNT(*) AS n FROM {table}")
    row = await cur.fetchone()
    return int(row["n"]) if row else 0


async def _seed_all() -> None:
    assert _db is not None
    await _db.executemany(
        "INSERT INTO positions(symbol,name,kind,industry,shares,cost,last,buy_date,fee)"
        " VALUES(:symbol,:name,:kind,:industry,:shares,:cost,:last,:buy_date,:fee)",
        [
            {**p, "buy_date": None, "fee": 0.0}
            for p in SEED_POSITIONS
        ],
    )
    await _db.executemany(
        "INSERT INTO transactions(date,item,category,amount) VALUES(?,?,?,?)",
        [( _seed_date(d), item, cat, amt) for d, item, cat, amt in SEED_TRANSACTIONS],
    )
    await _db.executemany(
        "INSERT INTO subscriptions(name,monthly,note) VALUES(:name,:monthly,:note)",
        SEED_SUBSCRIPTIONS,
    )
    await _db.executemany(
        "INSERT INTO debts(name,monthly,balance,rate) VALUES(:name,:monthly,:balance,:rate)",
        SEED_DEBTS,
    )
    await _db.executemany(
        "INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)",
        list(SEED_SETTINGS.items()),
    )


async def reset_to_seed() -> dict[str, Any]:
    """清空并重新种入示例数据（演示/测试用）。"""
    conn = await _conn()
    for t in ("positions", "transactions", "subscriptions", "debts", "settings"):
        await conn.execute(f"DELETE FROM {t}")
    await _seed_all()
    await conn.commit()
    return {"ok": True, "reset": True}


# --------------------------------------------------------------------------
# 读
# --------------------------------------------------------------------------

async def fetch_all(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    conn = await _conn()
    cur = await conn.execute(sql, params)
    rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def fetch_one(sql: str, params: tuple = ()) -> dict[str, Any] | None:
    conn = await _conn()
    cur = await conn.execute(sql, params)
    row = await cur.fetchone()
    return dict(row) if row else None


async def list_positions() -> list[dict[str, Any]]:
    return await fetch_all("SELECT * FROM positions ORDER BY symbol")


async def list_transactions() -> list[dict[str, Any]]:
    return await fetch_all("SELECT * FROM transactions ORDER BY date DESC, id DESC")


async def list_subscriptions() -> list[dict[str, Any]]:
    return await fetch_all("SELECT * FROM subscriptions ORDER BY name")


async def list_debts() -> list[dict[str, Any]]:
    return await fetch_all("SELECT * FROM debts ORDER BY name")


async def get_settings() -> dict[str, str]:
    rows = await fetch_all("SELECT * FROM settings")
    return {r["key"]: r["value"] for r in rows}


# --------------------------------------------------------------------------
# 写
# --------------------------------------------------------------------------

async def add_position(p: dict[str, Any]) -> dict[str, Any]:
    conn = await _conn()
    clean = {
        "symbol": str(p.get("symbol", "")).strip(),
        "name": str(p.get("name", "")).strip() or "未命名",
        "kind": str(p.get("kind", "股票")).strip() or "股票",
        "industry": str(p.get("industry", "其他")).strip() or "其他",
        "shares": float(p.get("shares", 0) or 0),
        "cost": float(p.get("cost", 0) or 0),
        "last": float(p.get("last", 0) or 0),
        "buy_date": (str(p.get("buy_date") or "").strip() or None),
        "fee": float(p.get("fee", 0) or 0),
    }
    if not clean["symbol"]:
        raise ValueError("代码不能为空")
    await conn.execute(
        "INSERT INTO positions(symbol,name,kind,industry,shares,cost,last,buy_date,fee)"
        " VALUES(:symbol,:name,:kind,:industry,:shares,:cost,:last,:buy_date,:fee)"
        " ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, kind=excluded.kind,"
        " industry=excluded.industry, shares=excluded.shares, cost=excluded.cost,"
        " last=excluded.last, buy_date=excluded.buy_date, fee=excluded.fee",
        clean,
    )
    await conn.commit()
    await _mark_user_data(conn)
    return {"ok": True, "symbol": clean["symbol"]}


async def delete_position(symbol: str) -> dict[str, Any]:
    conn = await _conn()
    cur = await conn.execute("DELETE FROM positions WHERE symbol=?", (symbol,))
    await conn.commit()
    return {"ok": True, "deleted": cur.rowcount}


async def add_transaction(date: str, item: str, category: str, amount: float) -> dict[str, Any]:
    conn = await _conn()
    cur = await conn.execute(
        "INSERT INTO transactions(date,item,category,amount) VALUES(?,?,?,?)",
        (date, item, category, float(amount)),
    )
    await conn.commit()
    await _mark_user_data(conn)
    return {"ok": True, "id": cur.lastrowid}


async def delete_transaction(tx_id: int) -> dict[str, Any]:
    conn = await _conn()
    cur = await conn.execute("DELETE FROM transactions WHERE id=?", (int(tx_id),))
    await conn.commit()
    return {"ok": True, "deleted": cur.rowcount}


async def add_debt(d: dict[str, Any]) -> dict[str, Any]:
    conn = await _conn()
    clean = {
        "name": str(d.get("name", "")).strip(),
        "monthly": float(d.get("monthly", 0) or 0),
        "balance": float(d.get("balance", 0) or 0),
        "rate": float(d.get("rate", 0) or 0),
    }
    if not clean["name"]:
        raise ValueError("名称不能为空")
    await conn.execute(
        "INSERT INTO debts(name,monthly,balance,rate) VALUES(:name,:monthly,:balance,:rate)"
        " ON CONFLICT(name) DO UPDATE SET monthly=excluded.monthly,"
        " balance=excluded.balance, rate=excluded.rate",
        clean,
    )
    await conn.commit()
    await _mark_user_data(conn)
    return {"ok": True, "name": clean["name"]}


async def delete_debt(name: str) -> dict[str, Any]:
    conn = await _conn()
    cur = await conn.execute("DELETE FROM debts WHERE name=?", (name,))
    await conn.commit()
    return {"ok": True, "deleted": cur.rowcount}


async def set_setting(key: str, value: str) -> dict[str, Any]:
    conn = await _conn()
    await conn.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(key), str(value)),
    )
    await conn.commit()
    return {"ok": True}


async def _mark_user_data(conn: aiosqlite.Connection) -> None:
    await conn.execute(
        "INSERT INTO settings(key,value) VALUES('data_note','user') "
        "ON CONFLICT(key) DO UPDATE SET value='user'"
    )


# --------------------------------------------------------------------------
# 运行历史
# --------------------------------------------------------------------------

async def save_run(
    thread_id: str,
    question: str,
    answer: str,
    level: str,
    flags: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    conn = await _conn()
    created = datetime.now().astimezone().isoformat(timespec="seconds")
    cur = await conn.execute(
        "INSERT INTO runs(thread_id,question,answer,level,flags_json,created_at)"
        " VALUES(?,?,?,?,?,?)",
        (thread_id or "default", question, answer, level or "",
         json.dumps(flags or [], ensure_ascii=False), created),
    )
    await conn.commit()
    return {"ok": True, "id": cur.lastrowid}


async def list_runs(thread_id: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    if thread_id:
        rows = await fetch_all(
            "SELECT * FROM runs WHERE thread_id=? ORDER BY id DESC LIMIT ?",
            (thread_id, int(limit)),
        )
    else:
        rows = await fetch_all(
            "SELECT * FROM runs ORDER BY id DESC LIMIT ?", (int(limit),)
        )
    for r in rows:
        try:
            r["flags"] = json.loads(r.pop("flags_json") or "[]")
        except Exception:
            r["flags"] = []
    return rows
