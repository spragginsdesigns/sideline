import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/seed.ts";
import { applyPayPalEvent, type IncomingEvent } from "../src/lib/webhooks.ts";

// The resource shape of a real sandbox INVOICING.INVOICE.PAID webhook (event
// WH-954005615H4526602-8WR891373Y504824C, read back with GET /v1/notifications/webhooks-events/{id}),
// trimmed to the fields Sideline reads. Invoicing v2 nests the invoice under resource.invoice.
const PAID_EVENT: IncomingEvent = {
  id: "WH-954005615H4526602-8WR891373Y504824C",
  event_type: "INVOICING.INVOICE.PAID",
  resource: {
    invoice: {
      id: "INV2-J3A5-Y8M9-9V2L-GUWU",
      status: "PAID",
      amount: { currency_code: "USD", value: "56.26" },
      due_amount: { currency_code: "USD", value: "0.00" },
      payments: {
        paid_amount: { currency_code: "USD", value: "56.26" },
        transactions: [{ type: "PAYPAL", payment_id: "6C254780HV752610Y", transaction_type: "SALE", method: "PAYPAL", amount: { currency_code: "USD", value: "56.26" } }],
      },
    },
  },
};

/** The seeded team with one open invoice that PayPal knows as `paypalInvoiceId`. */
function teamWithOpenInvoice(paypalInvoiceId: string) {
  const state = seedState();
  const inv = state.invoices.find((i) => i.status === "SENT")!;
  inv.paypalInvoiceId = paypalInvoiceId;
  return { state, inv };
}

test("a real Invoicing v2 PAID webhook (resource.invoice) marks the right invoice paid", () => {
  const { state, inv } = teamWithOpenInvoice("INV2-J3A5-Y8M9-9V2L-GUWU");
  const r = applyPayPalEvent(state, PAID_EVENT, "paypal-webhook");
  assert.equal(r.handled, true, r.note);
  assert.equal(inv.status, "PAID");
  assert.equal(inv.paidVia, "PayPal");
  const ev = state.events.at(-1)!;
  assert.equal(ev.type, "invoice.paid");
  assert.equal(ev.ref, inv.id);
  assert.equal(ev.source, "paypal-webhook");
  assert.equal(ev.amountCents, 5626);
  assert.equal(ev.paypalEventId, PAID_EVENT.id);
  // PayPal redelivers: the same event id is a duplicate and changes nothing.
  const again = applyPayPalEvent(state, PAID_EVENT, "paypal-webhook");
  assert.equal(again.duplicate, true);
  assert.equal(state.events.filter((e) => e.ref === inv.id && e.type === "invoice.paid").length, 1);
});

test("a PAID event with no invoice id never matches a seeded invoice that has no PayPal id", () => {
  const state = seedState();
  assert.ok(state.invoices.some((i) => i.status === "PAID" && !i.paypalInvoiceId), "the seed has paid invoices without PayPal ids");
  const before = JSON.stringify(state.invoices);
  const r = applyPayPalEvent(state, { id: "WH-NO-ID", event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { status: "PAID" } } }, "paypal-webhook");
  // Not "invoice already paid": unmatched, so the route answers 404 and PayPal retries it later.
  assert.equal(r.handled, false);
  assert.equal(r.duplicate, false);
  assert.match(r.note, /no local invoice/);
  assert.equal(JSON.stringify(state.invoices), before);
  assert.ok(!state.processedWebhookIds.includes("WH-NO-ID"), "an unmatched event stays retryable");
});

test("the sync poll's flat shape (resource.id) still marks an invoice paid", () => {
  const { state, inv } = teamWithOpenInvoice("INV2-FLAT-0000-0000-0001");
  const r = applyPayPalEvent(
    state,
    { id: "SYNC-INV2-FLAT-0000-0000-0001-PAID", event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-FLAT-0000-0000-0001", payments: { paid_amount: { value: "56.26" }, transactions: [{ method: "VENMO" }] } } },
    "paypal-sync",
  );
  assert.equal(r.handled, true, r.note);
  assert.equal(inv.status, "PAID");
  assert.equal(inv.paidVia, "Venmo");
  assert.equal(state.events.at(-1)!.source, "paypal-sync");
});

test("a webhook after the sync already credited the invoice is a duplicate, not a second payment", () => {
  const { state, inv } = teamWithOpenInvoice("INV2-J3A5-Y8M9-9V2L-GUWU");
  applyPayPalEvent(state, { id: "SYNC-INV2-J3A5-Y8M9-9V2L-GUWU-PAID", event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-J3A5-Y8M9-9V2L-GUWU" } }, "paypal-sync");
  const r = applyPayPalEvent(state, PAID_EVENT, "paypal-webhook");
  assert.equal(r.duplicate, true);
  assert.equal(r.note, "invoice already paid");
  assert.equal(state.events.filter((e) => e.ref === inv.id && e.type === "invoice.paid").length, 1);
});

test("a real-shape CANCELLED webhook cancels the invoice it names", () => {
  const { state, inv } = teamWithOpenInvoice("INV2-CNCL-0000-0000-0001");
  const r = applyPayPalEvent(state, { id: "WH-CANCEL-1", event_type: "INVOICING.INVOICE.CANCELLED", resource: { invoice: { id: "INV2-CNCL-0000-0000-0001", status: "CANCELLED" } } }, "paypal-webhook");
  assert.equal(r.handled, true, r.note);
  assert.equal(inv.status, "CANCELLED");
});
