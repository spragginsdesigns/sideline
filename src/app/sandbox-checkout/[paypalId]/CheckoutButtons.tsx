"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function CheckoutButtons({ paypalInvoiceId, returnTo, paid }: { paypalInvoiceId: string; returnTo: string; paid: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pay(method: "PAYPAL" | "VENMO" | "CARD") {
    setBusy(method);
    setError(null);
    try {
      const res = await fetch("/api/sandbox/pay", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ paypalInvoiceId, method }) });
      if (!res.ok) throw new Error((await res.json()).error ?? "Payment failed");
      router.push(returnTo);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  if (paid)
    return (
      <a href={returnTo} className="mt-6 block rounded-full bg-emerald-600 py-3.5 text-center font-semibold text-white">
        Already paid · back to the team
      </a>
    );

  return (
    <div className="mt-6 flex flex-col gap-3">
      <button onClick={() => pay("PAYPAL")} disabled={busy !== null} className="flex min-h-13 items-center justify-center gap-2 rounded-full bg-[#ffc439] py-3.5 text-base font-bold text-[#111] transition hover:bg-[#f2ba36] disabled:opacity-60">
        {busy === "PAYPAL" && <Loader2 className="animate-spin" size={18} />} Pay with PayPal balance
      </button>
      <button onClick={() => pay("VENMO")} disabled={busy !== null} className="flex min-h-13 items-center justify-center gap-2 rounded-full bg-[#008cff] py-3.5 text-base font-bold text-white transition hover:bg-[#0077d9] disabled:opacity-60">
        {busy === "VENMO" && <Loader2 className="animate-spin" size={18} />} Pay with Venmo
      </button>
      <button onClick={() => pay("CARD")} disabled={busy !== null} className="flex min-h-13 items-center justify-center gap-2 rounded-full border border-slate-300 bg-white py-3.5 text-base font-bold text-[#1a1f36] transition hover:bg-slate-50 disabled:opacity-60">
        {busy === "CARD" && <Loader2 className="animate-spin" size={18} />} Debit or credit card
      </button>
      {error && <p className="text-center text-sm text-red-600">{error}</p>}
    </div>
  );
}
