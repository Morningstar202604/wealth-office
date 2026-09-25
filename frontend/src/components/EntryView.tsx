import { useState } from "react";
import { Plus, Trash2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/toast";
import { api } from "@/lib/api";
import { store as appStore } from "@/lib/store";
import { fmtMoney } from "@/lib/format";

const KIND_OPTIONS = ["股票", "ETF", "基金", "现金", "其他"];
const CATEGORY_OPTIONS = ["收入", "餐饮", "居住", "交通", "购物", "订阅", "投资", "还款", "其他"];

function today(): string {
  // 用本地时间拼 YYYY-MM-DD（toISOString 是 UTC，东八区凌晨会取到前一天）
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function Section({
  title,
  badge,
  children,
}: {
  title: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-[var(--card-pad)]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-medium">{title}</div>
        {badge}
      </div>
      {children}
    </Card>
  );
}

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const labelCls = "block text-xs text-muted-foreground mb-1";

function PositionForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({
    symbol: "",
    name: "",
    kind: "股票",
    industry: "其他",
    shares: "",
    cost: "",
    last: "",
  });
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    try {
      await api("/api/positions", {
        method: "POST",
        body: JSON.stringify({
          symbol: f.symbol.trim(),
          name: f.name.trim(),
          kind: f.kind,
          industry: f.industry.trim() || "其他",
          shares: Number(f.shares),
          cost: Number(f.cost),
          last: Number(f.last),
        }),
      });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelCls}>代码（如 600519）</label>
          <input className={inputCls} value={f.symbol} onChange={(e) => setF({ ...f, symbol: e.target.value })} placeholder="600519" />
        </div>
        <div>
          <label className={labelCls}>名称</label>
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="贵州茅台" />
        </div>
        <div>
          <label className={labelCls}>类型</label>
          <select className={inputCls} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
            {KIND_OPTIONS.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>行业</label>
          <input className={inputCls} value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} placeholder="白酒" />
        </div>
        <div>
          <label className={labelCls}>股数/份额</label>
          <input className={inputCls} type="number" value={f.shares} onChange={(e) => setF({ ...f, shares: e.target.value })} placeholder="100" />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <label className={labelCls}>成本价</label>
            <input className={inputCls} type="number" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="1680" />
          </div>
          <div>
            <label className={labelCls}>现价</label>
            <input className={inputCls} type="number" value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} placeholder="1521" />
          </div>
        </div>
      </div>
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      <Button size="sm" onClick={() => void submit()} disabled={!f.symbol || !f.shares || !f.cost || !f.last}>
        <Plus className="w-3.5 h-3.5" /> 添加持仓
      </Button>
    </div>
  );
}

function TransactionForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ date: today(), item: "", category: "餐饮", amount: "" });
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    const amount = Number(f.amount);
    try {
      await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          date: f.date,
          item: f.item.trim(),
          category: f.category,
          amount: f.category === "收入" ? Math.abs(amount) : -Math.abs(amount),
        }),
      });
      setF({ date: today(), item: "", category: "餐饮", amount: "" });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelCls}>日期</label>
          <input className={inputCls} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </div>
        <div>
          <label className={labelCls}>分类</label>
          <select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>名称</label>
          <input className={inputCls} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} placeholder="午餐 / 工资" />
        </div>
        <div>
          <label className={labelCls}>金额</label>
          <input className={inputCls} type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="66" />
        </div>
      </div>
      <div className="text-[11px] text-muted-foreground">
        选择「收入」记为正数，其余分类记支出。
      </div>
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      <Button size="sm" onClick={() => void submit()} disabled={!f.item || !f.amount}>
        <Plus className="w-3.5 h-3.5" /> 记一笔
      </Button>
    </div>
  );
}

