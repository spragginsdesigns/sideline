"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardView } from "@/lib/view";

export type Toast = { id: number; tone: "turf" | "led" | "coral" | "sky"; title: string; body?: string };

/** Polls the server every 2s (PayPal webhooks land server-side) and surfaces new payments as toasts. */
export function useDashboard(intervalMs = 2000) {
  const [data, setData] = useState<DashboardView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [freshlyPaid, setFreshlyPaid] = useState<Set<string>>(new Set());
  const seen = useRef<Map<string, string> | null>(null);
  const seenPayouts = useRef<Map<string, string> | null>(null);

  const pushToast = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 5200);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      const view = json as DashboardView;
      const prev = seen.current;
      const next = new Map(view.invoices.map((i) => [i.id, i.status]));
      if (prev) {
        const newlyPaid = view.invoices.filter((i) => i.status === "PAID" && prev.get(i.id) && prev.get(i.id) !== "PAID");
        if (newlyPaid.length) {
          const ids = newlyPaid.map((i) => i.id);
          setFreshlyPaid((s) => new Set([...s, ...ids]));
          setTimeout(() => setFreshlyPaid((s) => new Set([...s].filter((id) => !ids.includes(id)))), 2400);
          for (const inv of newlyPaid) {
            const fam = view.team.families.find((f) => f.id === inv.payerFamilyId);
            pushToast({
              tone: "turf",
              title: `${fam?.surname ?? ""} family paid`,
              body: `${formatUsd(inv.amountCents)} via ${inv.paidVia ?? "PayPal"} · webhook received`,
            });
          }
        }
      }
      seen.current = next;
      const prevP = seenPayouts.current;
      const nextP = new Map(view.games.map((g) => [g.id, g.payout?.status ?? "none"]));
      if (prevP) {
        for (const g of view.games) {
          if (g.payout?.status === "SUCCESS" && prevP.get(g.id) !== "SUCCESS") {
            const ref = view.team.referees.find((r) => r.id === g.refereeId);
            pushToast({ tone: "sky", title: `Referee ${ref?.name ?? ""} paid`, body: `${formatUsd(g.payout.amountCents)} PayPal payout succeeded` });
          }
        }
      }
      seenPayouts.current = nextP;
      setData(view);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [pushToast]);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);

  return { data, error, refresh, toasts, pushToast, freshlyPaid };
}

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function api<T>(path: string, payload?: unknown): Promise<T> {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error ?? `Request failed (${res.status})`);
  return json as T;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    setMatches(m.matches);
    const on = () => setMatches(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return matches;
}
