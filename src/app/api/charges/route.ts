import { ok, fail, body } from "@/lib/http";
import { createCharge } from "@/lib/sideline";
import type { ChargeRules } from "@/lib/ledger/allocate";

export async function POST(req: Request) {
  try {
    const b = await body<{ rules: ChargeRules; message: string; clientKey?: string }>(req);
    if (!b.rules) throw new Error("Missing rules");
    return ok(await createCharge(b.rules, String(b.message ?? ""), typeof b.clientKey === "string" ? b.clientKey : undefined));
  } catch (e) {
    return fail(e);
  }
}
