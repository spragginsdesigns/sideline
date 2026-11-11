import { dashboardView } from "@/lib/view";
import { ok, fail } from "@/lib/http";
import { publishSeedInvoices, rehydrateAll, syncFromPayPal } from "@/lib/sideline";
import { gateway, simulator } from "@/lib/paypal";
import { idleExpired } from "@/lib/demoGuard";
import { resetState } from "@/lib/store";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __sidelineLastSync?: number; __sidelineBoot?: Promise<unknown> };

export async function GET() {
  try {
    g.__sidelineBoot ??= (async () => {
      rehydrateAll();
      await publishSeedInvoices();
    })();
    await g.__sidelineBoot;
    // Public demo: after a long idle stretch the next visitor gets a fresh team (simulator mode only).
    if (simulator() && idleExpired()) {
      await resetState();
      simulator()?.reset();
      rehydrateAll();
      await publishSeedInvoices();
    }
    if (gateway().mode === "live" && Date.now() - (g.__sidelineLastSync ?? 0) > 10_000) {
      g.__sidelineLastSync = Date.now();
      await syncFromPayPal();
    }
    return ok(dashboardView());
  } catch (e) {
    return fail(e, 500);
  }
}
