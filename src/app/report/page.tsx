import type { Metadata } from "next";
import { readState } from "@/lib/store";
import { teamSummary } from "@/lib/summary";
import { formatCents } from "@/lib/money";
import { TopBar } from "@/components/TopBar";
import { ReportCharts, type ReportRow } from "./ReportCharts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Season report · Sideline" };

function category(type: string, summary: string): string {
  if (type === "opening.balance") return "Carried over";
  if (type === "invoice.paid" || type === "payment.offline") return "Family dues";
  if (type === "payout.succeeded" || type === "payout.unclaimed") return "Referees";
  if (summary.startsWith("Scholarship")) return "Scholarships";
  if (/uniform/i.test(summary)) return "Uniforms";
  if (/league|registration/i.test(summary)) return "League fees";
  return "Other";
}

export default function ReportPage() {
  const state = readState();
  const s = teamSummary(state);
  // Public page: who paid how much is private to the treasurer, so family payments are
  // rolled up per charge per day ("Fresno Tournament: 4 family payments"). Never emails.
  const chargeOf = (ref: string | null) => state.charges.find((c) => c.id === ref || state.invoices.some((i) => i.id === ref && i.chargeId === c.id));
  const rolled = new Map<string, ReportRow & { n: number }>();
  const rows: ReportRow[] = [];
  for (const e of [...state.events].filter((e) => e.amountCents !== 0).sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.type === "invoice.paid" || e.type === "payment.offline") {
      const charge = chargeOf(e.ref);
      const key = `${charge?.id ?? "other"}|${e.at.slice(0, 10)}`;
      const r = rolled.get(key);
      if (r) {
        r.cents += e.amountCents;
        r.n += 1;
        r.what = `${charge?.title ?? "Team dues"}: ${r.n} family payments`;
      } else {
        const row = { date: e.at, what: `${charge?.title ?? "Team dues"}: 1 family payment`, category: "Family dues", cents: e.amountCents, viaPayPal: e.type === "invoice.paid", n: 1 };
        rolled.set(key, row);
        rows.push(row);
      }
      continue;
    }
    rows.push({ date: e.at, what: e.summary, category: category(e.type, e.summary), cents: e.amountCents, viaPayPal: e.source.startsWith("paypal") || e.type === "payout.succeeded" || e.type === "payout.unclaimed" });
  }

  const byCategory = new Map<string, number>();
  for (const r of rows) if (r.cents < 0) byCategory.set(r.category, (byCategory.get(r.category) ?? 0) - r.cents);
  const outBreakdown = [...byCategory.entries()].map(([category, cents]) => ({ category, cents })).sort((a, b) => b.cents - a.cents);

  return (
    <div className="pitch min-h-dvh pb-16">
      <TopBar data={null} active="report" />
      <main className="mx-auto flex max-w-5xl flex-col gap-5 px-4 py-8 sm:px-6">
        <header>
          <div className="label !text-led-bright">
            {state.team.season} season report · {state.team.city}
          </div>
          <h1 className="mt-1 font-display text-4xl font-bold uppercase leading-none tracking-wide sm:text-5xl">{state.team.name}</h1>
          <p className="mt-3 max-w-2xl text-chalk-dim">
            Every dollar in and out of the team account this season, for every family to see. Payments and referee payouts are recorded straight from PayPal.
          </p>
        </header>

        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-chalk/10 bg-chalk/[0.06] sm:grid-cols-4">
          {[
            { label: "Carried over", value: formatCents(s.openingCents), tone: "text-chalk" },
            { label: "Money in", value: formatCents(s.moneyInCents), tone: "led-green" },
            { label: "Money out", value: formatCents(s.moneyOutCents), tone: "led-coral" },
            { label: "In the bank", value: formatCents(s.balanceCents), tone: "led-amber" },
          ].map((t) => (
            <div key={t.label} className="bg-night-850 px-4 py-5">
              <div className="label">{t.label}</div>
              <div className={`led mt-1 text-2xl font-bold sm:text-3xl ${t.tone}`}>{t.value}</div>
            </div>
          ))}
        </section>

        <ReportCharts rows={rows} outBreakdown={outBreakdown} />

        <section className="card p-5">
          <h2 className="font-display text-xl font-semibold uppercase tracking-wide">What each charge collected</h2>
          <ul className="mt-3 divide-y divide-chalk/8">
            {s.charges.map((c) => (
              <li key={c.chargeId} className="flex flex-wrap items-baseline justify-between gap-2 py-3">
                <span className="font-semibold">{c.title}</span>
                <span className="text-sm text-chalk-dim">
                  <span className="led text-turf-bright">{formatCents(c.collectedCents)}</span> of {formatCents(c.billedCents)} · {c.paid} of {c.invoices} families paid
                  {c.absorbedCents > 0 && ` · ${formatCents(c.absorbedCents)} scholarship covered by the team`}
                </span>
              </li>
            ))}
          </ul>
        </section>
        <p className="text-center text-xs text-chalk-faint">Generated by Sideline from the team&apos;s PayPal activity · {new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}</p>
      </main>
    </div>
  );
}
