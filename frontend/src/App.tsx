import { useCallback, useEffect, useState } from "react";
import { LayoutDashboard, MessageSquare, NotebookPen, Settings } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { SessionSidebar } from "@/components/SessionSidebar";
import { Dashboard } from "@/components/Dashboard";
import { ChatView } from "@/components/ChatView";
import { EntryView } from "@/components/EntryView";
import { SettingsView } from "@/components/SettingsView";
import { store } from "@/lib/store";
import { api } from "@/lib/api";
import { useToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Tab = "dashboard" | "chat" | "ledger" | "settings";

const NAV = [
  { id: "dashboard" as const, label: "仪表盘", icon: LayoutDashboard },
  { id: "chat" as const, label: "问答", icon: MessageSquare },
  { id: "ledger" as const, label: "记账", icon: NotebookPen },
  { id: "settings" as const, label: "设置", icon: Settings },
];

export default function App() {
  const { sessions, bootstrap } = store.useApp();
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [activeThread, setActiveThread] = useState<string | null>(null);

  // 首次进入时加载基础数据
  useEffect(() => {
    void store.refreshBootstrap();
    void store.refreshDashboard();
    void store.refreshHistory();
    void store.refreshSessions();
  }, []);

  // 仪表盘自动刷新（设置中心开关）
  const autoRefresh = bootstrap?.settings.auto_refresh === "on";
  const autoRefreshSec = Number(bootstrap?.settings.auto_refresh_seconds ?? 300);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => {
      void store.refreshDashboard();
    }, Math.max(30, autoRefreshSec) * 1000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, autoRefreshSec]);

  const newSession = useCallback(async () => {
    try {
      const r = await api<{ thread_id: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({}),
      });
      await store.refreshSessions();
      setActiveThread(r.thread_id);
      setTab("chat");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }, [toast]);

  const openChat = useCallback(
    (threadId: string | null) => {
      if (!threadId && sessions.length === 0) {
        void newSession();
        return;
      }
      setActiveThread(threadId ?? sessions[0]?.thread_id ?? null);
      setTab("chat");
    },
    [sessions, newSession],
  );

  const deleteSession = useCallback(
    async (id: number, threadId: string) => {
      if (!window.confirm("删除该会话及其全部问答记录？")) return;
      try {
        await api(`/api/sessions/${id}`, { method: "DELETE" });
        await store.refreshSessions();
        if (activeThread === threadId) {
          setActiveThread(null);
        }
        toast("会话已删除", "ok");
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [activeThread, toast],
  );

  const renameSession = useCallback(
    async (id: number, title: string) => {
      try {
        await api(`/api/sessions/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ title }),
        });
        await store.refreshSessions();
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), "error");
      }
    },
    [toast],
  );

  const goChat = () => {
    if (!activeThread && sessions.length > 0) {
      setActiveThread(sessions[0].thread_id);
    } else if (!activeThread && sessions.length === 0) {
      void newSession();
    }
    setTab("chat");
  };

  return (
    <div className="flex h-full">
      {/* 桌面侧边栏 */}
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
        <SessionSidebar
          activeThread={activeThread}
          onSelect={openChat}
          onNew={() => void newSession()}
          onDelete={deleteSession}
          onRename={renameSession}
          onOpenSettings={() => setTab("settings")}
        />
      </aside>

      <div className="flex flex-1 min-w-0 flex-col">
        <TopBar onOpenSettings={() => setTab("settings")} />

        {/* 桌面端顶部导航 */}
        <nav className="hidden md:flex items-center gap-1 border-b border-border bg-card/50 px-4 py-1.5">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-sm font-medium transition-colors",
                tab === n.id
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              onClick={() => (n.id === "chat" ? goChat() : setTab(n.id))}
            >
              <n.icon className="w-4 h-4" />
              {n.label}
            </button>
          ))}
        </nav>

        <main
          className={cn(
            "flex-1 min-h-0",
            tab === "chat" ? "flex flex-col" : "overflow-y-auto scroll-thin",
          )}
        >
          {tab === "chat" ? (
            <div className="mx-auto max-w-3xl h-full flex flex-col pb-20 md:pb-0 view-enter">
              {activeThread ? (
                <ChatView key={activeThread} threadId={activeThread} onNewSession={() => void newSession()} />
              ) : (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  正在准备会话…
                </div>
              )}
            </div>
          ) : (
            <div key={tab} className="mx-auto max-w-3xl px-4 py-4 pb-24 md:pb-8 view-enter">
              {tab === "dashboard" && <Dashboard />}
              {tab === "ledger" && <EntryView />}
              {tab === "settings" && <SettingsView />}
            </div>
          )}
        </main>

        {/* 移动端底部导航 */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-10 glass border-t border-border grid grid-cols-4">
          {NAV.map((n) => (
            <button
              key={n.id}
              type="button"
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors",
                tab === n.id ? "text-primary" : "text-muted-foreground",
              )}
              onClick={() => (n.id === "chat" ? goChat() : setTab(n.id))}
            >
              <n.icon className="w-5 h-5" />
              {n.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
