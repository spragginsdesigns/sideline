// Core domain model for Sideline. All money is integer cents.

export type LanguageCode = "en" | "es" | "vi" | "hmn" | "pa" | "tl" | "zh";

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  es: "Español",
  vi: "Tiếng Việt",
  hmn: "Hmoob",
  pa: "ਪੰਜਾਬੀ",
  tl: "Tagalog",
  zh: "中文",
};

export interface Family {
  id: string;
  surname: string;
  guardian: string; // the parent who pays, e.g. "Ana Garcia"
  email: string;
  language: LanguageCode;
  players: { name: string; jersey: number }[];
}

export interface Referee {
  id: string;
  name: string;
  email: string;
  feeCents: number;
}

export interface Team {
  id: string;
  name: string;
  shortName: string;
  sport: string;
  season: string;
  city: string;
  coach: string;
  treasurer: string;
  treasurerEmail: string;
  families: Family[];
  referees: Referee[];
}

export type ShareReason = "share" | "scholarship" | "adjusted" | "covered" | "excluded";

export type PrepaidMethod = "cash" | "venmo" | "zelle" | "check" | "other";

/** One family's obligation for a charge, and who pays it. */
export interface ChargeLine {
  familyId: string;
  payerFamilyId: string | null; // null = team fund absorbs it (scholarship) or not participating
  amountCents: number;
  reason: ShareReason;
  note: string;
}

export interface Charge {
  id: string;
  title: string;
  totalCents: number; // sum of every line, including absorbed lines
  dueDate: string | null; // YYYY-MM-DD
  createdAt: string;
  sourceMessage: string;
  rulesSummary: string[];
  warnings: string[];
  lines: ChargeLine[];
  absorbedCents: number; // amount the team fund covers (scholarships, discounts)
  absorbedByFamily?: Record<string, number>; // the same cents by family (charges created before this field: see the scholarship lines)
  prepaid?: { familyId: string; amountCents: number; method: PrepaidMethod }[]; // paid outside PayPal before invoicing
  roundingCents?: number; // pennies of rounding that go to the team fund
  clientKey?: string; // idempotency key from the treasurer's browser
}

export type InvoiceStatus = "DRAFT" | "SENT" | "PAID" | "CANCELLED";

export interface InvoiceItem {
  name: string;
  description: string;
  amountCents: number;
}

export interface Invoice {
  id: string; // local id
  chargeId: string;
  payerFamilyId: string;
  items: InvoiceItem[];
  amountCents: number;
  status: InvoiceStatus;
  paypalInvoiceId: string | null;
  paypalInvoiceNumber: string | null;
  payerViewUrl: string | null;
  qrCodeDataUrl: string | null;
  createdAt: string;
  sentAt: string | null;
  paidAt: string | null;
  paidVia: string | null;
  reminders: { at: string; language: LanguageCode; message: string }[];
}

export type GameStatus = "scheduled" | "final";

export interface Payout {
  batchId: string;
  itemId: string | null;
  status: "PROCESSING" | "PENDING" | "SUCCESS" | "FAILED" | "UNCLAIMED";
  amountCents: number;
  createdAt: string;
  paidAt: string | null;
  attempt?: number; // payout attempts for this game (a FAILED payout can be retried)
}

export interface Game {
  id: string;
  opponent: string;
  date: string; // ISO
  field: string;
  refereeId: string;
  status: GameStatus;
  score: { us: number; them: number } | null;
  payout: Payout | null;
}

export type LedgerEventType =
  | "charge.created"
  | "invoice.sent"
  | "invoice.paid"
  | "invoice.reminder"
  | "invoice.cancelled"
  | "payout.created"
  | "payout.succeeded"
  | "payout.failed"
  | "payout.unclaimed"
  | "payment.offline"
  | "opening.balance"
  | "expense";

export interface LedgerEvent {
  id: string;
  at: string;
  type: LedgerEventType;
  summary: string;
  amountCents: number; // positive for money in, negative for money out, 0 for informational
  source: "paypal-webhook" | "paypal-sync" | "treasurer" | "agent" | "seed";
  ref: string | null; // invoice id, payout batch id, etc.
  paypalEventId: string | null;
}

export interface AppState {
  version: number;
  epoch?: string; // unique per seeded demo team; keeps PayPal batch ids unique across demo resets
  team: Team;
  charges: Charge[];
  invoices: Invoice[];
  games: Game[];
  events: LedgerEvent[];
  processedWebhookIds: string[];
}
