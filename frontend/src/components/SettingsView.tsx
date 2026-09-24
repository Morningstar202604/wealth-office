import { useEffect, useState } from "react";
import {
  Download, KeyRound, Newspaper, Palette, RefreshCw, ShieldCheck, SlidersHorizontal, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { useTheme, BRAND_OPTIONS } from "@/lib/theme";
import { api, getToken, setToken } from "@/lib/api";
import { store } from "@/lib/store";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const inputCls =
  "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
const labelCls = "block text-xs text-muted-foreground mb-1";

function Section({
  title,
  icon,
  desc,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-[var(--card-pad)]">
      <div className="flex items-center gap-1.5 text-sm font-medium mb-1">
        {icon}
        {title}
      </div>
      {desc ? <div className="text-xs text-muted-foreground mb-2">{desc}</div> : null}
      {children}
    </Card>
  );
}

function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {hint ? <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function SettingsView() {
  const { bootstrap } = store.useApp();
  const { toast } = useToast();
  const theme = useTheme();

  const { theme: themeMode, setTheme, brand, setBrand, density, setDensity, motion, setMotion } = theme;

  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tokenInput, setTokenInput] = useState(getToken());

  useEffect(() => {
    if (bootstrap) setForm({ ...bootstrap.settings });
  }, [bootstrap]);

  if (!bootstrap) {
    return <div className="p-8 text-center text-sm text-muted-foreground">加载中…</div>;
  }

  const save = async () => {
    setSaving(true);
    try {
      const res = await api<{ ok: boolean; errors: string[] }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify({ settings: form }),
      });
      if (res.errors.length) {
        toast(`保存失败：${res.errors.join("；")}`, "error");
      } else {
        toast("设置已保存", "ok");
        await store.refreshBootstrap();
        store.bump();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggle = (k: string) => set(k, form[k] === "on" ? "off" : "on");

  const resetSeed = async () => {
    if (!window.confirm("恢复示例数据会覆盖当前的持仓、流水与负债，确定吗？")) return;
    await api("/api/portfolio/reset", { method: "POST" });
    await store.refreshBootstrap();
    store.bump();
    toast("已恢复示例数据", "ok");
  };

  const exportBackup = async () => {
    try {
      const data = await api<Record<string, unknown>>("/api/export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `随身理财-备份-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast("备份已下载", "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const sc = bootstrap.scheduler;

  return (
    <div className="space-y-3">
      {/* 外观 */}
      <Section title="外观" icon={<Palette className="w-4 h-4 text-muted-foreground" />} desc="即时生效，保存在本机浏览器">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm">主题模式</span>
            <Segmented
              value={themeMode}
              onChange={setTheme}
              options={[
                { value: "light", label: "浅色" },
                { value: "dark", label: "深色" },
                { value: "system", label: "跟随系统" },
              ]}
            />
          </div>
          <div>
            <div className="text-sm mb-1.5">品牌色</div>
            <div className="flex gap-2">
              {BRAND_OPTIONS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                    brand === b.id
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50",
                  )}
                  onClick={() => setBrand(b.id)}
                >
                  <span
                    className="w-3.5 h-3.5 rounded-full border border-black/10"
                    style={{ background: b.accent }}
                  />
                  {b.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm">界面密度</span>
            <Segmented
              value={density}
              onChange={setDensity}
              options={[
                { value: "comfortable", label: "舒适" },
                { value: "compact", label: "紧凑" },
              ]}
            />
          </div>
          <Row label="界面动效" hint="切换、数字滚动等过渡动画">
            <Switch checked={motion === "on"} onChange={(v) => setMotion(v ? "on" : "off")} label="界面动效" />
          </Row>
        </div>
      </Section>

      {/* 功能开关 */}
      <Section title="功能开关" icon={<SlidersHorizontal className="w-4 h-4 text-muted-foreground" />} desc="保存后对所有设备生效">
        <div className="divide-y divide-border/60">
          <Row label="语音提问" hint="问答页显示麦克风按钮（需浏览器支持）">
            <Switch checked={form.voice_input === "on"} onChange={() => toggle("voice_input")} label="语音提问" />
          </Row>
          <Row label="回答导出" hint="每条回答可复制 / 下载 Markdown">
            <Switch checked={form.show_export === "on"} onChange={() => toggle("show_export")} label="回答导出" />
          </Row>
          <Row label="分析过程默认展开" hint="问答的「查看分析过程」默认显示">
            <Switch checked={form.expand_process === "on"} onChange={() => toggle("expand_process")} label="分析过程默认展开" />
          </Row>
          <Row label="建议入口" hint="问答空状态显示推荐问题">
            <Switch checked={form.show_suggestions === "on"} onChange={() => toggle("show_suggestions")} label="建议入口" />
          </Row>
          <Row label="仪表盘自动刷新" hint="行情/账本变更时后台定时刷新">
            <Switch checked={form.auto_refresh === "on"} onChange={() => toggle("auto_refresh")} label="仪表盘自动刷新" />
          </Row>
          {form.auto_refresh === "on" && (
            <div className="py-2 flex items-center justify-between">
              <span className="text-sm">刷新间隔（秒）</span>
              <input
                type="number"
                min={30}
                max={86400}
                step={30}
                className={cn(inputCls, "w-28 text-right")}
                value={form.auto_refresh_seconds ?? "300"}
                onChange={(e) => set("auto_refresh_seconds", e.target.value)}
              />
            </div>
          )}
          <Row label="大金额缩写" hint="≥1 万显示为「3.0万」，关闭则显示完整数字">
            <Switch checked={form.compact_numbers === "on"} onChange={() => toggle("compact_numbers")} label="大金额缩写" />
          </Row>
        </div>
      </Section>

      {/* 账本假设 */}
      <Section title="账本假设" desc="用于结余、储蓄率、应急金等计算口径">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>月收入（元）</label>
            <input className={inputCls} type="number" value={form.monthly_income ?? ""} onChange={(e) => set("monthly_income", e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>应急金目标（月）</label>
            <input className={inputCls} type="number" value={form.emergency_target_months ?? ""} onChange={(e) => set("emergency_target_months", e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>必要支出类别（逗号分隔，用于应急金口径）</label>
            <input className={inputCls} value={form.essential_categories ?? ""} onChange={(e) => set("essential_categories", e.target.value)} placeholder="居住,餐饮,交通" />
          </div>
          <div>
            <label className={labelCls}>储蓄率目标（%）</label>
            <input className={inputCls} type="number" value={form.savings_goal ?? "20"} onChange={(e) => set("savings_goal", e.target.value)} />
          </div>
        </div>
      </Section>

      {/* 行情源 */}
      <Section title="行情源" icon={<RefreshCw className="w-4 h-4 text-muted-foreground" />}>
        <select className={inputCls} value={form.quote_source_mode ?? "auto"} onChange={(e) => set("quote_source_mode", e.target.value)}>
          <option value="auto">自动：东财实时价，失败降级快照</option>
          <option value="eastmoney">仅东财实时价</option>
          <option value="snapshot">仅快照价（离线可用）</option>
        </select>
        <div className="mt-2 text-xs text-muted-foreground">当前：{bootstrap.source.quotes}</div>
      </Section>

      {/* 每日晨报 */}
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
              try {
                const r = await api<{ ok: boolean }>("/api/reports/generate", { method: "POST" });
                toast(r.ok ? "已生成一份晨报，可在历史中查看" : "生成失败", r.ok ? "ok" : "error");
                store.bump();
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e), "error");
              }
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

      {/* 数据 */}
      <Section title="数据管理" icon={<ShieldCheck className="w-4 h-4 text-muted-foreground" />}>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">
              {bootstrap.source.seeded ? "当前为示例数据，可到「记账」改成自己的真实数据。" : "当前是你的真实数据。"}
            </div>
            <Button variant="outline" size="sm" onClick={() => void resetSeed()}>
              恢复示例数据
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">导出全部数据为 JSON 备份（持仓/流水/负债/设置/问答）</div>
            <Button variant="outline" size="sm" onClick={() => void exportBackup()}>
              <Download className="w-3.5 h-3.5" /> 导出备份
            </Button>
          </div>
        </div>
      </Section>

      {/* 访问口令 */}
      <Section title="访问口令" icon={<KeyRound className="w-4 h-4 text-muted-foreground" />}>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className={labelCls}>浏览器端口令（留空清除）</label>
            <input className={inputCls} type="password" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="后端 API_TOKEN 相同时才有效" />
          </div>
          <Button size="sm" onClick={() => { setToken(tokenInput.trim()); toast("口令已更新", "ok"); }}>
            保存
          </Button>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          未在服务端设置 API_TOKEN 时无需口令；公网部署请务必设置。
        </div>
      </Section>

      {/* 系统信息 */}
      <Section title="系统信息" icon={<Sparkles className="w-4 h-4 text-muted-foreground" />}>
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex justify-between"><span>模型</span><span>{bootstrap.health.llm_configured ? bootstrap.health.model : "未配置（当前用内置分析出答案）"}</span></div>
          <div className="flex justify-between"><span>组合数据</span><span>{bootstrap.source.portfolio}</span></div>
          <div className="flex justify-between"><span>账本数据</span><span>{bootstrap.source.ledger}</span></div>
          <div className="flex justify-between"><span>品牌</span><Badge variant="muted">随身理财</Badge></div>
        </div>
      </Section>

      <Button className="w-full" onClick={() => void save()} disabled={saving}>
        {saving ? "保存中…" : "保存设置"}
      </Button>
    </div>
  );
}
