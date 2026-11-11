"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, MessageSquareText, Send, Sparkles, Undo2 } from "lucide-react";
import type { DashboardView } from "@/lib/view";
import type { ChargePreview } from "@/lib/sideline";
import { api } from "@/hooks/useDashboard";
import { Avatar, Spinner, dueLabel, money } from "./ui";

const SAMPLES = [
  "Fresno tournament is $450 for the team, split it. The Garcias are covering the Nguyens this time, and Mia is on scholarship so the team fund covers her. Need it by next Friday!",
  "Hey all! Team photos + end of season party = $35 a family. The Lees already paid me cash. Harpreet, you're half since Amrit joined late 🙏",
  "Ref fees went up, need $12 per kid for the rest of the season. Chens are sitting this one out (Lily's injured). Due Sunday.",
];

export function ChargeComposer({
  data,
  onCreated,
  onPreviewChange,
}: {
  data: DashboardView;
  onCreated: (chargeId: string, sent: number) => void;
  onPreviewChange?: (open: boolean) => void;
}) {
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState<ChargePreview | null>(null);
  const [phase, setPhase] = useState<"idle" | "reading" | "sending">("idle");
  const [error, setError] = useState<string | null>(null);
  // One idempotency key per preview: a double-click or a retried request can't create the charge twice.
  const sendKey = useRef<string | null>(null);
  const sending = useRef(false);
  const fam = (id: string) => data.team.families.find((f) => f.id === id)!;
  useEffect(() => onPreviewChange?.(preview !== null), [preview, onPreviewChange]);

  async function read() {
    setPhase("reading");
    setError(null);
    try {
      setPreview(await api<ChargePreview>("/api/charges/preview", { message }));
      sendKey.current = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPhase("idle");
    }
  }

  async function send() {
    if (!preview || sending.current) return;
    sending.current = true;
    setPhase("sending");
    setError(null);
    try {
      const r = await api<{ chargeId: string; sent: number; failed: { family: string; error: string }[] }>("/api/charges", { rules: preview.rules, message, clientKey: sendKey.current });
      if (r.failed.length) setError(`${r.failed.length} invoice(s) did not send: ${r.failed.map((f) => `${f.family} (${f.error})`).join("; ")}`);
      onCreated(r.chargeId, r.sent);
      if (!r.failed.length) {
        setPreview(null);
        setMessage("");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      sending.current = false;
      setPhase("idle");
    }
  }

  const rules = preview?.rules;
  const alloc = preview?.allocation;
  const billable = preview?.invoices.length ?? 0;
  const invoicedTotal = preview?.invoices.reduce((a, i) => a + i.amountCents, 0) ?? 0;
  const stated = rules ? (rules.amountKind === "team_total" ? rules.amountCents : null) : null;
  // Every cent accounted for: invoiced + already paid + team-covered = total (+ rounding to the team fund).
  const accounted = invoicedTotal + (alloc?.prepaidCents ?? 0) + (alloc?.absorbedCents ?? 0);
  const addsUp = alloc ? invoicedTotal === alloc.invoicedCents && accounted === alloc.totalCents + alloc.surplusCents && (stated === null || alloc.totalCents === stated + alloc.roundingCents) : true;
  // Fairness check: flag any invoice far above a normal share, and any participating family billed nothing.
  const fairness: string[] = [];
  if (preview && alloc) {
    const perUnit = alloc.perUnitCents ?? 0;
    for (const inv of preview.invoices) {
      const f = fam(inv.payerFamilyId);
      const normal = perUnit * (rules?.amountKind === "per_family" || rules?.splitBasis === "family" ? 1 : f.players.length);
      if (normal > 0 && inv.amountCents > normal * 1.5 && inv.items.length === 1) fairness.push(`The ${f.surname} family is billed ${money(inv.amountCents)}, much more than a normal ${money(normal)} share. Is that right?`);
    }
    for (const l of alloc.lines) {
      const billed = preview.invoices.some((i) => i.payerFamilyId === l.familyId) || alloc.prepaid.some((p) => p.familyId === l.familyId);
      if (l.reason === "share" && l.payerFamilyId === l.familyId && !billed && (alloc.shareCents[l.familyId] ?? 0) === 0 && (rules?.amountCents ?? 0) > 0) fairness.push(`The ${fam(l.familyId).surname} family isn't billed anything. Check the message.`);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {!preview && (
        <>
          <label htmlFor="coach-message" className="flex items-center gap-2 text-sm text-chalk-dim">
            <MessageSquareText size={16} className="text-led" /> Paste the message from the team group chat
          </label>
          <textarea
            id="coach-message"
            className="field min-h-36 resize-y leading-relaxed"
            placeholder='e.g. "Fresno tournament is $450 for the team, split it, the Garcias are covering the Nguyens, Mia is on scholarship"'
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={4000}
          />
          <div className="flex flex-wrap gap-2">
            {SAMPLES.map((s, i) => (
              <button key={i} type="button" className="rounded-full border border-chalk/15 px-3 py-1.5 text-left text-xs text-chalk-dim transition hover:border-led/50 hover:text-chalk" onClick={() => setMessage(s)}>
                Try: “{s.slice(0, 38)}…”
              </button>
            ))}
          </div>
          <button className="btn btn-primary w-full" disabled={phase !== "idle" || message.trim().length < 8 || !data.ai} onClick={read}>
            {phase === "reading" ? <Spinner /> : <Sparkles size={16} />}
            {phase === "reading" ? "Reading the message…" : "Read it with AI"}
          </button>
          {!data.ai && <p className="text-sm text-coral-soft">Set OPENAI_API_KEY to turn on the AI treasurer.</p>}
        </>
      )}

      {preview && rules && (
        <div className="rise flex flex-col gap-4">
          {!preview.isMoneyRequest && (
            <div className="flex gap-2 rounded-lg border border-coral/40 bg-coral/10 p-3 text-sm text-coral-soft">
              <AlertTriangle size={18} className="shrink-0" /> That message doesn&apos;t look like it asks families for money. Check the numbers below before sending anything.
            </div>
          )}
          <div className="rounded-lg border border-chalk/10 bg-night-950/60 p-3 text-sm italic text-chalk-dim">“{message}”</div>
          <div>
            <div className="label mb-2">What Sideline understood</div>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-display text-2xl font-semibold uppercase">{rules.title}</span>
                <span className="led text-led-bright">
                  {money(rules.amountCents)} {rules.amountKind === "team_total" ? `for the team, split per ${rules.splitBasis}` : rules.amountKind === "per_family" ? "per family" : "per player"}
                </span>
                <span className="text-sm text-chalk-faint">{dueLabel(rules.dueDate)}</span>
              </div>
              <ul className="mt-1 flex flex-col gap-1">
                {rules.notes.map((n, i) => (
                  <li key={i} className="flex gap-2 text-sm text-chalk">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-turf" /> {n}
                  </li>
                ))}
                {[...fairness, ...rules.ambiguities, ...preview.allocation.warnings].map((n, i) => (
                  <li key={`w${i}`} className="flex gap-2 text-sm text-led-bright">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {n}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <div className="label">{billable} PayPal invoices</div>
              <div className={`text-right text-xs ${addsUp ? "text-turf-bright" : "text-coral-soft"}`}>
                {money(invoicedTotal)} invoiced
                {alloc!.prepaidCents > 0 && ` + ${money(alloc!.prepaidCents)} already paid`}
                {alloc!.absorbedCents > 0 && ` + ${money(alloc!.absorbedCents)} team-covered`}
                {alloc!.surplusCents > 0 && ` − ${money(alloc!.surplusCents)} extra chipped in`}
                {` = ${money(alloc!.totalCents - alloc!.roundingCents)}`}
                {alloc!.roundingCents > 0 && ` + ${alloc!.roundingCents}¢`} {addsUp ? "✓" : "✗"}
                {alloc!.roundingCents > 0 && <span className="block text-chalk-faint">{alloc!.roundingCents}¢ of rounding goes to the team fund so everyone pays the same {money(alloc!.perUnitCents ?? 0)}</span>}
              </div>
            </div>
            <ul className="max-h-80 divide-y divide-chalk/5 overflow-y-auto rounded-lg border border-chalk/10">
              {preview.invoices.map((inv) => {
                const f = fam(inv.payerFamilyId);
                return (
                  <li key={inv.payerFamilyId} className="flex items-center gap-3 px-3 py-2">
                    <Avatar name={f.guardian} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{f.surname}</div>
                      {inv.items.length > 1 && <div className="truncate text-xs text-sky">{inv.items.slice(1).map((i) => i.description).join(", ")}</div>}
                    </div>
                    <span className="text-right">
                      <span className="led block text-sm font-semibold">{money(inv.amountCents)}</span>
                      {inv.prepaidCents > 0 && <span className="block text-[0.7rem] text-turf-bright">{money(inv.prepaidCents)} already paid</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex flex-col-reverse gap-2">
            <button className="btn btn-ghost" disabled={phase !== "idle"} onClick={() => setPreview(null)}>
              <Undo2 size={16} /> Edit message
            </button>
            <button className="btn btn-turf" disabled={phase !== "idle" || billable === 0 || !addsUp} onClick={send} title={addsUp ? undefined : "The amounts don't add up; edit the message first"}>
              {phase === "sending" ? <Spinner /> : <Send size={16} />}
              {phase === "sending" ? `Creating ${billable} PayPal invoices…` : `Send ${billable} PayPal invoices`}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div role="alert" className="flex gap-2 rounded-lg border border-coral/40 bg-coral/10 p-3 text-sm text-coral-soft">
          <AlertTriangle size={18} className="shrink-0" /> {error}
        </div>
      )}
    </div>
  );
}
