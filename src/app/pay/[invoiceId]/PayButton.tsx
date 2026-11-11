"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, QrCode } from "lucide-react";

export function PayButton({
  status,
  href,
  mode,
  invoiceNumber,
  qr,
  labels,
}: {
  status: string;
  href: string | null;
  mode: "live" | "simulator";
  invoiceNumber: string | null;
  qr: string | null;
  labels: { payWith: string; thanks: string; seen: string; showQr: string; hideQr: string };
}) {
  const router = useRouter();
  const [showQr, setShowQr] = useState(false);

  // When the family comes back from checkout, pick up the webhook-driven status.
  useEffect(() => {
    if (status === "PAID") return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [status, router]);

  if (status === "PAID") {
    return (
      <div className="rise flex flex-col items-center gap-2 rounded-xl border border-turf/40 bg-turf/10 px-4 py-5 text-center">
        <CheckCircle2 className="text-turf-bright" size={36} />
        <div className="font-display text-xl font-semibold uppercase tracking-wide text-turf-bright">{labels.thanks}</div>
        <div className="text-sm text-chalk-dim">{labels.seen}</div>
      </div>
    );
  }
  if (status !== "SENT" || !href) return <div className="mt-4 text-center text-sm text-chalk-faint">This invoice isn&apos;t open for payment.</div>;

  return (
    <div className="mt-4 flex flex-col gap-3">
      <a href={href} className="btn !min-h-14 w-full !rounded-full !bg-[#ffc439] !text-base !normal-case !tracking-normal !text-[#111] hover:!bg-[#f2ba36]" rel="noreferrer">
        {labels.payWith} <span className="font-sans text-lg font-extrabold italic"><span className="text-[#003087]">Pay</span><span className="text-[#009cde]">Pal</span></span>
      </a>
      <div className="flex items-center justify-between text-xs text-chalk-faint">
        <span>
          Invoice {invoiceNumber}
          {mode === "simulator" && " · sandbox simulator"}
        </span>
        {qr && (
          <button className="flex items-center gap-1 text-sky hover:underline" onClick={() => setShowQr((s) => !s)}>
            <QrCode size={14} /> {showQr ? labels.hideQr : labels.showQr}
          </button>
        )}
      </div>
      {showQr && qr && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={qr} alt="QR code that opens this PayPal invoice" className="rise mx-auto w-52 rounded-lg bg-white p-2" />
      )}
    </div>
  );
}
