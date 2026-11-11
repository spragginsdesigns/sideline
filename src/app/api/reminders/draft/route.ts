import { ok, fail, body } from "@/lib/http";
import { draftReminders, lateInvoices } from "@/lib/sideline";
import { chargeAi } from "@/lib/demoGuard";

export async function POST(req: Request) {
  try {
    const b = await body<{ invoiceIds?: string[] }>(req);
    // One model call per family being nudged.
    chargeAi(req, Math.max(1, Math.min(14, b.invoiceIds?.length || lateInvoices().length)));
    return ok({ nudges: await draftReminders(b.invoiceIds) });
  } catch (e) {
    return fail(e);
  }
}
