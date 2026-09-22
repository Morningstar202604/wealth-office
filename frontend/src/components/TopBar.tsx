import { useSyncExternalStore } from 'react'
import { Database, PanelRight, Settings, Sparkles } from 'lucide-react'
import * as store from '@/lib/agentStore'
import { Badge } from './ui/badge'

/** 顶栏降噪：只留品牌 + 数据来源徽章；模型/编排等信息移入设置面板。 */
export function TopBar({
  onOpenSettings,
  onToggleWorkbench,
}: {
  onOpenSettings?: () => void
  onToggleWorkbench?: () => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState)
  const src = state.source

  return (
    <header className="glass sticky top-0 z-10 flex items-center justify-between border-b border-border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Sparkles className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-sm font-semibold leading-tight">随身理财公司</h1>
          <p className="text-[11px] text-muted-foreground">多智能体个人财富管理</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {src && (
          <Badge
            variant="outline"
            className="cursor-default"
            title={`组合：${src.portfolio} · 账本：${src.ledger} · 行情：${src.quotes}`}
          >
            <Database className="mr-1 h-3 w-3" />
            {src.seeded ? '示例数据' : '你的数据'}
          </Badge>
        )}
        {onToggleWorkbench && (
          <button
            type="button"
            onClick={onToggleWorkbench}
            title="打开数据工作台"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:hidden"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        )}
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            title="设置"
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Settings className="h-4 w-4" />
          </button>
        )}
      </div>
    </header>
  )
}
