import { ok, fail, body } from "@/lib/http";
import { buildPreview, previewCharge } from "@/lib/sideline";
import type { ChargeRules } from "@/lib/ledger/allocate";

export async function POST(req: Request) {
  try {
    const b = await body<{ message?: string; rules?: ChargeRules }>(req);
    if (b.rules) return ok(buildPreview(b.rules));
    const message = (b.message ?? "").trim();
    if (message.length < 8) throw new Error("Paste the message from the group chat first.");
    return ok(await previewCharge(message));
  } catch (e) {
    return fail(e);
  }
}
