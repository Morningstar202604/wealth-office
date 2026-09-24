import { Moon, RefreshCw, Settings, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BrandLogo, BRAND } from "@/lib/brand";
import { store } from "@/lib/store";
import { useTheme } from "@/lib/theme";

/** 顶栏：品牌 Logo + 标语 + 数据来源徽章 + 主题切换 + 刷新 + 设置。 */
export function TopBar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { dashboard, bootstrap } = store.useApp();
  const { resolved, setTheme } = useTheme();
  const quotesLabel = dashboard?.source.quotes ?? bootstrap?.source.quotes;

  return (
    <header className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border px-4 py-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <BrandLogo size={28} />
        <div className="min-w-0">
          <div className="text-sm font-bold leading-tight truncate">{BRAND.name}</div>
          {quotesLabel ? (
            <div className="text-[11px] text-muted-foreground leading-tight truncate">{quotesLabel}</div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {dashboard?.source.seeded === false && (
          <Badge variant="secondary" className="hidden sm:inline-flex">
            真实数据
          </Badge>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="切换明暗"
          onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
        >
          {resolved === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="刷新数据"
          onClick={() => {
            void store.refreshDashboard();
            void store.refreshBootstrap();
          }}
        >
          <RefreshCw className="w-4 h-4" />
        </Button>
        {onOpenSettings && (
          <Button variant="ghost" size="icon" aria-label="设置" onClick={onOpenSettings}>
            <Settings className="w-4 h-4" />
          </Button>
        )}
      </div>
    </header>
  );
}
