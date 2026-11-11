import { ok, fail } from "@/lib/http";
import { readState } from "@/lib/store";
import { gateway } from "@/lib/paypal";
import { studioTables } from "@/lib/studio/tables";

export const dynamic = "force-dynamic";

/** The rows AG Studio reads: dues per family, the ledger, and games. Polled so webhooks show up live. */
export async function GET() {
  try {
    return ok(studioTables(readState(), gateway().mode));
  } catch (e) {
    return fail(e, 500);
  }
}
