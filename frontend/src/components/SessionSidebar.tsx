/** 桌面侧边栏：品牌 + 导航 + 会话列表 + 设置入口（符合人的使用逻辑：先有导航，再有历史会话）。 */

import { useState } from "react";
import {
  LayoutDashboard, MessageSquare, NotebookPen, Plus, Settings,
  Trash2, Pencil, MessageCircle,
} from "lucide-react";
import { BrandLogo, BRAND } from "@/lib/brand";
import { store } from "@/lib/store";
import { cn } from "@/lib/utils";
import type { SessionItem } from "@/lib/types";

type SidebarTab = "dashboard" | "chat" | "ledger" | "settings";

const NAV: { id: SidebarTab; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { id: "chat", label: "问答", icon: MessageSquare },
  { id: "ledger", label: "记账", icon: NotebookPen },
];

export function SessionSidebar({
  tab,
  activeThread,
  onNavigate,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onOpenSettings,
}: {
  tab: SidebarTab;
  activeThread: string | null;
  /** 切换页面（chat 时由内部决定落到最近会话） */
  onNavigate: (t: SidebarTab) => void;
  onSelect: (threadId: string | null) => void;
  onNew: () => void;
  onDelete: (id: number, threadId: string) => void;
  onRename: (id: number, title: string) => void;
  onOpenSettings: () => void;
}) {
  const { sessions } = store.useApp();
  const [editing, setEditing] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const go = (id: SidebarTab) => {
    onNavigate(id);
    if (id === "chat") onSelect(sessions[0]?.thread_id ?? null);
  };

  return (
    <div className="flex h-full flex-col">
      {/* 品牌：点击回仪表盘 */}
      <button
        type="button"
        className="flex items-center gap-2.5 px-4 py-3.5 text-left"
        onClick={() => onNavigate("dashboard")}
      >
        <BrandLogo size={30} />
        <span>
          <span className="block text-sm font-bold leading-tight">{BRAND.name}</span>
          <span className="block text-[11px] text-muted-foreground leading-tight">{BRAND.tagline}</span>
        </span>
      </button>

      {/* 主导航 */}
      <nav className="px-2 space-y-0.5">
        {NAV.map((n) => (
          <button
            key={n.id}
            type="button"
            className={cn(
              "w-full flex items-center gap-2 rounded-[calc(var(--radius)-2px)] px-3 py-2 text-sm font-medium transition-colors",
              tab === n.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => go(n.id)}
          >
            <n.icon className="w-4 h-4" />
            {n.label}
          </button>
        ))}
      </nav>

      {/* 会话区 */}
      <div className="mt-4 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between px-4 mb-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            会话
          </span>
          <button
            type="button"
            className="text-muted-foreground hover:text-primary p-1"
            aria-label="新建会话"
            onClick={onNew}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto scroll-thin px-2 space-y-0.5">
          {sessions.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              <MessageCircle className="w-4 h-4 mx-auto mb-1.5 opacity-60" />
              还没有会话
              <br />
              点右上角 + 开始
            </div>
          ) : (
            sessions.slice(0, 30).map((s: SessionItem) => (
              <div
                key={s.id}
                className={cn(
                  "group flex items-center gap-1 rounded-[calc(var(--radius)-2px)] px-2 py-1.5 text-sm cursor-pointer transition-colors",
                  s.thread_id === activeThread
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                )}
                onClick={() => onSelect(s.thread_id)}
              >
                {editing === s.id ? (
                  <input
                    autoFocus
                    className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-xs"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        onRename(s.id, editTitle.trim() || s.title);
                        setEditing(null);
                      }
                      if (e.key === "Escape") setEditing(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
                    <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        aria-label="重命名"
                        className="p-0.5 text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(s.id);
                          setEditTitle(s.title);
                        }}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        aria-label="删除会话"
                        className="p-0.5 text-muted-foreground hover:text-red-600"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(s.id, s.thread_id);
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  </>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 底部：设置入口 + 会话数 */}
      <div className="border-t border-border px-2 py-2">
        <button
          type="button"
          className="w-full flex items-center gap-2 rounded-[calc(var(--radius)-2px)] px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={onOpenSettings}
        >
          <Settings className="w-4 h-4" />
          设置
        </button>
        <div className="px-3 pt-1 text-[10px] text-muted-foreground/70">
          {sessions.length} 个会话 · 数据存于本地
        </div>
      </div>
    </div>
  );
}
