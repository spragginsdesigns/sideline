import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { readState } from "@/lib/store";
import { gateway } from "@/lib/paypal";
import { formatCents } from "@/lib/money";
import { isLate } from "@/lib/summary";
import { LANGUAGE_NAMES } from "@/lib/types";
import { Logo } from "@/components/TopBar";
import { PayButton } from "./PayButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ invoiceId: string }> }): Promise<Metadata> {
  const { invoiceId } = await params;
  const state = readState();
  const inv = state.invoices.find((i) => i.id === invoiceId);
  const charge = inv && state.charges.find((c) => c.id === inv.chargeId);
  return { title: charge ? `${charge.title} · ${state.team.name}` : "Sideline", robots: { index: false } };
}

export default async function PayPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const state = readState();
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) notFound();
  const charge = state.charges.find((c) => c.id === inv.chargeId)!;
  const fam = state.team.families.find((f) => f.id === inv.payerFamilyId)!;
  const first = fam.guardian.split(" ")[0];
  const late = isLate(inv, charge);
  const lastNudge = inv.reminders.at(-1);
  const mode = gateway().mode;
  const payHref = mode === "live" ? inv.payerViewUrl : inv.paypalInvoiceId ? `/sandbox-checkout/${encodeURIComponent(inv.paypalInvoiceId)}` : null;

  return (
    <div className="pitch min-h-dvh">
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <div className="flex items-center justify-between">
          <Logo />
          <span className="text-xs text-chalk-faint">{state.team.city}</span>
        </div>

        <section className="card overflow-hidden">
          <div className="border-b border-chalk/10 bg-gradient-to-br from-led/15 via-transparent to-transparent px-5 py-5">
            <div className="label !text-led-bright">{state.team.name}</div>
            <h1 className="mt-1 font-display text-3xl font-semibold uppercase leading-tight">Hi {first}!</h1>
            <p className="mt-1 text-chalk-dim">
              Here&apos;s the {fam.surname} family&apos;s share for <span className="text-chalk">{charge.title}</span>.
            </p>
          </div>

          <ul className="divide-y divide-chalk/8 px-5">
            {inv.items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <div className="font-semibold">{it.description}</div>
                  <div className="text-sm text-chalk-faint">{it.name.split(": ").slice(1).join(": ")}</div>
                </div>
                <span className="led shrink-0 font-semibold">{formatCents(it.amountCents)}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-end justify-between border-t border-chalk/10 bg-night-950/40 px-5 py-4">
            <div>
              <div className="label">Total</div>
              <div className={`text-xs ${late ? "text-coral-soft" : "text-chalk-faint"}`}>
                {inv.status === "PAID" ? `Paid ${new Date(inv.paidAt!).toLocaleDateString("en-US", { month: "short", day: "numeric" })} via ${inv.paidVia}` : charge.dueDate ? `${late ? "Was due" : "Due"} ${new Date(`${charge.dueDate}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "Whenever you can"}
              </div>
            </div>
            <div className={`led text-4xl font-bold ${inv.status === "PAID" ? "led-green" : "led-amber"}`}>{formatCents(inv.amountCents)}</div>
          </div>

          <div className="px-5 pt-1 pb-5">
            <PayButton status={inv.status} href={payHref} mode={mode} invoiceNumber={inv.paypalInvoiceNumber} qr={inv.qrCodeDataUrl} />
          </div>
        </section>

        {lastNudge && inv.status !== "PAID" && (
          <section className="card px-5 py-4">
            <div className="label mb-1.5">
              Message from {state.team.treasurer.split(" ")[0]} · {LANGUAGE_NAMES[lastNudge.language]}
            </div>
            <p className="whitespace-pre-wrap leading-relaxed text-chalk">{lastNudge.message}</p>
          </section>
        )}

        <p className="px-2 text-center text-xs leading-relaxed text-chalk-faint">
          Payments go to the team through PayPal. Pay with your PayPal balance, Venmo, or a card. Want to see where the team&apos;s money goes?{" "}
          <a className="text-sky underline-offset-2 hover:underline" href="/report">
            Open the season report
          </a>
          .
        </p>
      </main>
    </div>
  );
}
