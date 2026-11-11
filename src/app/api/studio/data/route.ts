import { ok, fail } from "@/lib/http";
import { readState } from "@/lib/store";
import { gateway } from "@/lib/paypal";
import { ensureFresh } from "@/lib/fresh";
import { studioTables } from "@/lib/studio/tables";

export const dynamic = "force-dynamic";

/** The rows AG Studio reads: dues per family, the ledger, and games. Polled so payments show up live. */
export async function GET() {
  try {
    await ensureFresh();
    return ok(studioTables(readState(), gateway().mode));
  } catch (e) {
    return fail(e, 500);
  }
}
