import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Landmark, RefreshCw, Wallet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton, DashboardSkeleton } from "@/components/ui/skeleton";
import { useEChart, usePalette, axisLabelColor } from "@/lib/charts";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";
import { store } from "@/lib/store";
import { fmtMoney, fmtPct, fmtMonth } from "@/lib/format";
import { PositionsTable } from "@/components/PositionsTable";
import type { DashboardData, TrendMonth, BudgetUsage } from "@/lib/types";

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
    tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-foreground";
  return (
    <Card className="p-[var(--card-pad)] min-w-0">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-bold tabular-nums truncate num-in ${color}`}>{value}</div>
      {sub ? <div className="text-xs text-muted-foreground mt-0.5 truncate">{sub}</div> : null}
    </Card>
  );
}

function RiskBanner({ flags }: { flags: DashboardData["flags"] }) {
  if (!flags.length) {
    return (
      <Card className="p-[var(--card-pad)] flex items-center gap-2 text-sm border-emerald-500/30 bg-emerald-500/10">
        <CheckCircle2 className="w-4 h-4 text-down shrink-0" />
        <span className="text-down">未发现明显风险项，当前财务状况整体稳健。</span>
      </Card>
    );
  }
  return (
    <Card className="p-[var(--card-pad)] border-amber-500/40 bg-amber-500/10">
      <div className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        发现 {flags.length} 项需关注
      </div>
      <ul className="mt-2 space-y-1.5">
        {flags.map((f, i) => (
          <li key={i} className="flex gap-2 text-sm text-amber-800 dark:text-amber-300/90">
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
  const palette = usePalette();
  const { resolved } = useTheme();
  const option = useMemo(() => {
    const items = data.concentration.by_asset.filter((a) => a.pct > 0.5);
    return {
      tooltip: { trigger: "item", triggerOn: "click", renderMode: "richText", confine: true, formatter: "{b}\n占比 {d}%" },
      legend: {
        type: "scroll",
        bottom: 0,
        textStyle: { fontSize: 11, color: axisLabelColor(resolved) },
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
          itemStyle: { borderRadius: 4, borderColor: "transparent", borderWidth: 2 },
          label: { show: false },
          emphasis: { label: { show: true, fontSize: 12, fontWeight: 600, color: axisLabelColor(resolved) } },
          data: items.map((a, i) => ({ name: a.name, value: a.pct, itemStyle: { color: palette[i % palette.length] } })),
        },
      ],
      grid: { containLabel: true },
    };
  }, [data, palette, resolved]);
  useEChart(ref, option, [option]);
  return <div ref={ref} className="h-52 w-full" />;
}

function ExpenseBar({ data }: { data: DashboardData }) {
  const ref = useRef<HTMLDivElement>(null);
  const palette = usePalette();
  const { resolved } = useTheme();
  const option = useMemo(() => {
    const cats = data.cashflow.by_category.slice(0, 6);
    return {
      tooltip: { trigger: "axis", triggerOn: "click", renderMode: "richText", confine: true, axisPointer: { type: "shadow" } },
      grid: { left: 8, right: 12, top: 14, bottom: 4, containLabel: true },
      xAxis: {
        type: "value",
        axisLabel: { fontSize: 10, color: axisLabelColor(resolved), formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`) },
        splitLine: { lineStyle: { type: "dashed", color: "hsl(var(--border))" } },
      },
      yAxis: { type: "category", data: cats.map((c) => c.category), axisLabel: { fontSize: 11, color: axisLabelColor(resolved) } },
      series: [
        {
          type: "bar",
          data: cats.map((c, i) => ({
            value: c.amount,
            itemStyle: { color: palette[(i + 2) % palette.length], borderRadius: [0, 4, 4, 0] },
          })),
          barWidth: 14,
          label: { show: true, position: "right", fontSize: 10, color: axisLabelColor(resolved), formatter: (p: { value: number }) => fmtMoney(p.value) },
        },
      ],
    };
  }, [data, palette, resolved]);
  useEChart(ref, option, [option]);
  return <div ref={ref} className="h-52 w-full" />;
}

