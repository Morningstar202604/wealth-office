import { useEffect, useState } from "react";
import { LayoutDashboard, MessageSquare, NotebookPen, Settings } from "lucide-react";
import { TopBar } from "@/components/TopBar";
import { Dashboard } from "@/components/Dashboard";
import { ChatView } from "@/components/ChatView";
import { EntryView } from "@/components/EntryView";
import { SettingsView } from "@/components/SettingsView";
import { store } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tab = "dashboard" | "chat" | "ledger" | "settings";

const NAV = [
  { id: "dashboard" as const, label: "仪表盘", icon: LayoutDashboard },
  { id: "chat" as const, label: "问答", icon: MessageSquare },
  { id: "ledger" as const, label: "记账", icon: NotebookPen },
  { id: "settings" as const, label: "设置", icon: Settings },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("dashboard");

  useEffect(() => {
    void store.refreshBootstrap();
    void store.refreshDashboard();
    void store.refreshHistory();
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar onOpenSettings={() => setTab("settings")} />

      {/* 桌面端顶部导航 */}
      <nav className="hidden md:flex items-center gap-1 border-b border-border bg-card/50 px-4 py-1.5">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              tab === n.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => setTab(n.id)}
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
          <div className="mx-auto max-w-3xl h-full flex flex-col pb-16 md:pb-0">
            <ChatView />
          </div>
        ) : (
          <div className="mx-auto max-w-3xl px-4 py-4 pb-24 md:pb-8">
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
            onClick={() => setTab(n.id)}
          >
            <n.icon className="w-5 h-5" />
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
