import { RefreshCw, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { store } from "@/lib/store";

/** 顶栏：品牌 + 数据来源徽章 + 刷新。安静、不暴露工程细节。 */
export function TopBar({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const { dashboard, bootstrap } = store.useApp();
  const quotesLabel = dashboard?.source.quotes ?? bootstrap?.source.quotes;

  return (
    <header className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border px-4 py-2.5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Wallet style={{ width: 18, height: 18 }} />
        </div>
        <div>
          <div className="text-sm font-bold leading-tight">随身理财</div>
          {quotesLabel ? (
            <div className="text-[11px] text-muted-foreground leading-tight">{quotesLabel}</div>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {dashboard?.source.seeded === false && (
          <Badge variant="secondary" className="hidden sm:inline-flex">
            真实数据
          </Badge>
        )}
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
            <span className="text-lg leading-none">⚙</span>
          </Button>
        )}
      </div>
    </header>
  );
}
