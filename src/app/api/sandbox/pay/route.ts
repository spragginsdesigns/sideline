import { ok, fail, body } from "@/lib/http";
import { simulatePayment, simulatePaymentByPayPalId } from "@/lib/sideline";

export async function POST(req: Request) {
  try {
    const b = await body<{ invoiceId?: string; paypalInvoiceId?: string; method?: string }>(req);
    const method = b.method === "VENMO" ? "VENMO" : b.method === "CARD" ? "CARD" : "PAYPAL";
    if (b.paypalInvoiceId) await simulatePaymentByPayPalId(b.paypalInvoiceId, method);
    else if (b.invoiceId) await simulatePayment(b.invoiceId, method);
    else throw new Error("Missing invoice");
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
