"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { BellRing, PlayCircle, RotateCcw } from "lucide-react";
import { useDashboard, api } from "@/hooks/useDashboard";
import { TopBar, ModeBadge } from "@/components/TopBar";
import { Scoreboard } from "@/components/Scoreboard";
import { FamilyBoard } from "@/components/FamilyBoard";
import { ChargeComposer } from "@/components/ChargeComposer";
import { Games } from "@/components/Games";
import { Activity } from "@/components/Activity";
import { NudgeDialog } from "@/components/NudgeDialog";
import { AskTreasurer } from "@/components/AskTreasurer";
import { Section, Spinner, Toasts, dueLabel } from "@/components/ui";

export default function BoardPage() {
  const { data, error, refresh, toasts, pushToast, freshlyPaid } = useDashboard();
  const [chargeId, setChargeId] = useState<string | null>(null);
  const [nudgeFor, setNudgeFor] = useState<string[] | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  // Default to the newest charge. A charge just created may not be in the last poll yet, so
  // only fall back when nothing is selected (never fight a fresh selection).
  useEffect(() => {
    if (data && !chargeId) setChargeId(data.charges[0]?.id ?? null);
  }, [data, chargeId]);

  const charge = useMemo(() => data?.charges.find((c) => c.id === chargeId) ?? data?.charges[0] ?? null, [data, chargeId]);
  const lateHere = useMemo(() => (data && charge ? data.invoices.filter((i) => i.chargeId === charge.id && i.late) : []), [data, charge]);
  const openHere = useMemo(() => (data && charge ? data.invoices.filter((i) => i.chargeId === charge.id && i.status === "SENT") : []), [data, charge]);

  const onNudge = useCallback((ids: string[]) => setNudgeFor(ids), []);
  const onError = useCallback((m: string) => pushToast({ tone: "coral", title: "Something went wrong", body: m }), [pushToast]);

  if (!data) {
    return (
      <div className="pitch flex min-h-dvh items-center justify-center text-chalk-dim">
        {error ? <span className="text-coral-soft">Couldn&apos;t load the board: {error}</span> : <Spinner className="h-6 w-6" />}
      </div>
    );
  }

  async function simulatePayments() {
    if (!charge) return;
    setDemoBusy(true);
    try {
      await api("/api/demo/pay-some", { chargeId: charge.id, count: Math.max(1, Math.ceil(openHere.length * 0.6)) });
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setTimeout(() => setDemoBusy(false), 1500);
    }
  }

  async function resetDemo() {
    if (!confirm("Reset the demo team to its starting state?")) return;
    await api("/api/demo/reset");
    setChargeId(null);
    await refresh();
  }

  return (
    <div className="pitch min-h-dvh pb-28">
      <TopBar data={data} active="board" />
      {data.mode === "simulator" && (
        <div className="border-b border-led/20 bg-led/[0.07] px-4 py-2 text-center text-xs text-led-bright sm:text-sm">
          Demo mode: no PayPal keys are set, so PayPal responses and webhooks are simulated on this server. Add sandbox keys and every button talks to the real PayPal API.
        </div>
      )}
      <main className="mx-auto flex max-w-[1500px] flex-col gap-4 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6">
        <div className="sm:hidden">
          <ModeBadge mode={data.mode} environment={data.environment} />
        </div>
        <Scoreboard data={data} charge={charge} />

        <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="order-2 flex min-w-0 flex-col gap-4 sm:gap-5 xl:order-1">
            <Section
              title="The board"
              kicker={charge ? `${dueLabel(charge.dueDate)} · ${charge.stats.paid} of ${charge.stats.invoices} paid` : undefined}
              action={
                <div className="flex flex-wrap gap-2">
                  {data.mode === "simulator" && openHere.length > 0 && (
                    <button className="btn btn-ghost" onClick={simulatePayments} disabled={demoBusy} title="Demo: some families pay through the simulated PayPal checkout">
                      {demoBusy ? <Spinner /> : <PlayCircle size={16} />} Families pay
                    </button>
                  )}
                  <button className="btn btn-primary" disabled={openHere.length === 0 || !data.ai} onClick={() => setNudgeFor((lateHere.length ? lateHere : openHere).map((i) => i.id))}>
                    <BellRing size={16} /> Nudge {lateHere.length ? `${lateHere.length} late` : `${openHere.length} unpaid`}
                  </button>
                </div>
              }
            >
              {data.charges.length > 1 && (
                <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Charges">
                  {data.charges.map((c) => (
                    <button
                      key={c.id}
                      role="tab"
                      aria-selected={c.id === charge?.id}
                      onClick={() => setChargeId(c.id)}
                      className={clsx(
                        "shrink-0 rounded-lg border px-3 py-2 text-left transition",
                        c.id === charge?.id ? "border-led/60 bg-led/10" : "border-chalk/10 hover:border-chalk/25",
                      )}
                    >
                      <div className="text-sm font-semibold">{c.title}</div>
                      <div className="text-xs text-chalk-faint">
                        {c.stats.paid}/{c.stats.invoices} paid{c.stats.late ? ` · ${c.stats.late} late` : ""}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <FamilyBoard data={data} charge={charge} freshlyPaid={freshlyPaid} onNudge={onNudge} />
            </Section>

            <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
              <Section title="Games & refs" kicker="Refs are paid by PayPal Payouts when you mark a game final">
                <Games data={data} onError={onError} />
              </Section>
              <Section title="Live from PayPal" kicker="Every webhook and payout, as it lands" action={<span className="flex items-center gap-2 text-xs text-chalk-dim"><span className="dot-live" /> live</span>}>
                <Activity events={data.events} />
              </Section>
            </div>
          </div>

          <div className="order-1 flex flex-col gap-4 sm:gap-5 xl:order-2">
            <Section title="New charge" kicker="Group chat → PayPal invoices">
              <ChargeComposer
                data={data}
                onCreated={(id, sent) => {
                  setChargeId(id);
                  pushToast({ tone: "led", title: `${sent} PayPal invoices sent`, body: "Each family got an email with their PayPal link and QR code." });
                  void refresh();
                }}
              />
            </Section>
            {data.mode === "simulator" && (
              <button className="flex items-center justify-center gap-2 text-xs text-chalk-faint hover:text-chalk" onClick={resetDemo}>
                <RotateCcw size={13} /> Reset demo team
              </button>
            )}
          </div>
        </div>
      </main>

      {nudgeFor && (
        <NudgeDialog
          open
          data={data}
          invoiceIds={nudgeFor}
          onClose={() => setNudgeFor(null)}
          onSent={(n) => {
            if (n > 0) pushToast({ tone: "led", title: `${n} nudge${n === 1 ? "" : "s"} sent`, body: "Delivered as PayPal invoice reminders, each in the family's language." });
            void refresh();
          }}
        />
      )}
      <AskTreasurer enabled={data.ai} />
      <Toasts toasts={toasts} />
    </div>
  );
}
