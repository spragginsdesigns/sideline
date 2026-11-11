"use client";
import { ArrowDownLeft, ArrowUpRight, BellRing, FileText, Flag, Whistle } from "lucide-react";
import type { DashboardView } from "@/lib/view";
import { money, timeAgo } from "./ui";

type Ev = DashboardView["events"][number];

const ICON: Record<string, { Icon: React.ComponentType<{ size?: number }>; tone: string }> = {
  "invoice.paid": { Icon: ArrowDownLeft, tone: "text-turf-bright bg-turf/12" },
  "payout.succeeded": { Icon: Whistle, tone: "text-sky bg-sky/12" },
  "payout.created": { Icon: Flag, tone: "text-chalk-dim bg-chalk/8" },
  "payout.failed": { Icon: Flag, tone: "text-coral-soft bg-coral/12" },
  "invoice.reminder": { Icon: BellRing, tone: "text-led-bright bg-led/12" },
  "charge.created": { Icon: FileText, tone: "text-chalk bg-chalk/8" },
  expense: { Icon: ArrowUpRight, tone: "text-coral-soft bg-coral/12" },
  "opening.balance": { Icon: ArrowDownLeft, tone: "text-chalk-dim bg-chalk/8" },
};

export function Activity({ events, limit = 14 }: { events: Ev[]; limit?: number }) {
  return (
    <ol className="flex flex-col">
      {events.slice(0, limit).map((e) => {
        const { Icon, tone } = ICON[e.type] ?? ICON["charge.created"];
        const fromPayPal = e.source === "paypal-webhook" || e.source === "paypal-sync";
        return (
          <li key={e.id} className="rise flex gap-3 border-b border-chalk/5 py-2.5 last:border-0">
            <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
              <Icon size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm leading-snug text-chalk">{e.summary}</div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-chalk-faint">
                <span>{timeAgo(e.at)}</span>
                {fromPayPal && <span className="text-sky">· PayPal {e.source === "paypal-sync" ? "sync" : "webhook"}</span>}
                {e.source === "agent" && <span className="text-led">· AI nudge</span>}
              </div>
            </div>
            {e.amountCents !== 0 && (
              <span className={`led shrink-0 text-sm font-semibold ${e.amountCents > 0 ? "text-turf-bright" : "text-coral-soft"}`}>{money(e.amountCents, { sign: true })}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
