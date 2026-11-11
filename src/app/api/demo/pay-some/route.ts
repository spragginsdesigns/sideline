// Simulator only: a few families pay, one at a time, the way a real evening goes.
import { ok, fail, body } from "@/lib/http";
import { readState } from "@/lib/store";
import { simulatePayment } from "@/lib/sideline";
import { simulator } from "@/lib/paypal";

export async function POST(req: Request) {
  try {
    if (!simulator()) throw new Error("Only available in simulator mode; with real PayPal, families pay through their PayPal link.");
    const b = await body<{ chargeId?: string; count?: number }>(req);
    const open = readState().invoices.filter((i) => i.status === "SENT" && (!b.chargeId || i.chargeId === b.chargeId));
    const n = Math.min(Math.max(1, b.count ?? 3), open.length);
    const picks = open.slice(0, n);
    picks.forEach((inv, k) => {
      setTimeout(() => void simulatePayment(inv.id, k % 4 === 3 ? "VENMO" : "PAYPAL").catch(() => undefined), 900 * k);
    });
    return ok({ scheduled: picks.length });
  } catch (e) {
    return fail(e);
  }
}
