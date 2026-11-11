import type { AppState, Charge, Invoice } from "./types.ts";

export const DAY_MS = 86_400_000;

export function balanceCents(state: AppState): number {
  return state.events.reduce((a, e) => a + e.amountCents, 0);
}

/** Today's date where the team plays (YYYY-MM-DD), so "late" flips at the team's midnight, not the server's. */
export function teamToday(now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.SIDELINE_TIMEZONE || "America/Los_Angeles" }).format(new Date(now));
}

export function isLate(inv: Invoice, charge: Charge | undefined, now = Date.now()): boolean {
  if (inv.status !== "SENT" || !charge?.dueDate) return false;
  return teamToday(now) > charge.dueDate;
}

export function daysLate(charge: Charge | undefined, now = Date.now()): number {
  if (!charge?.dueDate) return 0;
  const days = Math.round((Date.parse(`${teamToday(now)}T00:00:00Z`) - Date.parse(`${charge.dueDate}T00:00:00Z`)) / DAY_MS);
  return Math.max(0, days);
}

export interface ChargeStats {
  chargeId: string;
  title: string;
  dueDate: string | null;
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  absorbedCents: number;
  prepaidCents: number;
  invoices: number;
  paid: number;
  late: number;
}

export function chargeStats(state: AppState, charge: Charge, now = Date.now()): ChargeStats {
  const invs = state.invoices.filter((i) => i.chargeId === charge.id && i.status !== "CANCELLED");
  const paid = invs.filter((i) => i.status === "PAID");
  const prepaidCents = (charge.prepaid ?? []).reduce((a, p) => a + p.amountCents, 0);
  return {
    chargeId: charge.id,
    title: charge.title,
    dueDate: charge.dueDate,
    billedCents: invs.reduce((a, i) => a + i.amountCents, 0) + prepaidCents,
    collectedCents: paid.reduce((a, i) => a + i.amountCents, 0) + prepaidCents,
    prepaidCents,
    outstandingCents: invs.filter((i) => i.status === "SENT" || i.status === "DRAFT").reduce((a, i) => a + i.amountCents, 0),
    absorbedCents: charge.absorbedCents,
    invoices: invs.length,
    paid: paid.length,
    late: invs.filter((i) => isLate(i, charge, now)).length,
  };
}

export function teamSummary(state: AppState, now = Date.now()) {
  const stats = state.charges.map((c) => chargeStats(state, c, now));
  const moneyIn = state.events.filter((e) => e.amountCents > 0 && e.type !== "opening.balance").reduce((a, e) => a + e.amountCents, 0);
  const moneyOut = state.events.filter((e) => e.amountCents < 0).reduce((a, e) => a - e.amountCents, 0);
  const opening = state.events.filter((e) => e.type === "opening.balance").reduce((a, e) => a + e.amountCents, 0);
  return {
    balanceCents: balanceCents(state),
    openingCents: opening,
    moneyInCents: moneyIn,
    moneyOutCents: moneyOut,
    outstandingCents: stats.reduce((a, s) => a + s.outstandingCents, 0),
    absorbedCents: stats.reduce((a, s) => a + s.absorbedCents, 0),
    pendingPayoutCents: state.games.filter((g) => g.payout?.status === "PENDING").reduce((a, g) => a + (g.payout?.amountCents ?? 0), 0),
    charges: stats,
  };
}
