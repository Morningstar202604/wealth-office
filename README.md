# 随身理财 · 个人财务工作台

一个**以仪表盘为中心**的个人理财助手：本地账本 + 组合 + 风控规则引擎 + 可选大模型问答。
数据全部存在本地 SQLite，行情走东方财富（失败自动降级快照），不依赖国外服务。

设计原则：

- **确定性内核优先**：持仓/现金流/负债/应急金/集中度等数字全部由规则引擎计算，可靠、免费、秒级；
  大模型只负责把结果"讲成人话"（可选配置），未配置时用模板叙述兜底，绝不假装是模型输出。
- **不重复造轮子**：不装 LangGraph / LangChain / MCP / assistant-ui 等重型框架；
  FastAPI + aiosqlite + APScheduler + ECharts 直接解决问题。
- **交互符合人的习惯**：打开先看仪表盘，记账在独立入口，问答直接出答案，
  没有"人审闸门"式拦截；工程细节（模型调用次数、编排拓扑）不进用户界面。

## 跑起来

```bash
# 后端（依赖见 backend/requirements.txt）
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # 可选：填 LLM_* 启用模型，填 API_TOKEN 启用访问口令
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8787

# 前端：开发模式（热更新，/api 反代到 8787）
cd frontend
npm install && npm run dev    # http://127.0.0.1:5199

# 前端：生产模式（构建后由后端单端口托管）
cd frontend && npm run build
# 然后访问 http://127.0.0.1:8787
```

首次运行自动种入一套示例数据（相对当前日期生成，保证"本月"口径可看），
可在「记账」页替换成你自己的真实持仓/流水/负债。

## 功能

| 入口 | 内容 |
|---|---|
| 仪表盘 | 总市值 / 累计盈亏 / 本月结余 / 储蓄率、资产分布与支出结构图表、应急金进度、负债与订阅、持仓明细（红涨绿跌、可排序） |
| 问答 | 真流式 SSE 回答，尾部带关键数字摘要与风险提示，可展开"分析过程" |
| 记账 | 录入/删除持仓、流水（带完整日期）、负债 |
| 设置 | 账本假设、行情源、每日晨报时间、访问口令、恢复示例数据 |

## 架构

```
用户端（手机优先）→ 前端 Vite + React（仪表盘 ECharts / 问答 / 记账 / 设置）
  → FastAPI：REST + SSE + 静态托管 + 最小鉴权（API_TOKEN）
  → 应用层：确定性分析内核（analysis.py）+ 可选 LLM 问答增强（llm.py，httpx 直连国内模型）
  → 数据层：SQLite（aiosqlite + WAL）持仓/流水/负债/设置/问答历史
  → 外部：东方财富行情（异步、4s 超时、失败降级快照）
```

问答流程（`service.py`，普通异步顺序，无图编排）：规则分类意图 → 并行取数分析（市场/账本视角）
→ 风控规则复核 → 成文（LLM 流式或模板）。

## 目录

```
backend/app/
  db.py        数据层：aiosqlite 单连接 + WAL；流水带完整日期（date 字段）；首次种子示例
  analysis.py  确定性分析内核：持仓/现金流/负债/应急金/集中度/风控规则 + 模板叙述
  quotes.py    行情层：东财 push2 异步批量行情（免 key）+ 快照降级 + 30s 缓存
  llm.py       模型接入：httpx 直连任意 OpenAI 兼容端点（豆包/DeepSeek/Qwen），流式
  service.py   问答服务：意图规则分类 → 并行取数 → 风控复核 → 流式成文 → 归档
  scheduler.py 定时晨报：APScheduler（cron，设置即改即生效）
  main.py      FastAPI：REST + SSE + 鉴权中间件 + 静态托管
frontend/src/
  App.tsx              布局：移动端底部导航 / 桌面端顶部导航
  components/Dashboard.tsx    仪表盘（统计卡 + ECharts 图表 + 风控 + 持仓表）
  components/ChatView.tsx     问答（真流式、建议 chips、分析过程折叠）
  components/EntryView.tsx    记账（持仓/流水/负债增删）
  components/SettingsView.tsx 设置（账本假设/行情源/晨报/口令/数据管理）
  lib/api.ts           请求封装（口令自动附带、401 引导输入）
  lib/store.ts         极简全局状态（仪表盘/历史/引导信息）
  lib/charts.ts        ECharts 按需注册（深度导入，避免整包）
backend/data/          （gitignore）wealth.db：组合/账本/订阅/负债 + runs 历史
docs/screenshots/      旧版界面截图（仅供参考，已过时）
```

## API

| 端点 | 说明 |
|---|---|
| `GET /api/health` | 健康检查（免鉴权） |
| `GET /api/bootstrap` | 设置 + 调度状态 + 模型配置 + 数据来源 |
| `GET /api/dashboard` | 仪表盘全量数据（持仓/账本/负债/风控/来源，一次拉取） |
| `POST /api/positions` · `DELETE /api/positions/{symbol}` | 增/删持仓 |
| `POST /api/transactions` · `DELETE /api/transactions/{id}` | 增/删流水 |
| `POST /api/debts` · `DELETE /api/debts/{name}` | 增/删负债 |
| `GET /api/settings` · `PUT /api/settings` | 读/写设置（数值/枚举/时间格式校验，含错误列表） |
| `POST /api/ask` | SSE 流式问答（事件：start/step/text/final/done） |
| `GET /api/history` | 问答历史（跨会话持久化） |
| `POST /api/reports/generate` · `GET /api/reports` | 手动/查看晨报 |
| `GET /api/scheduler` | 定时晨报状态 |
| `POST /api/portfolio/reset` | 恢复示例数据 |

**鉴权**：设置 `API_TOKEN` 后，所有 `/api/*`（除 health）需带 `Authorization: Bearer <口令>`
或查询参数 `?token=<口令>`；前端首次遇到 401 会提示输入口令并记住。未设置时仅限本机/内网使用。

**模型**：`backend/.env` 配置 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，
任何 OpenAI 兼容端点均可（国内推荐豆包 / DeepSeek / 通义千问）。未配置时走确定性模板。

## 测试与检查

```bash
cd backend && .venv/bin/python -m pytest tests -q   # 39 项：分析内核/行情/API 集成
cd backend && .venv/bin/python -m ruff check app tests
cd frontend && npm run build                        # tsc + vite build
```
