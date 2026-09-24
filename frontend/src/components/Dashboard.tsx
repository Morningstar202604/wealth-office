import { useMemo, useRef } from "react";
import { AlertTriangle, CheckCircle2, Landmark, RefreshCw, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useEChart, PALETTE } from "@/lib/charts";
import { store } from "@/lib/store";
import { fmtMoney, fmtPct, pnlClass, pnlBgClass } from "@/lib/format";
import { PositionsTable } from "@/components/PositionsTable";
import type { DashboardData } from "@/lib/types";

function StatCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down" | "plain";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "up" ? "text-red-600" : tone === "down" ? "text-emerald-600" : "text-foreground";
  return (
    <Card className="p-3.5 min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums truncate ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div> : null}
    </Card>
  );
}

function RiskBanner({ flags }: { flags: DashboardData["flags"] }) {
  if (!flags.length) {
    return (
      <Card className="p-3.5 flex items-center gap-2 text-sm border-emerald-200 bg-emerald-50/60">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
        <span className="text-emerald-800">未发现明显风险项，当前财务状况整体稳健。</span>
      </Card>
    );
  }
  return (
    <Card className="p-3.5 border-amber-200 bg-amber-50/60">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
        <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
        发现 {flags.length} 项需关注
      </div>
      <ul className="mt-2 space-y-1.5">
        {flags.map((f, i) => (
          <li key={i} className="flex gap-2 text-sm text-amber-800">
            <span className="mt-1.5 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
            {f.text}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function AssetPie({ data }: { data: DashboardData }) {
  const ref = useRef<HTMLDivElement>(null);
  const option = useMemo(() => {
    const items = data.concentration.by_asset.filter((a) => a.pct > 0.5);
    return {
      tooltip: { trigger: "item", formatter: "{b}<br/>占比 {d}%" },
      legend: {
        type: "scroll",
        bottom: 0,
        textStyle: { fontSize: 11 },
        icon: "circle",
        itemWidth: 8,
        itemHeight: 8,
      },
      series: [
        {
          type: "pie",
          radius: ["42%", "68%"],
          center: ["50%", "44%"],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 4, borderColor: "#fff", borderWidth: 2 },
          label: { show: false },
          emphasis: { label: { show: true, fontSize: 12, fontWeight: 600 } },
          data: items.map((a, i) => ({ name: a.name, value: a.pct, itemStyle: { color: PALETTE[i % PALETTE.length] } })),
        },
      ],
      grid: { containLabel: true },
    };
  }, [data]);
  useEChart(ref, option, [option]);
  return <div ref={ref} className="h-52 w-full" />;
}

function ExpenseBar({ data }: { data: DashboardData }) {
  const ref = useRef<HTMLDivElement>(null);
  const option = useMemo(() => {
    const cats = data.cashflow.by_category.slice(0, 6);
    return {
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 12, top: 14, bottom: 4, containLabel: true },
      xAxis: { type: "value", axisLabel: { fontSize: 10, formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`) }, splitLine: { lineStyle: { type: "dashed" } } },
      yAxis: {
        type: "category",
        data: cats.map((c) => c.category),
        axisLabel: { fontSize: 11 },
      },
      series: [
        {
          type: "bar",
          data: cats.map((c, i) => ({
            value: c.amount,
            itemStyle: { color: PALETTE[(i + 2) % PALETTE.length], borderRadius: [0, 4, 4, 0] },
          })),
          barWidth: 14,
          label: { show: true, position: "right", fontSize: 10, formatter: (p: { value: number }) => fmtMoney(p.value) },
        },
      ],
    };
  }, [data]);
  useEChart(ref, option, [option]);
  return <div ref={ref} className="h-52 w-full" />;
}

function EmergencyCard({ data }: { data: DashboardData }) {
  const em = data.emergency;
  const pct = em.target_months ? Math.min(100, (em.months_covered / em.target_months) * 100) : 0;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">应急金</div>
        <Badge variant={em.ok ? "ok" : "warn"}>{em.ok ? "达标" : "不足"}</Badge>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums">{em.months_covered}</span>
        <span className="text-sm text-muted-foreground">个月（目标 {em.target_months} 个月）</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full ${em.ok ? "bg-emerald-500" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        现金 {fmtMoney(em.cash)} / 必要月支出 {fmtMoney(em.essential_monthly)}
      </div>
    </Card>
  );
}

export function Dashboard() {
  const { dashboard, loading } = store.useApp();

  if (loading && !dashboard) {
    return <div className="p-8 text-center text-muted-foreground text-sm">加载中…</div>;
  }
  if (!dashboard) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground mb-3">暂时无法读取数据</p>
        <Button variant="outline" size="sm" onClick={() => store.refreshDashboard()}>
          <RefreshCw className="w-4 h-4" /> 重试
        </Button>
      </div>
    );
  }

  const t = dashboard.totals;
  const cf = dashboard.cashflow;

  return (
    <div className="space-y-3">
      {/* 概览 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="总市值" value={fmtMoney(t.total_market_value)} sub={`成本 ${fmtMoney(t.total_cost)}`} icon={<Wallet className="w-3.5 h-3.5" />} />
        <StatCard
          label="累计盈亏"
          value={`${fmtMoney(t.total_pnl, true)} (${fmtPct(t.total_pnl_pct, true)})`}
          tone={t.total_pnl >= 0 ? "up" : "down"}
        />
        <StatCard label={`${cf.month} 结余`} value={fmtMoney(cf.net, true)} sub={`收入 ${fmtMoney(cf.income)} · 支出 ${fmtMoney(cf.expense)}`} />
        <StatCard label="储蓄率" value={`${cf.savings_rate}%`} sub={cf.savings_rate < 20 ? "低于 20% 建议线" : "健康水平"} />
      </div>

      <RiskBanner flags={dashboard.flags} />

      {/* 图表 */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">资产分布</div>
          <AssetPie data={dashboard} />
        </Card>
        <Card className="p-4">
          <div className="text-sm font-medium mb-2">{cf.month} 支出结构</div>
          <ExpenseBar data={dashboard} />
        </Card>
      </div>

      {/* 应急金 + 负债 */}
      <div className="grid lg:grid-cols-2 gap-3">
        <EmergencyCard data={dashboard} />
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <Landmark className="w-4 h-4 text-muted-foreground" /> 负债
            </div>
            <Badge variant={dashboard.debts.dti_pct > 40 ? "warn" : "ok"}>
              月供占收入 {dashboard.debts.dti_pct}%
            </Badge>
          </div>
          {dashboard.debts.items.length === 0 ? (
            <div className="mt-3 text-sm text-muted-foreground">无负债记录</div>
          ) : (
            <ul className="mt-3 space-y-2">
              {dashboard.debts.items.map((d) => (
                <li key={d.name} className="flex items-center justify-between text-sm">
                  <span>
                    {d.name}
                    <span className="text-xs text-muted-foreground ml-2">利率 {(d.rate * 100).toFixed(1)}%</span>
                  </span>
                  <span className="tabular-nums">{fmtMoney(d.monthly)}/月</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 订阅 */}
      <Card className="p-4">
        <div className="flex items-center justify-between text-sm font-medium">
          <span>订阅</span>
          <span className="text-muted-foreground font-normal">
            月 {fmtMoney(dashboard.subscriptions.monthly_total)} · 年 {fmtMoney(dashboard.subscriptions.annual_total)}
          </span>
        </div>
        {dashboard.subscriptions.items.length === 0 ? (
          <div className="mt-2 text-sm text-muted-foreground">无订阅记录</div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {dashboard.subscriptions.items.map((s) => (
              <li key={s.name} className="flex items-center justify-between text-sm">
                <span>{s.name}</span>
                <span className="tabular-nums text-muted-foreground">{fmtMoney(s.monthly)}/月</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 持仓明细 */}
      <Card className="p-4">
        <div className="text-sm font-medium mb-2">持仓明细</div>
        <PositionsTable rows={dashboard.positions} />
      </Card>
    </div>
  );
}
