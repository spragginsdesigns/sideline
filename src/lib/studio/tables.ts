// The three tables AG Studio reads. Flat rows in dollars, built server-side from the same
// ledger the board uses, so the Studio dashboard and the board can never disagree.
import type { AppState } from "../types.ts";
import { LANGUAGE_NAMES } from "../types.ts";
import { daysLate, isLate } from "../summary.ts";

const dollars = (cents: number) => Math.round(cents) / 100;

export type DuesStatus = "Paid" | "Open" | "Late" | "Team fund";

/** One row per family per charge: what they owe, what they paid, and how. */
export interface DuesRow {
  id: string;
  family: string;
  guardian: string;
  language: string;
  players: string;
  jersey: string;
  charge: string;
  due_date: string | null;
  status: DuesStatus;
  billed: number;
  collected: number;
  outstanding: number;
  team_covered: number;
  days_late: number;
  nudges_sent: number;
  paid_via: string;
  paid_date: string | null;
  paypal_invoice: string;
}

/** One row per dollar movement in the team account. */
export interface LedgerRow {
  id: string;
  date: string;
  category: string;
  direction: "Money in" | "Money out";
  amount: number;
  money_in: number;
  money_out: number;
  what: string;
  recorded_by: string;
}

/** One row per game: the referee and whether PayPal Payouts has paid them. */
export interface GameRow {
  id: string;
  date: string;
  opponent: string;
  result: string;
  referee: string;
  referee_fee: number;
  payout: "Paid by PayPal" | "In flight" | "Failed" | "Not yet";
  paid_out: number;
}

export interface StudioTables {
  team: { name: string; shortName: string; season: string; treasurer: string };
  mode: "live" | "simulator";
  dues: DuesRow[];
  ledger: LedgerRow[];
  games: GameRow[];
}

function category(type: string, summary: string): string {
  if (type === "opening.balance") return "Carried over";
  if (type === "invoice.paid") return "Dues via PayPal";
  if (type === "payment.offline") return "Dues in cash";
  if (type === "payout.succeeded") return "Referees";
  if (/uniform/i.test(summary)) return "Uniforms";
  if (/league|registration/i.test(summary)) return "League fees";
  return "Other";
}

const SOURCE: Record<string, string> = {
  "paypal-webhook": "PayPal webhook",
  "paypal-sync": "PayPal sync",
  treasurer: "Treasurer",
  agent: "AI treasurer",
  seed: "Season import",
};

const METHOD: Record<string, string> = { cash: "Cash", venmo: "Venmo", zelle: "Zelle", check: "Check", other: "Outside PayPal" };

export function studioTables(state: AppState, mode: "live" | "simulator", now = Date.now()): StudioTables {
  const dues: DuesRow[] = [];
  for (const charge of state.charges) {
    for (const fam of state.team.families) {
      const base = {
        family: fam.surname,
        guardian: fam.guardian,
        language: LANGUAGE_NAMES[fam.language],
        players: fam.players.map((p) => p.name.split(" ")[0]).join(" & "),
        jersey: fam.players.map((p) => `#${p.jersey}`).join(" "),
        charge: charge.title,
        due_date: charge.dueDate,
      };
      const inv = state.invoices.find((i) => i.chargeId === charge.id && i.payerFamilyId === fam.id && i.status !== "CANCELLED");
      const prepaid = (charge.prepaid ?? []).filter((p) => p.familyId === fam.id);
      const prepaidCents = prepaid.reduce((a, p) => a + p.amountCents, 0);
      const coveredCents = charge.lines.filter((l) => l.familyId === fam.id && l.payerFamilyId === null && l.reason === "scholarship").reduce((a, l) => a + l.amountCents, 0);
      if (!inv && prepaidCents === 0 && coveredCents === 0) continue; // covered by another family, or not taking part
      const late = inv ? isLate(inv, charge, now) : false;
      const paidCents = (inv?.status === "PAID" ? inv.amountCents : 0) + prepaidCents;
      const openCents = inv && inv.status !== "PAID" ? inv.amountCents : 0;
      const status: DuesStatus = inv ? (inv.status === "PAID" ? "Paid" : late ? "Late" : "Open") : prepaidCents > 0 ? "Paid" : "Team fund";
      dues.push({
        id: `${charge.id}|${fam.id}`,
        ...base,
        status,
        billed: dollars(paidCents + openCents),
        collected: dollars(paidCents),
        outstanding: dollars(openCents),
        team_covered: dollars(coveredCents),
        days_late: late ? daysLate(charge, now) : 0,
        nudges_sent: inv?.reminders.length ?? 0,
        paid_via: inv?.status === "PAID" ? (inv.paidVia ?? "PayPal") : prepaid[0] ? (METHOD[prepaid[0].method] ?? "Outside PayPal") : inv ? "Not paid yet" : "Team fund",
        paid_date: inv?.paidAt ? inv.paidAt.slice(0, 10) : null,
        paypal_invoice: inv?.paypalInvoiceNumber ?? "",
      });
    }
  }

  const ledger: LedgerRow[] = state.events
    .filter((e) => e.amountCents !== 0)
    .map((e) => ({
      id: e.id,
      date: e.at.slice(0, 10),
      category: category(e.type, e.summary),
      direction: e.amountCents > 0 ? ("Money in" as const) : ("Money out" as const),
      amount: dollars(e.amountCents),
      money_in: e.amountCents > 0 ? dollars(e.amountCents) : 0,
      money_out: e.amountCents < 0 ? dollars(-e.amountCents) : 0,
      what: e.summary,
      recorded_by: SOURCE[e.source] ?? e.source,
    }));

  const games: GameRow[] = state.games.map((g) => {
    const ref = state.team.referees.find((r) => r.id === g.refereeId);
    const p = g.payout;
    return {
      id: g.id,
      date: g.date.slice(0, 10),
      opponent: g.opponent,
      result: g.score ? `${g.score.us}-${g.score.them}` : "Scheduled",
      referee: ref?.name ?? "",
      referee_fee: dollars(ref?.feeCents ?? 0),
      payout: !p ? "Not yet" : p.status === "SUCCESS" ? "Paid by PayPal" : p.status === "FAILED" || p.status === "UNCLAIMED" ? "Failed" : "In flight",
      paid_out: p?.status === "SUCCESS" ? dollars(p.amountCents) : 0,
    };
  });

  return {
    team: { name: state.team.name, shortName: state.team.shortName, season: state.team.season, treasurer: state.team.treasurer },
    mode,
    dues,
    ledger,
    games,
  };
}
