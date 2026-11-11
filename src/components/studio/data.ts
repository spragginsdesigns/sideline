"use client";
// Feeds AG Studio from /api/studio/data. The first load becomes Studio's data sources; every later
// poll is diffed and applied as a transaction, so a PayPal webhook that lands on the server shows up
// in every widget in place, with no reload.
import type { AgDataSourcesDefinition, AgFieldDefinition } from "ag-studio";
import type { DuesRow, GameRow, LedgerRow, StudioTables } from "@/lib/studio/tables";

const usd = { format: "$#,##0.00" };

export const DUES_FIELDS: AgFieldDefinition[] = [
  { id: "id", name: "Row ID", format: "textFormat", cardinality: "high", notBlank: true, hide: true },
  { id: "family", name: "Family", format: "textFormat" },
  { id: "guardian", name: "Parent", format: "textFormat" },
  { id: "language", name: "Language", format: "textFormat" },
  { id: "players", name: "Players", format: "textFormat" },
  { id: "jersey", name: "Jersey", format: "textFormat" },
  { id: "charge", name: "Charge", format: "textFormat" },
  { id: "due_date", name: "Due date", format: "dateFormat" },
  { id: "status", name: "Status", format: "textFormat", description: "Exactly one of: Paid, Open (invoiced, not yet due), Late (past its due date), Team fund (a scholarship the team covers), Covered (another family pays their share)." },
  { id: "billed", name: "Billed", format: "currencyFormat", formatOptions: usd },
  { id: "collected", name: "Collected", format: "currencyFormat", formatOptions: usd },
  { id: "outstanding", name: "Still owed", format: "currencyFormat", formatOptions: usd },
  { id: "team_covered", name: "Team fund covers", format: "currencyFormat", formatOptions: usd },
  { id: "days_late", name: "Days late", format: "integerFormat" },
  { id: "nudges_sent", name: "Nudges sent", format: "integerFormat" },
  { id: "paid_via", name: "Paid via", format: "textFormat", description: "How the money arrived: PayPal, Venmo, Card, Cash, or \"Not paid yet\"." },
  { id: "paid_date", name: "Paid on", format: "dateFormat" },
  { id: "paypal_invoice", name: "PayPal invoice", format: "textFormat" },
] as AgFieldDefinition[];

export const LEDGER_FIELDS: AgFieldDefinition[] = [
  { id: "id", name: "Entry ID", format: "textFormat", cardinality: "high", notBlank: true, hide: true },
  { id: "date", name: "Date", format: "dateFormat" },
  { id: "category", name: "Category", format: "textFormat", description: "Carried over, Dues via PayPal, Dues in cash, Referees, Uniforms, League fees or Other." },
  { id: "direction", name: "Direction", format: "textFormat", description: "Exactly \"Money in\" or \"Money out\"." },
  { id: "amount", name: "Amount", format: "currencyFormat", formatOptions: usd },
  { id: "money_in", name: "Money in", format: "currencyFormat", formatOptions: usd, description: "The amount if this entry is income, otherwise 0." },
  { id: "money_out", name: "Money out", format: "currencyFormat", formatOptions: usd, description: "The amount if this entry is spending, otherwise 0. Sum it by category for spending by category; no filter is needed." },
  { id: "what", name: "What", format: "textFormat" },
  { id: "recorded_by", name: "Recorded by", format: "textFormat" },
] as AgFieldDefinition[];

export const GAMES_FIELDS: AgFieldDefinition[] = [
  { id: "id", name: "Game ID", format: "textFormat", cardinality: "high", notBlank: true, hide: true },
  { id: "date", name: "Date", format: "dateFormat" },
  { id: "opponent", name: "Opponent", format: "textFormat" },
  { id: "result", name: "Result", format: "textFormat" },
  { id: "referee", name: "Referee", format: "textFormat" },
  { id: "referee_fee", name: "Referee fee", format: "currencyFormat", formatOptions: usd },
  { id: "payout", name: "PayPal payout", format: "textFormat", description: "Exactly one of: Paid by PayPal, In flight, Failed, Not yet." },
  { id: "paid_out", name: "Paid out", format: "currencyFormat", formatOptions: usd },
] as AgFieldDefinition[];

type Row = Record<string, string | number | Date | null>;

const DATE_KEYS = new Set(["due_date", "paid_date", "date"]);

/** JSON rows -> Studio rows: dates become Date objects (local noon, so a time zone never moves the day). */
function hydrate(rows: (DuesRow | LedgerRow | GameRow)[]): Row[] {
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) out[k] = DATE_KEYS.has(k) && typeof v === "string" ? new Date(`${v}T12:00:00`) : (v as Row[string]);
    return out;
  });
}

export function toSources(t: StudioTables): AgDataSourcesDefinition {
  return {
    description: `${t.team.name} (${t.team.season}): what each family owes and has paid, every dollar in and out of the team account, and the games with their referee payouts. All amounts are US dollars.`,
    sources: [
      { id: "dues", name: "Family dues", description: "One row per family per charge: billed, collected, still owed, status (Paid, Open, Late, Team fund, Covered), how they paid and the PayPal invoice number.", primaryKeyField: "id", transactions: "all", data: hydrate(t.dues), fields: DUES_FIELDS },
      { id: "ledger", name: "Team ledger", description: "One row per movement in the team account: dues paid through PayPal or in cash, referee payouts, expenses, and the balance carried over.", primaryKeyField: "id", transactions: "all", data: hydrate(t.ledger), fields: LEDGER_FIELDS },
      { id: "games", name: "Games & referees", description: "One row per game: the opponent, result, referee, fee, and whether PayPal Payouts has paid the referee.", primaryKeyField: "id", transactions: "all", data: hydrate(t.games), fields: GAMES_FIELDS },
    ],
  };
}

export interface TableDiff {
  tableId: string;
  add: Row[];
  update: Row[];
  remove: string[];
}

const same = (a: Row, b: Row) => Object.keys(b).every((k) => (a[k] instanceof Date ? (a[k] as Date).getTime() === (b[k] as Date | null)?.getTime?.() : a[k] === b[k]));

/** What changed between two polls, per table, as Studio transactions. */
export function diffTables(prev: StudioTables, next: StudioTables): TableDiff[] {
  const out: TableDiff[] = [];
  for (const tableId of ["dues", "ledger", "games"] as const) {
    const before = new Map(hydrate(prev[tableId]).map((r) => [String(r.id), r]));
    const after = hydrate(next[tableId]);
    const seen = new Set<string>();
    const add: Row[] = [];
    const update: Row[] = [];
    for (const r of after) {
      const id = String(r.id);
      seen.add(id);
      const old = before.get(id);
      if (!old) add.push(r);
      else if (!same(old, r)) update.push(r);
    }
    const remove = [...before.keys()].filter((id) => !seen.has(id));
    if (add.length || update.length || remove.length) out.push({ tableId, add, update, remove });
  }
  return out;
}
