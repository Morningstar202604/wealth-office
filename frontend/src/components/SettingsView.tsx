import { useEffect, useState } from "react";
import { KeyRound, Newspaper, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api, getToken, setToken } from "@/lib/api";
import { store } from "@/lib/store";

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const labelCls = "block text-xs text-muted-foreground mb-1";

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium mb-3">
        {icon}
        {title}
      </div>
      {children}
    </Card>
  );
}

export function SettingsView() {
  const { bootstrap } = store.useApp();
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tokenInput, setTokenInput] = useState(getToken());

  useEffect(() => {
    if (bootstrap) setForm({ ...bootstrap.settings });
  }, [bootstrap]);

  if (!bootstrap) {
    return <div className="p-8 text-center text-sm text-muted-foreground">加载中…</div>;
  }

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await api<{ ok: boolean; errors: string[] }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: form }),
      });
      if (res.errors.length) {
        setMsg({ ok: false, text: `保存失败：${res.errors.join("；")}` });
      } else {
        setMsg({ ok: true, text: "已保存" });
        await store.refreshBootstrap();
        store.bump();
      }
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const resetSeed = async () => {
    if (!window.confirm("恢复示例数据会覆盖当前的持仓、流水与负债，确定吗？")) return;
    await api("/api/portfolio/reset", { method: "POST" });
    await store.refreshBootstrap();
    store.bump();
    setMsg({ ok: true, text: "已恢复示例数据" });
  };

  const sc = bootstrap.scheduler;

  return (
    <div className="space-y-3">
      <Section title="账本假设">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>月收入（元）</label>
            <input className={inputCls} type="number" value={form.monthly_income ?? ""} onChange={(e) => set("monthly_income", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>应急金目标（月）</label>
            <input className={inputCls} type="number" value={form.emergency_target_months ?? ""} onChange={(e) => set("emergency_target_months", e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <label className={labelCls}>必要支出类别（逗号分隔，用于应急金口径）</label>
          <input className={inputCls} value={form.essential_categories ?? ""} onChange={(e) => set("essential_categories", e.target.value)} placeholder="居住,餐饮,交通" />
        </div>
      </Section>

      <Section title="行情源">
        <select className={inputCls} value={form.quote_source_mode ?? "auto"} onChange={(e) => set("quote_source_mode", e.target.value)}>
          <option value="auto">自动：东财实时价，失败降级快照</option>
          <option value="eastmoney">仅东财实时价</option>
          <option value="snapshot">仅快照价（离线可用）</option>
        </select>
        <div className="mt-2 text-xs text-muted-foreground">当前：{bootstrap.source.quotes}</div>
      </Section>

      <Section title="每日晨报" icon={<Newspaper className="w-4 h-4 text-muted-foreground" />}>
        <div className="flex items-end gap-2">
          <div className="w-36">
            <label className={labelCls}>生成时间</label>
            <input className={inputCls} type="time" value={form.report_time ?? "08:00"} onChange={(e) => set("report_time", e.target.value)} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              const r = await api<{ ok: boolean }>("/api/reports/generate", { method: "POST" });
              setMsg({ ok: r.ok, text: r.ok ? "已生成一份晨报，可在历史中查看" : "生成失败" });
              store.bump();
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> 立即生成
          </Button>
        </div>
        <div className="mt-2 text-xs text-muted-foreground">
          {sc.enabled ? `下次：${sc.next_run_at ?? "—"}` : "定时任务未启用"}
          {sc.generated > 0 ? ` · 已生成 ${sc.generated} 份` : ""}
        </div>
      </Section>

      <Section title="数据管理">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {bootstrap.source.seeded ? "当前为示例数据，可到「记账」改成自己的真实数据。" : "当前是你的真实数据。"}
          </div>
          <Button variant="outline" size="sm" onClick={() => void resetSeed()}>
            恢复示例数据
          </Button>
        </div>
      </Section>

      <Section title="访问口令" icon={<KeyRound className="w-4 h-4 text-muted-foreground" />}>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className={labelCls}>浏览器端口令（留空清除）</label>
            <input className={inputCls} type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="后端 API_TOKEN 相同时才有效" />
          </div>
          <Button size="sm" onClick={() => { setToken(tokenInput.trim()); setMsg({ ok: true, text: "口令已更新" }); }}>
            保存
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          未在服务端设置 API_TOKEN 时无需口令；公网部署请务必设置。
        </div>
      </Section>

      <Section title="系统信息" icon={<Sparkles className="w-4 h-4 text-muted-foreground" />}>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between"><span>模型</span><span>{bootstrap.health.llm_configured ? bootstrap.health.model : "未配置（使用本地规则引擎）"}</span></div>
          <div className="flex justify-between"><span>组合数据</span><span>{bootstrap.source.portfolio}</span></div>
          <div className="flex justify-between"><span>账本数据</span><span>{bootstrap.source.ledger}</span></div>
        </div>
      </Section>

      {msg && (
        <div className={`text-sm ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</div>
      )}
      <Button className="w-full" onClick={() => void save()} disabled={saving}>
        {saving ? "保存中…" : "保存设置"}
      </Button>
    </div>
  );
}
