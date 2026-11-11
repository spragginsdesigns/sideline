// A local stand-in for the PayPal REST API, used only when no PayPal
// credentials are configured. It returns the same shapes as live.ts and emits
// PayPal-shaped webhook events (INVOICING.INVOICE.PAID, PAYMENT.PAYOUTS-ITEM.*)
// into the same handler the real webhook route uses.
import QRCode from "qrcode";
import { centsToDecimal } from "../money.ts";
import type {
  CreatedInvoice,
  CreatedPayout,
  DraftInvoiceInput,
  PayPalGateway,
  PayoutInput,
  RemoteInvoice,
  RemoteTransaction,
  SentInvoice,
  WebhookVerifyInput,
} from "./gateway.ts";

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  create_time: string;
  resource_type: string;
  summary: string;
  resource: Record<string, unknown>;
}

type Emit = (event: PayPalWebhookEvent) => Promise<void>;

interface SimInvoice {
  id: string;
  input: DraftInvoiceInput;
  status: string;
  paidCents: number;
  payerViewUrl: string | null;
}

function block(n: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < n; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

interface SimGlobal {
  __sidelineSim?: Map<string, SimInvoice>;
  __sidelineSimTx?: RemoteTransaction[];
}
const g = globalThis as unknown as SimGlobal;

export class SimulatedPayPalGateway implements PayPalGateway {
  readonly mode = "simulator" as const;
  readonly environment = "simulator" as const;
  private invoices = (g.__sidelineSim ??= new Map());
  private tx = (g.__sidelineSimTx ??= []);

  constructor(
    private emit: Emit,
    private payerViewBase: () => string,
  ) {}

  private get(id: string): SimInvoice {
    const inv = this.invoices.get(id);
    if (!inv) throw new Error(`RESOURCE_NOT_FOUND: invoice ${id} does not exist`);
    return inv;
  }

  /**
   * Register an invoice the store knows about. The store is the source of truth:
   * the simulator's memory is lost on restart and must follow a demo reset.
   */
  adopt(paypalInvoiceId: string, input: DraftInvoiceInput, status: string, payerViewUrl: string | null) {
    const paidCents = status === "PAID" ? input.items.reduce((a, i) => a + i.amountCents, 0) : 0;
    this.invoices.set(paypalInvoiceId, { id: paypalInvoiceId, input, status, paidCents, payerViewUrl });
  }

  /** Forget everything (used by the demo reset). */
  reset() {
    this.invoices.clear();
    this.tx.length = 0;
  }

  async createDraftInvoice(input: DraftInvoiceInput): Promise<CreatedInvoice> {
    if (input.items.length === 0) throw new Error("VALIDATION_ERROR: an invoice needs at least one item");
    for (const inv of this.invoices.values())
      if (inv.input.invoiceNumber === input.invoiceNumber && inv.status !== "CANCELLED")
        throw new Error("DUPLICATE_INVOICE_NUMBER: Invoice number already exists");
    const id = `INV2-${block(4)}-${block(4)}-${block(4)}-${block(4)}`;
    this.invoices.set(id, { id, input, status: "DRAFT", paidCents: 0, payerViewUrl: null });
    return { paypalInvoiceId: id, invoiceNumber: input.invoiceNumber, status: "DRAFT" };
  }

  async sendInvoice(id: string): Promise<SentInvoice> {
    const inv = this.get(id);
    if (inv.status !== "DRAFT") throw new Error(`UNPROCESSABLE_ENTITY: cannot send an invoice in ${inv.status}`);
    inv.status = "SENT";
    inv.payerViewUrl = `${this.payerViewBase()}/sandbox-checkout/${encodeURIComponent(id)}`;
    return { payerViewUrl: inv.payerViewUrl };
  }

  async generateQrCode(id: string): Promise<string | null> {
    const inv = this.get(id);
    return QRCode.toDataURL(inv.payerViewUrl ?? id, { width: 300, margin: 1, color: { dark: "#0b1324", light: "#ffffff" } });
  }

  async sendReminder(id: string): Promise<void> {
    const inv = this.get(id);
    if (inv.status !== "SENT") throw new Error(`UNPROCESSABLE_ENTITY: cannot remind an invoice in ${inv.status}`);
  }

  async cancelInvoice(id: string): Promise<void> {
    const inv = this.get(id);
    inv.status = "CANCELLED";
    await this.emit(this.event("INVOICING.INVOICE.CANCELLED", "invoices", `An invoice was cancelled`, this.invoiceResource(inv)));
  }

  async getInvoice(id: string): Promise<RemoteInvoice> {
    const inv = this.get(id);
    const total = inv.input.items.reduce((a, i) => a + i.amountCents, 0);
    return {
      paypalInvoiceId: inv.id,
      invoiceNumber: inv.input.invoiceNumber,
      status: inv.status,
      amountCents: total,
      paidCents: inv.paidCents,
      recipientEmail: inv.input.recipient.email,
      payerViewUrl: inv.payerViewUrl,
    };
  }

  /** What a family's PayPal checkout does in the real world: pay, then PayPal fires the webhook. */
  async payInvoice(id: string, method = "PAYPAL"): Promise<void> {
    const inv = this.get(id);
    if (inv.status === "PAID") return;
    if (inv.status !== "SENT") throw new Error(`UNPROCESSABLE_ENTITY: cannot pay an invoice in ${inv.status}`);
    const total = inv.input.items.reduce((a, i) => a + i.amountCents, 0);
    inv.status = "PAID";
    inv.paidCents = total;
    const now = new Date().toISOString();
    this.tx.push({ id: `SIMTX${block(12)}`, date: now, amountCents: total, status: "S", description: `Invoice ${inv.input.invoiceNumber}` });
    const resource = {
      ...this.invoiceResource(inv),
      payments: {
        paid_amount: { currency_code: "USD", value: centsToDecimal(total) },
        transactions: [{ payment_id: `SIMPAY${block(10)}`, method, type: "PAYPAL", payment_date: now.slice(0, 10), amount: { currency_code: "USD", value: centsToDecimal(total) } }],
      },
    };
    await this.emit(this.event("INVOICING.INVOICE.PAID", "invoices", `An invoice was paid`, resource));
  }

  async createPayout(input: PayoutInput): Promise<CreatedPayout> {
    const batchId = `SIMBATCH${block(10)}`;
    const now = new Date().toISOString();
    for (const item of input.items) {
      this.tx.push({ id: `SIMTX${block(12)}`, date: now, amountCents: -item.amountCents, status: "S", description: `Payout to ${item.receiverEmail}` });
    }
    // PayPal processes payouts asynchronously and reports each item by webhook.
    setTimeout(() => {
      for (const item of input.items) {
        void this.emit(
          this.event("PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "payouts_item", "A payout item has succeeded", {
            payout_item_id: `SIMITEM${block(10)}`,
            payout_batch_id: batchId,
            transaction_status: "SUCCESS",
            time_processed: new Date().toISOString(),
            payout_item: {
              recipient_type: "EMAIL",
              amount: { currency: "USD", value: centsToDecimal(item.amountCents) },
              note: item.note,
              receiver: item.receiverEmail,
              sender_item_id: item.senderItemId,
            },
          }),
        );
      }
    }, 2200);
    return { batchId, batchStatus: "PENDING" };
  }

  async listTransactions(range: { startDate: string; endDate: string }): Promise<RemoteTransaction[]> {
    return this.tx.filter((t) => t.date >= range.startDate && t.date <= range.endDate);
  }

  async verifyWebhook(_input: WebhookVerifyInput): Promise<boolean> {
    // The simulator never receives webhooks over HTTP; its events go straight to the handler.
    return false;
  }

  private invoiceResource(inv: SimInvoice) {
    const total = inv.input.items.reduce((a, i) => a + i.amountCents, 0);
    return {
      id: inv.id,
      status: inv.status,
      detail: { invoice_number: inv.input.invoiceNumber, currency_code: "USD", metadata: { recipient_view_url: inv.payerViewUrl } },
      primary_recipients: [{ billing_info: { email_address: inv.input.recipient.email } }],
      amount: { currency_code: "USD", value: centsToDecimal(total) },
    };
  }

  private event(type: string, resourceType: string, summary: string, resource: Record<string, unknown>): PayPalWebhookEvent {
    return { id: `WH-SIM-${block(6)}-${block(10)}`, event_type: type, create_time: new Date().toISOString(), resource_type: resourceType, summary, resource };
  }
}
