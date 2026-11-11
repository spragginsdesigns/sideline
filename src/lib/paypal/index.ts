import type { PayPalGateway } from "./gateway.ts";
import { createLiveGateway } from "./live.ts";
import { SimulatedPayPalGateway } from "./simulator.ts";
import { publicBaseUrl } from "../config.ts";
import { handlePayPalEvent } from "../webhooks.ts";

interface GatewayGlobal {
  __sidelineGateway?: PayPalGateway;
}
const g = globalThis as unknown as GatewayGlobal;

export function gateway(): PayPalGateway {
  if (!g.__sidelineGateway) {
    g.__sidelineGateway =
      createLiveGateway() ?? new SimulatedPayPalGateway((event) => handlePayPalEvent(event, "simulator").then(() => undefined), publicBaseUrl);
  }
  return g.__sidelineGateway;
}

export function simulator(): SimulatedPayPalGateway | null {
  const gw = gateway();
  return gw instanceof SimulatedPayPalGateway ? gw : null;
}
