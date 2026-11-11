import { ok, fail, body } from "@/lib/http";
import { createCharge } from "@/lib/sideline";
import { maxCharges } from "@/lib/demoGuard";
import { readState } from "@/lib/store";
import type { ChargeRules } from "@/lib/ledger/allocate";

export async function POST(req: Request) {
  try {
    const b = await body<{ rules: ChargeRules; message: string; clientKey?: string }>(req);
    if (!b.rules) throw new Error("Missing rules");
    const cap = maxCharges();
    if (cap && readState().charges.length >= cap) throw new Error("This shared demo team is full. Use \"Reset demo team\" to start fresh.");
    return ok(await createCharge(b.rules, String(b.message ?? ""), typeof b.clientKey === "string" ? b.clientKey : undefined));
  } catch (e) {
    return fail(e);
  }
}
