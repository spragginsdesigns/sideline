"use client";
import { useEffect, useRef, useState } from "react";
import { Bot, Send, Sparkles, Wrench, X } from "lucide-react";
import { api } from "@/hooks/useDashboard";
import { Spinner } from "./ui";

interface Trace {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}
interface Turn {
  role: "user" | "assistant";
  content: string;
  trace?: Trace[];
}

const SUGGESTIONS = [
  "How much do we have left for Fresno, and who's behind?",
  "Where did our money go this season?",
  "Have both refs been paid for every game?",
  "Which families still owe for uniforms?",
];

export function AskTreasurer({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  async function ask(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    const history = turns.map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: "user", content: text }]);
    setQ("");
    setBusy(true);
    try {
      const r = await api<{ answer: string; trace: Trace[] }>("/api/ask", { question: text, history });
      setTurns((t) => [...t, { role: "assistant", content: r.answer, trace: r.trace }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: `Sorry, I couldn't answer that: ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className="btn btn-primary fixed right-4 bottom-4 z-30 !min-h-14 rounded-full !px-5 shadow-2xl sm:right-6 sm:bottom-6"
        onClick={() => setOpen(true)}
        aria-label="Ask the treasurer"
        style={{ display: open ? "none" : undefined }}
      >
        <Sparkles size={18} /> <span className="hidden sm:inline">Ask the treasurer</span>
        <span className="sm:hidden">Ask</span>
      </button>
      {open && (
        <aside
          aria-label="Ask the treasurer"
          className="rise fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col rounded-t-2xl border border-chalk/15 bg-night-850 shadow-2xl sm:inset-x-auto sm:right-6 sm:bottom-6 sm:h-[620px] sm:max-h-[calc(100dvh-3rem)] sm:w-[420px] sm:rounded-2xl"
        >
          <header className="flex items-center justify-between border-b border-chalk/10 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-led/15 text-led-bright">
                <Bot size={18} />
              </span>
              <div>
                <div className="font-display text-base font-semibold uppercase tracking-wide">Ask the treasurer</div>
                <div className="text-xs text-chalk-faint">Answers from the ledger and PayPal, never guesses</div>
              </div>
            </div>
            <button className="rounded-md p-2 text-chalk-dim hover:bg-chalk/10" onClick={() => setOpen(false)} aria-label="Close">
              <X size={18} />
            </button>
          </header>
          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-chalk-dim">Ask anything about the team&apos;s money. Try:</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} disabled={!enabled} className="block w-full rounded-lg border border-chalk/12 px-3 py-2.5 text-left text-sm text-chalk transition hover:border-led/50 disabled:opacity-50" onClick={() => ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
                <div className={t.role === "user" ? "max-w-[85%] rounded-2xl rounded-br-sm bg-led px-3.5 py-2 text-sm font-medium text-night-900" : "max-w-[95%]"}>
                  {t.role === "assistant" && t.trace && t.trace.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {t.trace.map((tr, k) => (
                        <span key={k} className="inline-flex items-center gap-1 rounded-md border border-sky/25 bg-sky/10 px-2 py-0.5 font-mono text-[0.68rem] text-sky" title={JSON.stringify(tr.args)}>
                          <Wrench size={11} /> {tr.tool} · {tr.summary}
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={t.role === "assistant" ? "whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-night-700 px-3.5 py-2.5 text-sm leading-relaxed text-chalk" : ""}>{t.content}</div>
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-chalk-dim">
                <Spinner /> Checking the books…
              </div>
            )}
            <div ref={end} />
          </div>
          <form
            className="flex gap-2 border-t border-chalk/10 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(q);
            }}
          >
            <input className="field !py-2.5" placeholder={enabled ? "Ask about dues, refs, the bank…" : "Set OPENAI_API_KEY to enable"} value={q} onChange={(e) => setQ(e.target.value)} disabled={!enabled} aria-label="Your question" maxLength={1000} />
            <button className="btn btn-primary !px-3.5" disabled={!enabled || busy || !q.trim()} aria-label="Ask">
              <Send size={16} />
            </button>
          </form>
        </aside>
      )}
    </>
  );
}
