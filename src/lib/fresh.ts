// What every data read needs first: the demo state rehydrated, a fresh team for the next visitor
// after a long idle stretch on a public demo, and (with real PayPal keys) open invoices checked
// against PayPal as a fallback for hosts that webhooks cannot reach.
import { gateway, simulator } from "./paypal/index.ts";
import { idleExpired } from "./demoGuard.ts";
import { resetState } from "./store.ts";
import { publishSeedInvoices, rehydrateAll, syncFromPayPal } from "./sideline.ts";

const g = globalThis as unknown as { __sidelineLastSync?: number; __sidelineBoot?: Promise<unknown> };

export async function ensureFresh(): Promise<void> {
  g.__sidelineBoot ??= (async () => {
    rehydrateAll();
    await publishSeedInvoices();
  })();
  await g.__sidelineBoot;
  // Public demo: after a long idle stretch the next visitor gets a fresh team. In live mode the
  // reset publishes the seeded open invoices to PayPal again as new invoices.
  if (idleExpired()) {
    await resetState();
    simulator()?.reset();
    rehydrateAll();
    await publishSeedInvoices();
  }
  // Fallback for when webhooks cannot reach the app (e.g. localhost). On a public URL the
  // signed webhook is the normal path, so SIDELINE_SYNC_SECONDS can be set much higher.
  const syncMs = (Number(process.env.SIDELINE_SYNC_SECONDS) || 10) * 1000;
  if (gateway().mode === "live" && Date.now() - (g.__sidelineLastSync ?? 0) > syncMs) {
    g.__sidelineLastSync = Date.now();
    await syncFromPayPal();
  }
}
