import type { AppState, Charge, Invoice } from "./types.ts";

export const DAY_MS = 86_400_000;

export function balanceCents(state: AppState): number {
  return state.events.reduce((a, e) => a + e.amountCents, 0);
}

export function isLate(inv: Invoice, charge: Charge | undefined, now = Date.now()): boolean {
  if (inv.status !== "SENT" || !charge?.dueDate) return false;
  return new Date(`${charge.dueDate}T23:59:59`).getTime() < now;
}

export function daysLate(charge: Charge | undefined, now = Date.now()): number {
  if (!charge?.dueDate) return 0;
  return Math.max(0, Math.floor((now - new Date(`${charge.dueDate}T23:59:59`).getTime()) / DAY_MS));
}

export interface ChargeStats {
  chargeId: string;
  title: string;
  dueDate: string | null;
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  absorbedCents: number;
  invoices: number;
  paid: number;
  late: number;
}

export function chargeStats(state: AppState, charge: Charge, now = Date.now()): ChargeStats {
  const invs = state.invoices.filter((i) => i.chargeId === charge.id && i.status !== "CANCELLED");
  const paid = invs.filter((i) => i.status === "PAID");
  return {
    chargeId: charge.id,
    title: charge.title,
    dueDate: charge.dueDate,
    billedCents: invs.reduce((a, i) => a + i.amountCents, 0),
    collectedCents: paid.reduce((a, i) => a + i.amountCents, 0),
    outstandingCents: invs.filter((i) => i.status === "SENT").reduce((a, i) => a + i.amountCents, 0),
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
