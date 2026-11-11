import { notFound } from "next/navigation";
import { readState } from "@/lib/store";
import { formatCents } from "@/lib/money";
import { CheckoutButtons } from "./CheckoutButtons";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sandbox checkout (simulated)", robots: { index: false } };

// Stand-in for PayPal's hosted invoice page when the app runs without PayPal
// keys. With keys, families go to the real PayPal invoice page instead.
export default async function SandboxCheckout({ params }: { params: Promise<{ paypalId: string }> }) {
  const { paypalId } = await params;
  const id = decodeURIComponent(paypalId);
  const state = readState();
  const inv = state.invoices.find((i) => i.paypalInvoiceId === id);
  if (!inv) notFound();
  const fam = state.team.families.find((f) => f.id === inv.payerFamilyId)!;

  return (
    <div className="min-h-dvh bg-[#f5f7fa] text-[#1a1f36]">
      <div className="bg-[#1a1f36] px-4 py-2 text-center text-xs font-medium text-amber-300">
        Sandbox simulator · no real money moves · in production this is PayPal&apos;s own checkout
      </div>
      <main className="mx-auto max-w-md px-4 py-8">
        <div className="rounded-2xl bg-white p-6 shadow-[0_10px_40px_-12px_rgba(0,0,0,0.25)]">
          <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">Invoice {inv.paypalInvoiceNumber}</div>
          <div className="mt-1 text-lg font-semibold">{state.team.name}</div>
          <div className="text-sm text-slate-500">Billed to {fam.guardian} · {fam.email}</div>
          <ul className="mt-5 divide-y divide-slate-100 border-y border-slate-100">
            {inv.items.map((it, i) => (
              <li key={i} className="flex justify-between gap-4 py-3 text-sm">
                <span>{it.name}</span>
                <span className="font-mono font-semibold">{formatCents(it.amountCents)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-sm text-slate-500">Amount due</span>
            <span className="font-mono text-3xl font-bold">{formatCents(inv.status === "PAID" ? 0 : inv.amountCents)}</span>
          </div>
          <CheckoutButtons paypalInvoiceId={id} returnTo={`/pay/${inv.id}`} paid={inv.status === "PAID"} />
        </div>
      </main>
    </div>
  );
}