/** 月度收支趋势（柱状：收入 / 支出，折线：结余） */
function TrendChart({ trend }: { trend: TrendMonth[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { resolved } = useTheme();
  const palette = usePalette();
  const option = useMemo(() => {
    const months = trend.map((t) => fmtMonth(t.month));
    return {
      tooltip: { trigger: "axis", triggerOn: "click", renderMode: "richText", confine: true },
      legend: { top: 0, textStyle: { fontSize: 11, color: axisLabelColor(resolved) } },
      grid: { left: 8, right: 8, top: 30, bottom: 4, containLabel: true },
      xAxis: { type: "category", data: months, axisLabel: { fontSize: 10, color: axisLabelColor(resolved) } },
      yAxis: {
        type: "value",
        axisLabel: { fontSize: 10, color: axisLabelColor(resolved), formatter: (v: number) => (v >= 10000 ? `${(v / 10000).toFixed(1)}万` : `${v}`) },
        splitLine: { lineStyle: { type: "dashed", color: "hsl(var(--border))" } },
      },
      series: [
        {
          name: "收入",
          type: "bar",
          data: trend.map((t) => t.income),
          itemStyle: { color: palette[2], borderRadius: [4, 4, 0, 0] },
          barWidth: 12,
        },
        {
          name: "支出",
          type: "bar",
          data: trend.map((t) => t.expense),
          itemStyle: { color: palette[5], borderRadius: [4, 4, 0, 0] },
          barWidth: 12,
        },
        {
          name: "结余",
          type: "line",
          data: trend.map((t) => t.net),
          symbolSize: 5,
          itemStyle: { color: palette[0] },
          lineStyle: { width: 2 },
        },
      ],
    };
  }, [trend, resolved, palette]);
  useEChart(ref, option, [option]);
  return <div ref={ref} className="h-56 w-full" />;
}

function EmergencyCard({ data }: { data: DashboardData }) {
  const em = data.emergency;
  const pct = em.target_months ? Math.min(100, (em.months_covered / em.target_months) * 100) : 0;
  return (
    <Card className="p-[var(--card-pad)]">
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
          className={`h-full rounded-full ${em.ok ? "bg-down" : "bg-amber-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        现金 {fmtMoney(em.cash)} / 必要月支出 {fmtMoney(em.essential_monthly)}
      </div>
    </Card>
  );
}

/** 本月预算：总预算进度 + 剩余日均 + 分类进度；未设置预算时不占位 */
function BudgetCard() {
  const [budget, setBudget] = useState<BudgetUsage | null>(null);
  const compact = store.getState().bootstrap?.settings.compact_numbers === "on";
  useEffect(() => {
    let alive = true;
    api<BudgetUsage>("/api/budgets")
      .then((r) => alive && setBudget(r))
      .catch(() => alive && setBudget(null));
    return () => {
      alive = false;
    };
  }, []);

  if (!budget || budget.usage.total_budget <= 0) return null;
  const u = budget.usage;
  const barCls = u.over ? "bg-red-500" : u.total_pct >= 80 ? "bg-amber-500" : "bg-down";
  return (
    <Card className="p-[var(--card-pad)]">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{budget.month} 预算</div>
        <Badge variant={u.over ? "warn" : "ok"}>{u.over ? "已超支" : u.total_pct >= 80 ? "接近上限" : "进度正常"}</Badge>
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums">{fmtMoney(u.total_spent, false, compact)}</span>
        <span className="text-sm text-muted-foreground">/ {fmtMoney(u.total_budget, false, compact)}（{u.total_pct}%）</span>
      </div>
      <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full rounded-full ${barCls}`} style={{ width: `${Math.min(100, u.total_pct)}%` }} />
      </div>
      <div className="mt-2 text-xs text-muted-foreground">
        {u.over ? `超支 ${fmtMoney(-u.left, false, compact)}` : `剩余 ${fmtMoney(u.left, false, compact)}`}
        {" · 日均 "}
        {u.over ? `超 ${fmtMoney(-u.left_daily, false, compact)}` : `可用 ${fmtMoney(u.left_daily, false, compact)}`}
      </div>
      {u.categories.filter((c) => c.budget > 0).length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {u.categories.filter((c) => c.budget > 0).slice(0, 4).map((c) => (
            <li key={c.category} className="text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>{c.category}</span>
                <span className={c.over ? "text-red-500 font-medium" : ""}>
                  {fmtMoney(c.spent, false, compact)} / {fmtMoney(c.budget, false, compact)}
                  {c.over ? " 超支" : ""}
                </span>
              </div>
              <div className="mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full ${c.over ? "bg-red-500" : c.pct >= 80 ? "bg-amber-500" : "bg-down"}`}
                  style={{ width: `${Math.min(100, c.pct)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Dashboard() {
  const { dashboard, loading, bootstrap } = store.useApp();
  const [trend, setTrend] = useState<TrendMonth[] | null>(null);
  const compact = (bootstrap?.settings.compact_numbers ?? "on") === "on";

  useEffect(() => {
    let alive = true;
    api<{ months: TrendMonth[] }>("/api/trend?months=6")
      .then((r) => alive && setTrend(r.months))
      .catch(() => alive && setTrend([]));
    return () => {
      alive = false;
    };
  }, []);

  if (loading && !dashboard) {
    return <DashboardSkeleton />;
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
  const savingsGoal = Number(bootstrap?.settings.savings_goal ?? 20);

  return (
    <div className="space-y-3">
      {/* 概览 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="总市值" value={fmtMoney(t.total_market_value, false, compact)} sub={`成本 ${fmtMoney(t.total_cost, false, compact)}`} icon={<Wallet className="w-3.5 h-3.5" />} />
        <StatCard
          label="累计盈亏"
          value={`${fmtMoney(t.total_pnl, true, compact)} (${fmtPct(t.total_pnl_pct, true)})`}
          tone={t.total_pnl >= 0 ? "up" : "down"}
        />
        <StatCard label={`${cf.month} 结余`} value={fmtMoney(cf.net, true, compact)} sub={`收入 ${fmtMoney(cf.income, false, compact)} · 支出 ${fmtMoney(cf.expense, false, compact)}`} />
        <StatCard label="储蓄率" value={`${cf.savings_rate}%`} sub={cf.savings_rate < savingsGoal ? `低于 ${savingsGoal}% 建议线` : "健康水平"} />
      </div>

      <RiskBanner flags={dashboard.flags} />

      {/* 图表 */}
      <div className="grid lg:grid-cols-2 gap-3">
        <Card className="p-[var(--card-pad)]">
          <div className="text-sm font-medium mb-2">资产分布</div>
          <AssetPie data={dashboard} />
        </Card>
        <Card className="p-[var(--card-pad)]">
          <div className="text-sm font-medium mb-2">{cf.month} 支出结构</div>
          <ExpenseBar data={dashboard} />
        </Card>
      </div>

      {/* 月度趋势 */}
      <Card className="p-[var(--card-pad)]">
        <div className="text-sm font-medium mb-2">近 6 个月收支趋势</div>
        {trend === null ? (
          <div className="h-56">
            <Skeleton className="h-full w-full" />
          </div>
        ) : trend.length > 0 ? (
          <TrendChart trend={trend} />
        ) : (
          <div className="h-40 flex items-center justify-center text-sm text-muted-foreground">
            流水数据不足以绘制趋势，去「记账」记几笔吧。
          </div>
        )}
      </Card>

      {/* 应急金 + 负债 + 预算 */}
      <div className="grid lg:grid-cols-3 gap-3">
        <EmergencyCard data={dashboard} />
        <BudgetCard />
        <Card className="p-[var(--card-pad)]">
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
                  <span className="tabular-nums">{fmtMoney(d.monthly, false, compact)}/月</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* 订阅 */}
      <Card className="p-[var(--card-pad)]">
        <div className="flex items-center justify-between text-sm font-medium">
          <span>订阅</span>
          <span className="text-muted-foreground font-normal">
            月 {fmtMoney(dashboard.subscriptions.monthly_total, false, compact)} · 年 {fmtMoney(dashboard.subscriptions.annual_total, false, compact)}
          </span>
        </div>
        {dashboard.subscriptions.items.length === 0 ? (
          <div className="mt-2 text-sm text-muted-foreground">无订阅记录</div>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {dashboard.subscriptions.items.map((s) => (
              <li key={s.name} className="flex items-center justify-between text-sm">
                <span>{s.name}</span>
                <span className="tabular-nums text-muted-foreground">{fmtMoney(s.monthly, false, compact)}/月</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 持仓明细 */}
      <Card className="p-[var(--card-pad)]">
        <div className="text-sm font-medium mb-2">持仓明细</div>
        <PositionsTable rows={dashboard.positions} compact={compact} />
      </Card>
    </div>
  );
}
