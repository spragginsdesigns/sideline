import { dashboardView } from "@/lib/view";
import { ok, fail } from "@/lib/http";
import { publishSeedInvoices, rehydrateAll, syncFromPayPal } from "@/lib/sideline";
import { gateway } from "@/lib/paypal";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __sidelineLastSync?: number; __sidelineBoot?: Promise<unknown> };

export async function GET() {
  try {
    g.__sidelineBoot ??= (async () => {
      rehydrateAll();
      await publishSeedInvoices();
    })();
    await g.__sidelineBoot;
    if (gateway().mode === "live" && Date.now() - (g.__sidelineLastSync ?? 0) > 10_000) {
      g.__sidelineLastSync = Date.now();
      await syncFromPayPal();
    }
    return ok(dashboardView());
  } catch (e) {
    return fail(e, 500);
  }
}
