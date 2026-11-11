import { ok, fail } from "@/lib/http";
import { resetState } from "@/lib/store";
import { publishSeedInvoices, rehydrateAll } from "@/lib/sideline";
import { simulator } from "@/lib/paypal";

export async function POST() {
  try {
    await resetState();
    simulator()?.reset();
    rehydrateAll();
    await publishSeedInvoices();
    return ok({ ok: true });
  } catch (e) {
    return fail(e, 500);
  }
}
