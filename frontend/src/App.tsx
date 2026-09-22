import { useEffect, useRef, useState } from 'react'
import { AssistantRuntimeProvider, useLocalRuntime } from '@assistant-ui/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { wealthAdapter } from '@/lib/wealthAdapter'
import * as store from '@/lib/agentStore'
import { ChatThread } from '@/components/ChatThread'
import { TeamPanel } from '@/components/TeamPanel'
import { SettingsModal } from '@/components/SettingsModal'
import { TopBar } from '@/components/TopBar'

export default function App() {
  const runtime = useLocalRuntime(wealthAdapter)
  const asked = useRef(false)
  const [workbenchOpen, setWorkbenchOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    fetch('/api/roster')
      .then((r) => r.json())
      .then(store.setRoster)
      .catch(() => {})
    fetch('/api/health')
      .then((r) => r.json())
      .then(store.setHealth)
      .catch(() => {})
    // 跨会话历史：后端持久化，刷新页面后仍显示过往问答
    fetch('/api/history?limit=20')
      .then((r) => r.json())
      .then((d) => store.setHistory(Array.isArray(d?.runs) ? d.runs : []))
      .catch(() => {})
  }, [])

  // 深链 ?q= 自动提问（便于演示/分享）
  useEffect(() => {
    if (asked.current) return
    const q = new URLSearchParams(window.location.search).get('q')
    if (q) {
      asked.current = true
      const t = setTimeout(() => {
        runtime.thread.append({ role: 'user', content: [{ type: 'text', text: q }] })
      }, 350)
      return () => clearTimeout(t)
    }
  }, [runtime])

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider delayDuration={150}>
        <div className="grid h-full grid-cols-1 lg:grid-cols-[1fr_360px]">
          <section className="flex min-h-0 flex-col border-border lg:border-r">
            <TopBar
              onOpenSettings={() => setSettingsOpen(true)}
              onToggleWorkbench={() => setWorkbenchOpen(true)}
            />
            <div className="min-h-0 flex-1">
              <ChatThread runtime={runtime} />
            </div>
          </section>
          <div className="hidden min-h-0 lg:block">
            <TeamPanel />
          </div>
        </div>

        {/* 窄屏数据工作台抽屉：<1024px 时右栏内容收纳于此，不再断裂 */}
        {workbenchOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-foreground/30" onClick={() => setWorkbenchOpen(false)} />
            <div className="absolute right-0 top-0 h-full w-[88%] max-w-sm bg-background shadow-lift">
              <TeamPanel onClose={() => setWorkbenchOpen(false)} />
            </div>
          </div>
        )}

        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </TooltipProvider>
    </AssistantRuntimeProvider>
  )
}