/** 一句话记账：规则解析秒回，复杂句自动升级 AI；成功直接入账。 */
function NlForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const samples = ["昨天打车 32 元", "工资 8000 已到账", "买了件衣服 299"];

  const submit = async (s?: string) => {
    const q = (s ?? text).trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      const r = await api<{ source: string; transaction: { item: string; category: string; amount: number; date: string } }>("/api/nl-add", {
        method: "POST",
        body: JSON.stringify({ text: q }),
      });
      const t = r.transaction;
      toast(
        `已记：${t.category} ${fmtMoney(t.amount, true)}（${t.item} · ${t.date}）${r.source === "ai" ? " · AI 识别" : ""}`,
        "ok",
      );
      setText("");
      onDone();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium mb-1.5">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        一句话记账
      </div>
      <div className="flex gap-2">
        <input
          className={inputCls}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="例如：昨天打车 32 元"
        />
        <Button size="sm" onClick={() => void submit()} disabled={busy || !text.trim()}>
          {busy ? "识别中…" : "记一笔"}
        </Button>
      </div>
      <div className="mt-1.5 flex gap-1.5 flex-wrap">
        {samples.map((s) => (
          <button
            key={s}
            className="rounded-full bg-background border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-primary hover:border-primary/40"
            onClick={() => void submit(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function DebtForm({ onDone }: { onDone: () => void }) {
  const [f, setF] = useState({ name: "", monthly: "", balance: "", rate: "" });
  const [err, setErr] = useState("");

  const submit = async () => {
    setErr("");
    try {
      await api("/api/debts", {
        method: "POST",
        body: JSON.stringify({
          name: f.name.trim(),
          monthly: Number(f.monthly),
          balance: Number(f.balance),
          rate: Number(f.rate) / 100,
        }),
      });
      setF({ name: "", monthly: "", balance: "", rate: "" });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div>
          <label className={labelCls}>名称</label>
          <input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="房贷 / 信用卡分期" />
        </div>
        <div>
          <label className={labelCls}>月供（元）</label>
          <input className={inputCls} type="number" value={f.monthly} onChange={(e) => setF({ ...f, monthly: e.target.value })} placeholder="6800" />
        </div>
        <div>
          <label className={labelCls}>余额（元）</label>
          <input className={inputCls} type="number" value={f.balance} onChange={(e) => setF({ ...f, balance: e.target.value })} placeholder="1280000" />
        </div>
        <div>
          <label className={labelCls}>年利率（%）</label>
          <input className={inputCls} type="number" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="3.45" />
        </div>
      </div>
      {err && <div className="text-xs text-red-600 dark:text-red-400">{err}</div>}
      <Button size="sm" onClick={() => void submit()} disabled={!f.name}>
        <Plus className="w-3.5 h-3.5" /> 添加负债
      </Button>
    </div>
  );
}

export function EntryView() {
  const { dashboard } = appStore.useApp();
  const [tab, setTab] = useState<"position" | "transaction" | "debt">("position");

  const tabs = [
    { id: "position" as const, label: "持仓", count: dashboard?.positions.length },
    { id: "transaction" as const, label: "流水", count: dashboard?.transactions.length },
    { id: "debt" as const, label: "负债", count: dashboard?.debts.items.length },
  ];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        {tabs.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? "default" : "outline"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.count != null && <Badge variant={tab === t.id ? "secondary" : "muted"}>{t.count}</Badge>}
          </Button>
        ))}
      </div>

      {tab === "position" && (
        <Section title="添加持仓" badge={<Badge variant="muted">现价用于估算市值，也可等行情自动更新</Badge>}>
          <PositionForm onDone={() => appStore.bump()} />
          {dashboard && dashboard.positions.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-3">
              {dashboard.positions.map((p) => (
                <div key={p.symbol} className="flex items-center justify-between py-1.5 text-sm">
                  <span>
                    {p.name} <span className="text-muted-foreground text-xs">{p.symbol}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">{p.shares} 份</span>
                    <button
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => {
                        void api(`/api/positions/${p.symbol}`, { method: "DELETE" }).then(() => appStore.bump());
                      }}
                      aria-label={`删除 ${p.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "transaction" && (
        <Section title="记一笔流水">
          <NlForm onDone={() => appStore.bump()} />
          <TransactionForm onDone={() => appStore.bump()} />
          {dashboard && dashboard.transactions.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-3 max-h-72 overflow-y-auto scroll-thin">
              {dashboard.transactions.slice(0, 60).map((t) => (
                <div key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="min-w-0">
                    <span className="truncate">{t.item}</span>
                    <span className="text-muted-foreground text-xs ml-2">{t.date}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className={`tabular-nums ${t.amount > 0 ? "text-up" : "text-down"}`}>
                      {fmtMoney(t.amount, true)}
                    </span>
                    <button
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => {
                        void api(`/api/transactions/${t.id}`, { method: "DELETE" }).then(() => appStore.bump());
                      }}
                      aria-label={`删除 ${t.item}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "debt" && (
        <Section title="添加负债">
          <DebtForm onDone={() => appStore.bump()} />
          {dashboard && dashboard.debts.items.length > 0 && (
            <div className="mt-4 border-t border-border/60 pt-3">
              {dashboard.debts.items.map((d) => (
                <div key={d.name} className="flex items-center justify-between py-1.5 text-sm">
                  <span>
                    {d.name} <span className="text-muted-foreground text-xs">{(d.rate * 100).toFixed(1)}%</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="tabular-nums text-muted-foreground">{fmtMoney(d.monthly)}/月</span>
                    <button
                      className="text-muted-foreground hover:text-red-600"
                      onClick={() => {
                        void api(`/api/debts/${encodeURIComponent(d.name)}`, { method: "DELETE" }).then(() => appStore.bump());
                      }}
                      aria-label={`删除 ${d.name}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}
