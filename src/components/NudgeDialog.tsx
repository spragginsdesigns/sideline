"use client";
import { useEffect, useState } from "react";
import { BellRing, Languages, Send } from "lucide-react";
import type { DashboardView } from "@/lib/view";
import { LANGUAGE_NAMES, type LanguageCode } from "@/lib/types";
import { api } from "@/hooks/useDashboard";
import { Avatar, Modal, Spinner, money } from "./ui";

interface Nudge {
  invoiceId: string;
  familyId: string;
  language: LanguageCode;
  subject: string;
  message: string;
  english: string;
}

export function NudgeDialog({
  open,
  onClose,
  data,
  invoiceIds,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  data: DashboardView;
  invoiceIds: string[];
  onSent: (n: number) => void;
}) {
  const [nudges, setNudges] = useState<Nudge[] | null>(null);
  const [busy, setBusy] = useState<"draft" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEnglish, setShowEnglish] = useState<Record<string, boolean>>({});
  const [skip, setSkip] = useState<Record<string, boolean>>({});

  const key = invoiceIds.join(",");
  useEffect(() => {
    if (!open) return;
    setNudges(null);
    setError(null);
    setSkip({});
    setShowEnglish({});
    let cancelled = false;
    (async () => {
      setBusy("draft");
      try {
        const r = await api<{ nudges: Nudge[] }>("/api/reminders/draft", { invoiceIds });
        if (!cancelled) setNudges(r.nudges);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const chosen = (nudges ?? []).filter((n) => !skip[n.invoiceId]);

  async function send() {
    setBusy("send");
    setError(null);
    try {
      const r = await api<{ results: { ok: boolean; error?: string }[] }>("/api/reminders/send", {
        reminders: chosen.map((n) => ({ invoiceId: n.invoiceId, subject: n.subject, message: n.message })),
      });
      const okCount = r.results.filter((x) => x.ok).length;
      const failures = r.results.filter((x) => !x.ok);
      if (failures.length) setError(`${failures.length} reminder(s) failed: ${failures.map((f) => f.error).join("; ")}`);
      onSent(okCount);
      if (!failures.length) onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Friendly nudges" wide>
      <p className="mb-4 text-sm text-chalk-dim">
        Sideline writes each reminder in the family&apos;s own language, kind and short, then sends it as a PayPal invoice reminder with their pay link. Edit anything before it goes.
      </p>
      {busy === "draft" && (
        <div className="flex items-center gap-3 rounded-lg border border-chalk/10 p-6 text-chalk-dim">
          <Spinner /> Writing {invoiceIds.length > 0 ? invoiceIds.length : "the"} reminder{invoiceIds.length === 1 ? "" : "s"}…
        </div>
      )}
      {nudges && nudges.length === 0 && <div className="rounded-lg border border-chalk/10 p-6 text-center text-chalk-dim">Nobody is behind. Nice work, treasurer.</div>}
      <ul className="flex flex-col gap-3">
        {(nudges ?? []).map((n) => {
          const fam = data.team.families.find((f) => f.id === n.familyId)!;
          const inv = data.invoices.find((i) => i.id === n.invoiceId);
          const charge = data.charges.find((c) => c.id === inv?.chargeId);
          return (
            <li key={n.invoiceId} className={`rounded-lg border p-3 transition ${skip[n.invoiceId] ? "border-chalk/5 opacity-50" : "border-chalk/12 bg-night-950/50"}`}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Avatar name={fam.guardian} size={30} />
                <span className="font-semibold">{fam.guardian}</span>
                <span className="pill pill-muted">{LANGUAGE_NAMES[n.language]}</span>
                <span className="text-xs text-chalk-faint">
                  {charge?.title} · {inv ? money(inv.amountCents) : ""}
                  {inv?.reminders.length ? ` · ${inv.reminders.length} sent before` : ""}
                </span>
                <label className="ml-auto flex items-center gap-1.5 text-xs text-chalk-dim">
                  <input type="checkbox" checked={!skip[n.invoiceId]} onChange={(e) => setSkip((s) => ({ ...s, [n.invoiceId]: !e.target.checked }))} className="accent-amber-500" />
                  Send
                </label>
              </div>
              <input
                className="field mb-2 !py-2 text-sm font-semibold"
                value={n.subject}
                aria-label={`Subject for ${fam.surname}`}
                onChange={(e) => setNudges((all) => all!.map((x) => (x.invoiceId === n.invoiceId ? { ...x, subject: e.target.value } : x)))}
              />
              <textarea
                className="field min-h-24 text-sm leading-relaxed"
                value={n.message}
                aria-label={`Message for ${fam.surname}`}
                onChange={(e) => setNudges((all) => all!.map((x) => (x.invoiceId === n.invoiceId ? { ...x, message: e.target.value } : x)))}
              />
              {n.language !== "en" && (
                <button className="mt-2 flex items-center gap-1.5 text-xs text-sky hover:underline" onClick={() => setShowEnglish((s) => ({ ...s, [n.invoiceId]: !s[n.invoiceId] }))}>
                  <Languages size={14} /> {showEnglish[n.invoiceId] ? "Hide" : "Show"} English
                </button>
              )}
              {showEnglish[n.invoiceId] && <p className="mt-1.5 rounded-md bg-night-800 p-2 text-sm text-chalk-dim">{n.english}</p>}
            </li>
          );
        })}
      </ul>
      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-coral/40 bg-coral/10 p-3 text-sm text-coral-soft">
          {error}
        </div>
      )}
      {nudges && nudges.length > 0 && (
        <div className="sticky -bottom-5 -mx-5 -mb-5 mt-4 border-t border-chalk/10 bg-night-800 px-5 pt-4 pb-5">
          <button className="btn btn-primary w-full" disabled={busy !== null || chosen.length === 0} onClick={send}>
            {busy === "send" ? <Spinner /> : <Send size={16} />} Send {chosen.length} reminder{chosen.length === 1 ? "" : "s"} through PayPal
          </button>
        </div>
      )}
      {!nudges && !busy && !error && (
        <div className="flex items-center gap-2 text-chalk-dim">
          <BellRing size={16} /> Nothing to draft.
        </div>
      )}
    </Modal>
  );
}
