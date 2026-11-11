// The JSON the dashboard polls. Computed server-side so the client stays thin.
import { readState } from "./store.ts";
import { gateway } from "./paypal/index.ts";
import { aiConfigured } from "./config.ts";
import { chargeStats, isLate, teamSummary, daysLate } from "./summary.ts";

export function dashboardView() {
  const state = readState();
  const gw = gateway();
  const charges = [...state.charges].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    mode: gw.mode,
    environment: gw.environment,
    ai: aiConfigured(),
    team: state.team,
    summary: teamSummary(state),
    charges: charges.map((c) => ({ ...c, stats: chargeStats(state, c) })),
    invoices: state.invoices.map((i) => {
      const c = state.charges.find((x) => x.id === i.chargeId);
      const late = isLate(i, c);
      return { ...i, qrCodeDataUrl: undefined, late, daysLate: late ? daysLate(c) : 0 };
    }),
    games: state.games,
    events: [...state.events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 60),
    serverTime: new Date().toISOString(),
  };
}

export type DashboardView = ReturnType<typeof dashboardView>;
