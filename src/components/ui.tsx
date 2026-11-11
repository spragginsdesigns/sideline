"use client";
import clsx from "clsx";
import { Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import type { Toast } from "@/hooks/useDashboard";

export function money(cents: number, opts: { sign?: boolean; compact?: boolean } = {}) {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const frac = (abs % 100).toString().padStart(2, "0");
  const body = opts.compact && abs % 100 === 0 ? `$${whole}` : `$${whole}.${frac}`;
  return neg ? `-${body}` : opts.sign && cents > 0 ? `+${body}` : body;
}

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 0) {
    const d = Math.round(-s / 86400);
    return d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`;
  }
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d}d ago`;
}

export function shortDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export function dueLabel(ymd: string | null) {
  if (!ymd) return "No due date";
  return `Due ${new Date(`${ymd}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}

const AVATAR = ["#f59e0b", "#10b981", "#38bdf8", "#f472b6", "#a78bfa", "#fb7185", "#34d399", "#facc15"];
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  const color = AVATAR[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-display text-[0.8rem] font-semibold"
      style={{ width: size, height: size, background: `${color}22`, color, boxShadow: `inset 0 0 0 1.5px ${color}66` }}
    >
      {initials}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("animate-spin", className)} aria-hidden size={16} />;
}

export function Section({
  title,
  kicker,
  action,
  children,
  className,
  id,
}: {
  title: string;
  kicker?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={clsx("card p-4 sm:p-5", className)}>
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          {kicker && <div className="label mb-1 !text-led/90">{kicker}</div>}
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide text-chalk">{title}</h2>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  const tone = {
    turf: "border-turf/50 [&_.t]:text-turf-bright",
    led: "border-led/50 [&_.t]:text-led-bright",
    coral: "border-coral/50 [&_.t]:text-coral-soft",
    sky: "border-sky/50 [&_.t]:text-sky",
  };
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-24 z-50 flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:bottom-24 sm:items-end">
      {toasts.map((t) => (
        <div key={t.id} className={clsx("rise pointer-events-auto w-full max-w-sm rounded-xl border bg-night-800/95 px-4 py-3 shadow-2xl", tone[t.tone])}>
          <div className="t font-display text-sm font-semibold uppercase tracking-wider">{t.title}</div>
          {t.body && <div className="mt-0.5 text-sm text-chalk/80">{t.body}</div>}
        </div>
      ))}
    </div>
  );
}

export function StatusPill({ status, late, daysLate }: { status: string; late?: boolean; daysLate?: number }) {
  if (status === "PAID") return <span className="pill pill-paid">● Paid</span>;
  if (status === "SENT" && late) return <span className="pill pill-late">● Late{daysLate ? ` ${daysLate}d` : ""}</span>;
  if (status === "SENT") return <span className="pill pill-sent">● Sent</span>;
  if (status === "DRAFT") return <span className="pill pill-muted">Draft</span>;
  return <span className="pill pill-muted">{status.toLowerCase()}</span>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-night-950/80 sm:items-center sm:p-6" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={clsx("rise card max-h-[92dvh] w-full overflow-y-auto !rounded-b-none p-5 sm:!rounded-xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide">{title}</h2>
          <button className="btn btn-ghost !min-h-10 !px-3" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
