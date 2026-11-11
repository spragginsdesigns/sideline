// One handler for every PayPal event, whether it arrived over HTTP from PayPal
// (verified signature), from a sync poll, or from the local simulator.
// Idempotent: a redelivered event id is ignored.
import { mutate, newId } from "./store.ts";
import { decimalToCents, formatCents } from "./money.ts";
import type { AppState } from "./types.ts";

export interface IncomingEvent {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
}

export type EventSource = "paypal-webhook" | "paypal-sync" | "simulator";

export interface HandleResult {
  handled: boolean;
  duplicate: boolean;
  note: string;
}

const MAX_REMEMBERED = 2000;

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function handlePayPalEvent(event: IncomingEvent, source: EventSource): Promise<HandleResult> {
  return mutate((state) => apply(state, event, source));
}

function apply(state: AppState, event: IncomingEvent, source: EventSource): HandleResult {
  if (!event?.id || !event?.event_type) return { handled: false, duplicate: false, note: "malformed event" };
  if (state.processedWebhookIds.includes(event.id)) return { handled: false, duplicate: true, note: "already processed" };

  const evSource = source === "paypal-sync" ? "paypal-sync" : "paypal-webhook";
  const res = obj(event.resource);
  let result: HandleResult = { handled: false, duplicate: false, note: `ignored ${event.event_type}` };

  switch (event.event_type) {
    case "INVOICING.INVOICE.PAID": {
      const ppId = str(res.id);
      const inv = state.invoices.find((i) => i.paypalInvoiceId === ppId);
      if (!inv) {
        result = { handled: false, duplicate: false, note: `no local invoice for ${ppId}` };
        break;
      }
      if (inv.status === "PAID") {
        result = { handled: false, duplicate: true, note: "invoice already paid" };
        break;
      }
      const payments = obj(res.payments);
      const paid = decimalToCents(str(obj(payments.paid_amount).value) ?? "0") || inv.amountCents;
      const tx = Array.isArray(payments.transactions) ? obj(payments.transactions[0]) : {};
      inv.status = "PAID";
      inv.paidAt = new Date().toISOString();
      const method = str(tx.method);
      inv.paidVia = method === "VENMO" ? "Venmo" : method === "CARD" ? "Card" : method === "CASH" ? "Cash" : method === "CHECK" ? "Check" : "PayPal";
      const fam = state.team.families.find((f) => f.id === inv.payerFamilyId);
      const charge = state.charges.find((c) => c.id === inv.chargeId);
      state.events.push({
        id: newId("e"),
        at: inv.paidAt,
        type: "invoice.paid",
        summary: `${fam?.surname ?? "A"} family paid ${charge?.title ?? "an invoice"}${inv.paidVia === "Cash" || inv.paidVia === "Check" ? ` (${inv.paidVia.toLowerCase()}, recorded in PayPal)` : ""}`,
        amountCents: paid,
        source: evSource,
        ref: inv.id,
        paypalEventId: event.id,
      });
      result = { handled: true, duplicate: false, note: `invoice ${inv.id} paid ${formatCents(paid)}` };
      break;
    }
    case "INVOICING.INVOICE.CANCELLED": {
      const inv = state.invoices.find((i) => i.paypalInvoiceId === str(res.id));
      if (inv && inv.status !== "CANCELLED") {
        inv.status = "CANCELLED";
        state.events.push({ id: newId("e"), at: new Date().toISOString(), type: "invoice.cancelled", summary: `Invoice ${inv.paypalInvoiceNumber} cancelled`, amountCents: 0, source: evSource, ref: inv.id, paypalEventId: event.id });
        result = { handled: true, duplicate: false, note: `invoice ${inv.id} cancelled` };
      }
      break;
    }
    case "PAYMENT.PAYOUTS-ITEM.SUCCEEDED":
    case "PAYMENT.PAYOUTS-ITEM.FAILED":
    case "PAYMENT.PAYOUTS-ITEM.UNCLAIMED":
    case "PAYMENT.PAYOUTS-ITEM.BLOCKED":
    case "PAYMENT.PAYOUTS-ITEM.RETURNED": {
      const batchId = str(res.payout_batch_id);
      const game = state.games.find((g) => g.payout?.batchId === batchId);
      if (!game?.payout) {
        result = { handled: false, duplicate: false, note: `no game for payout batch ${batchId}` };
        break;
      }
      const ok = event.event_type.endsWith("SUCCEEDED");
      const status = ok ? "SUCCESS" : event.event_type.endsWith("UNCLAIMED") ? "UNCLAIMED" : "FAILED";
      if (game.payout.status === status) {
        result = { handled: false, duplicate: true, note: "payout already in that state" };
        break;
      }
      game.payout.status = status;
      game.payout.itemId = str(res.payout_item_id);
      const ref = state.team.referees.find((r) => r.id === game.refereeId);
      if (ok) {
        game.payout.paidAt = new Date().toISOString();
        state.events.push({ id: newId("e"), at: game.payout.paidAt, type: "payout.succeeded", summary: `Referee ${ref?.name ?? ""} paid for vs ${game.opponent}`, amountCents: -game.payout.amountCents, source: evSource, ref: batchId, paypalEventId: event.id });
      } else {
        state.events.push({ id: newId("e"), at: new Date().toISOString(), type: "payout.failed", summary: `Referee payout for vs ${game.opponent}: ${status.toLowerCase()}`, amountCents: 0, source: evSource, ref: batchId, paypalEventId: event.id });
      }
      result = { handled: true, duplicate: false, note: `payout ${batchId} ${status}` };
      break;
    }
  }

  // Remember only events we acted on: an event we couldn't match yet (e.g. a payout webhook
  // that beat our own write) must stay retryable, and PayPal redelivers non-2xx responses.
  if (!result.handled && !result.duplicate) return result;
  state.processedWebhookIds.push(event.id);
  if (state.processedWebhookIds.length > MAX_REMEMBERED) state.processedWebhookIds.splice(0, state.processedWebhookIds.length - MAX_REMEMBERED);
  return result;
}
