import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ChevronDown, ChevronUp, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SummaryBlock } from "@/components/SummaryBlock";
import { apiStream } from "@/lib/api";
import { store } from "@/lib/store";
import type { AnswerMeta } from "@/lib/types";

interface StepInfo {
  id: string;
  label: string;
  detail: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  meta?: AnswerMeta;
  steps: StepInfo[];
  error?: string;
}

const SUGGESTIONS = [
  "我这个月的钱都花到哪了？",
  "帮我看看持仓有什么风险",
  "我的组合现在赚还是亏？",
];

let msgSeq = 1;

export function ChatView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const patchMsg = (id: number, patch: Partial<ChatMessage>) =>
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

  const scrollBottom = () => {
    requestAnimationFrame(() => {
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);

    const userMsg: ChatMessage = { id: msgSeq++, role: "user", text: q, steps: [] };
    const asstMsg: ChatMessage = { id: msgSeq++, role: "assistant", text: "", steps: [] };
    setMessages((prev) => [...prev, userMsg, asstMsg]);
    scrollBottom();

    const controller = new AbortController();
    abortRef.current = controller;

    const acc = { text: "", steps: [] as StepInfo[] };

    try {
      await apiStream(
        "/api/ask",
        { question: q },
        (ev) => {
          switch (ev.type) {
            case "text":
              acc.text += String(ev.delta ?? "");
              patchMsg(asstMsg.id, { text: acc.text });
              break;
            case "step":
              if (ev.phase === "done") {
                acc.steps.push({
                  id: String(ev.id),
                  label: String(ev.label),
                  detail: String(ev.detail),
                });
                patchMsg(asstMsg.id, { steps: [...acc.steps] });
              }
              break;
            case "final":
              acc.text = String(ev.answer ?? acc.text);
              patchMsg(asstMsg.id, {
                text: acc.text,
                meta: {
                  answer: acc.text,
                  level: String(ev.level ?? "L1 洞察"),
                  route: String(ev.route ?? ""),
                  route_reason: String(ev.route_reason ?? ""),
                  metrics: (ev.metrics as Record<string, number>) ?? {},
                  flags: (ev.flags as AnswerMeta["flags"]) ?? [],
                  llm: (ev.llm as "llm" | "template") ?? "template",
                },
              });
              break;
            case "error":
              patchMsg(asstMsg.id, { error: String(ev.message) });
              break;
          }
          scrollBottom();
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error)?.name !== "AbortError") {
        patchMsg(asstMsg.id, { error: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
      store.bump(); // 问答完成后刷新仪表盘与历史
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 消息列表 */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-thin">
        {messages.length === 0 && (
          <div className="pt-10 text-center">
            <Sparkles className="w-8 h-8 mx-auto mb-3 text-primary/70" />
            <div className="text-lg font-semibold">问你的钱，这里都有答案</div>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
              基于你的持仓与账本，回答关于盈亏、支出、负债和风险的问题。
            </p>
            <div className="mt-5 flex flex-col gap-2 max-w-sm mx-auto">
              {SUGGESTIONS.map((s) => (
                <Button key={s} variant="outline" onClick={() => send(s)} disabled={busy}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={m.role === "user" ? "max-w-[85%]" : "max-w-full w-full"}>
              {m.role === "user" ? (
                <div className="inline-block rounded-2xl rounded-br-md bg-primary text-primary-foreground px-4 py-2 text-sm shadow-sm">
                  {m.text}
                </div>
              ) : (
                <Card className="p-4">
                  {m.error ? (
                    <div className="text-sm text-red-600">出错了：{m.error}</div>
                  ) : m.text === "" ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" /> 正在分析…
                    </div>
                  ) : (
                    <>
                      <div className="max-w-none text-sm leading-relaxed text-foreground">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                      </div>
                      {m.meta && <SummaryBlock meta={m.meta} />}
                      {m.steps.length > 0 && (
                        <div className="mt-3">
                          <button
                            type="button"
                            className="text-xs text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
                            onClick={() => setShowSteps((v) => !v)}
                          >
                            查看分析过程
                            {showSteps ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>
                          {showSteps && (
                            <ul className="mt-2 space-y-1.5">
                              {m.steps.map((s, i) => (
                                <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                                  <span className="text-primary shrink-0">✓</span>
                                  <span>
                                    <b className="text-foreground/80">{s.label}</b>
                                    <span className="ml-1">{s.detail}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </Card>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 输入区 */}
      <div className="border-t border-border bg-card/80 backdrop-blur px-3 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            rows={1}
            placeholder="问点什么，比如：我这个月的钱花哪了？"
            className="flex-1 resize-none rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-h-[44px] max-h-32"
          />
          <Button size="icon" onClick={() => send(input)} disabled={busy || !input.trim()}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <div className="mt-1.5 text-[11px] text-muted-foreground">
          Enter 发送 · Shift+Enter 换行
        </div>
      </div>
    </div>
  );
}
