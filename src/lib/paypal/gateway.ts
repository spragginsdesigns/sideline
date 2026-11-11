// The PayPal surface Sideline uses. Two implementations:
//   live.ts      - the real PayPal REST API (sandbox or production), used when
//                  PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are set.
//   simulator.ts - a local stand-in that returns PayPal-shaped responses and
//                  emits PayPal-shaped webhook events, so the app runs with no keys.

export interface DraftInvoiceInput {
  invoiceNumber: string; // unique per merchant, e.g. "HAWKS-FRESNO-GARCIA"; also the idempotency key
  currency: "USD";
  note: string;
  memo?: string;
  dueDate: string | null; // YYYY-MM-DD
  recipient: { givenName: string; surname: string; email: string };
  items: { name: string; description: string; amountCents: number }[];
  invoicer: { businessName: string; email?: string; website?: string };
}

export interface CreatedInvoice {
  paypalInvoiceId: string;
  invoiceNumber: string;
  status: string; // PayPal status, e.g. "DRAFT"
}

export interface SentInvoice {
  payerViewUrl: string | null;
}

export interface RemoteInvoice {
  paypalInvoiceId: string;
  invoiceNumber: string;
  status: string; // DRAFT | SENT | SCHEDULED | PAID | MARKED_AS_PAID | CANCELLED | PARTIALLY_PAID | ...
  amountCents: number;
  paidCents: number;
  recipientEmail: string | null;
  payerViewUrl: string | null;
}

export interface PayoutInput {
  senderBatchId: string;
  emailSubject: string;
  emailMessage: string;
  items: { receiverEmail: string; amountCents: number; note: string; senderItemId: string }[];
}

export interface CreatedPayout {
  batchId: string;
  batchStatus: string; // PENDING | PROCESSING | SUCCESS | ...
}

export interface RemoteTransaction {
  id: string;
  date: string; // ISO
  amountCents: number; // positive in, negative out
  status: string;
  description: string;
}

export interface WebhookVerifyInput {
  headers: Record<string, string | null>;
  rawBody: string;
}

export interface PayPalGateway {
  readonly mode: "live" | "simulator";
  readonly environment: "sandbox" | "production" | "simulator";
  createDraftInvoice(input: DraftInvoiceInput): Promise<CreatedInvoice>;
  sendInvoice(paypalInvoiceId: string, opts: { subject: string; note: string }): Promise<SentInvoice>;
  generateQrCode(paypalInvoiceId: string): Promise<string | null>; // data URL (image/png) or null
  sendReminder(paypalInvoiceId: string, opts: { subject: string; note: string }): Promise<void>;
  cancelInvoice(paypalInvoiceId: string, opts: { subject: string; note: string }): Promise<void>;
  /** Record a payment made outside PayPal (cash, check) against the invoice. */
  recordPayment(paypalInvoiceId: string, opts: { method: "CASH" | "CHECK"; amountCents: number; date: string; note: string }): Promise<void>;
  getInvoice(paypalInvoiceId: string): Promise<RemoteInvoice>;
  createPayout(input: PayoutInput): Promise<CreatedPayout>;
  listTransactions(range: { startDate: string; endDate: string }): Promise<RemoteTransaction[]>;
  /** Returns true when PayPal confirms the webhook signature. */
  verifyWebhook(input: WebhookVerifyInput): Promise<boolean>;
}
