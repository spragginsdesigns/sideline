"use client";
import Link from "next/link";
import clsx from "clsx";
import type { DashboardView } from "@/lib/view";

export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-2", className)}>
      <svg viewBox="0 0 64 64" width="30" height="30" aria-hidden>
        <rect width="64" height="64" rx="14" fill="#0f172a" />
        <rect x="9" y="9" width="46" height="46" rx="6" fill="none" stroke="#e2e8f0" strokeOpacity=".35" strokeWidth="2" />
        <line x1="32" y1="9" x2="32" y2="55" stroke="#e2e8f0" strokeOpacity=".35" strokeWidth="2" />
        <circle cx="32" cy="32" r="8" fill="none" stroke="#e2e8f0" strokeOpacity=".35" strokeWidth="2" />
        <path d="M20 35l7 7 17-19" fill="none" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="font-display text-xl font-bold uppercase tracking-[0.14em] text-chalk">Sideline</span>
    </span>
  );
}

export function ModeBadge({ mode, environment }: { mode: DashboardView["mode"]; environment: DashboardView["environment"] }) {
  if (mode === "live")
    return (
      <span className="pill pill-paid" title="Talking to the real PayPal REST API">
        <span className="dot-live" /> PayPal {environment}
      </span>
    );
  return (
    <span className="pill pill-sent" title="No PayPal keys set: PayPal responses and webhooks are simulated locally">
      ● PayPal simulator
    </span>
  );
}

export function TopBar({ data, active }: { data: DashboardView | null; active: "board" | "report" }) {
  return (
    <header className="sticky top-0 z-20 border-b border-chalk/[0.08] bg-night-900/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-[1500px] items-center gap-3 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="Sideline home">
          <Logo />
        </Link>
        {data && (
          <div className="hidden min-w-0 border-l border-chalk/10 pl-3 md:block">
            <div className="truncate text-sm font-semibold">{data.team.name}</div>
            <div className="truncate text-xs text-chalk-faint">
              {data.team.sport} · {data.team.season} · Treasurer {data.team.treasurer}
            </div>
          </div>
        )}
        <nav className="ml-auto flex items-center gap-1 text-sm">
          <Link href="/board" className={clsx("rounded-md px-3 py-2 font-display uppercase tracking-wider", active === "board" ? "bg-chalk/10 text-chalk" : "text-chalk-dim hover:text-chalk")}>
            Board
          </Link>
          <Link href="/report" className={clsx("rounded-md px-3 py-2 font-display uppercase tracking-wider", active === "report" ? "bg-chalk/10 text-chalk" : "text-chalk-dim hover:text-chalk")}>
            Season report
          </Link>
        </nav>
        {data && (
          <div className="hidden sm:block">
            <ModeBadge mode={data.mode} environment={data.environment} />
          </div>
        )}
      </div>
    </header>
  );
}
