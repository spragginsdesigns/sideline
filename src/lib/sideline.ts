// Application services. Every PayPal call goes through gateway(); every state
// change goes through mutate(). PayPal calls happen outside mutate() so the
// simulator's webhook events (which also mutate) never deadlock.
import { gateway, simulator } from "./paypal/index.ts";
import { mutate, newId, readState } from "./store.ts";
import { allocate, invoicesFor, type Allocation, type ChargeRules } from "./ledger/allocate.ts";
import { readChargeMessage } from "./ai/rules.ts";
import { draftNudges, type Nudge } from "./ai/nudges.ts";
import { formatCents } from "./money.ts";
import { daysLate, isLate } from "./summary.ts";
import { handlePayPalEvent } from "./webhooks.ts";
import { publicBaseUrl } from "./config.ts";
import type { Charge, Invoice } from "./types.ts";
import type { DraftInvoiceInput } from "./paypal/gateway.ts";

export interface ChargePreview {
  rules: ChargeRules;
  allocation: Allocation;
  invoices: ReturnType<typeof invoicesFor>;
  isMoneyRequest: boolean;
}

/** Today's date where the team plays, so "due Friday" resolves to the right Friday. */
export function todayIso(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: process.env.SIDELINE_TIMEZONE || "America/Los_Angeles" }).format(now);
}

export async function previewCharge(message: string): Promise<ChargePreview> {
  const state = readState();
  const rules = await readChargeMessage(message, state.team, todayIso());
  return buildPreview(rules, rules.isMoneyRequest);
}

export function buildPreview(rules: ChargeRules, isMoneyRequest = true): ChargePreview {
  const state = readState();
  const allocation = allocate(rules, state.team.families);
  const invoices = invoicesFor({ title: rules.title, lines: allocation.lines }, state.team.families);
  return { rules, allocation, invoices, isMoneyRequest };
}

function slug(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18);
}

function draftInput(inv: Invoice, charge: Charge): DraftInvoiceInput {
  const state = readState();
  const fam = state.team.families.find((f) => f.id === inv.payerFamilyId)!;
  const [given, ...rest] = fam.guardian.split(" ");
  return {
    invoiceNumber: inv.paypalInvoiceNumber!,
    currency: "USD",
    note: `Hi ${given}! This is your family's share of ${charge.title} for ${state.team.name}. Thank you for supporting the team.`,
    memo: `Sideline charge ${charge.id}`,
    dueDate: charge.dueDate,
    recipient: { givenName: given, surname: rest.join(" ") || fam.surname, email: fam.email },
    items: inv.items,
    invoicer: { businessName: state.team.name, email: process.env.PAYPAL_INVOICER_EMAIL || undefined },
  };
}

/** Confirm a preview: store the charge, then create, send and QR-code one PayPal invoice per paying family. */
export async function createCharge(rules: ChargeRules, sourceMessage: string): Promise<{ chargeId: string; sent: number; failed: { family: string; error: string }[] }> {
  const preview = buildPreview(rules);
  if (preview.invoices.length === 0) throw new Error("Nobody owes anything on this charge, so there is nothing to send.");
  const chargeId = newId("c");
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  await mutate((state) => {
    const charge: Charge = {
      id: chargeId,
      title: rules.title,
      totalCents: preview.allocation.totalCents,
      dueDate: rules.dueDate,
      createdAt: new Date().toISOString(),
      sourceMessage,
      rulesSummary: rules.notes,
      warnings: [...rules.ambiguities, ...preview.allocation.warnings],
      lines: preview.allocation.lines,
      absorbedCents: preview.allocation.absorbedCents,
    };
    state.charges.push(charge);
    for (const p of preview.invoices) {
      const fam = state.team.families.find((f) => f.id === p.payerFamilyId)!;
      state.invoices.push({
        id: newId("i"),
        chargeId,
        payerFamilyId: p.payerFamilyId,
        items: p.items,
        amountCents: p.amountCents,
        status: "DRAFT",
        paypalInvoiceId: null,
        paypalInvoiceNumber: `${state.team.shortName}-${slug(rules.title)}-${slug(fam.surname)}-${stamp}`,
        payerViewUrl: null,
        qrCodeDataUrl: null,
        createdAt: new Date().toISOString(),
        sentAt: null,
        paidAt: null,
        paidVia: null,
        reminders: [],
      });
    }
    if (charge.absorbedCents > 0) {
      state.events.push({ id: newId("e"), at: charge.createdAt, type: "expense", summary: `Scholarship covered by the team fund: ${charge.title}`, amountCents: -charge.absorbedCents, source: "treasurer", ref: chargeId, paypalEventId: null });
    }
  });

  const gw = gateway();
  const failed: { family: string; error: string }[] = [];
  let sent = 0;
  const drafts = readState().invoices.filter((i) => i.chargeId === chargeId);
  const charge = readState().charges.find((c) => c.id === chargeId)!;
  // Small parallel batches: fast for the treasurer, polite to PayPal's rate limits.
  const BATCH = 4;
  for (let i = 0; i < drafts.length; i += BATCH) {
    await Promise.all(
      drafts.slice(i, i + BATCH).map(async (inv) => {
        const fam = readState().team.families.find((f) => f.id === inv.payerFamilyId)!;
        try {
          const created = await gw.createDraftInvoice(draftInput(inv, charge));
          const sentRes = await gw.sendInvoice(created.paypalInvoiceId, {
            subject: `${readState().team.name}: ${charge.title} (${formatCents(inv.amountCents)})`,
            note: `Pay with PayPal, Venmo or card. Questions? Reply to ${readState().team.treasurer}.`,
          });
          const qr = await gw.generateQrCode(created.paypalInvoiceId);
          await mutate((state) => {
            const row = state.invoices.find((x) => x.id === inv.id)!;
            row.paypalInvoiceId = created.paypalInvoiceId;
            row.status = "SENT";
            row.sentAt = new Date().toISOString();
            row.payerViewUrl = sentRes.payerViewUrl;
            row.qrCodeDataUrl = qr;
          });
          sent++;
        } catch (e) {
          failed.push({ family: fam.surname, error: (e as Error).message });
        }
      }),
    );
  }
  await mutate((state) => {
    state.events.push({
      id: newId("e"),
      at: new Date().toISOString(),
      type: "charge.created",
      summary: `${charge.title}: ${sent} PayPal invoice${sent === 1 ? "" : "s"} sent${failed.length ? `, ${failed.length} failed` : ""}`,
      amountCents: 0,
      source: "treasurer",
      ref: chargeId,
      paypalEventId: null,
    });
  });
  return { chargeId, sent, failed };
}

/** Retry invoices left in DRAFT by a failed send. */
export async function retryDrafts(chargeId: string) {
  const charge = readState().charges.find((c) => c.id === chargeId);
  if (!charge) throw new Error("Unknown charge");
  const gw = gateway();
  let sent = 0;
  for (const inv of readState().invoices.filter((i) => i.chargeId === chargeId && i.status === "DRAFT")) {
    const created = inv.paypalInvoiceId ? { paypalInvoiceId: inv.paypalInvoiceId } : await gw.createDraftInvoice(draftInput(inv, charge));
    const s = await gw.sendInvoice(created.paypalInvoiceId, { subject: `${readState().team.name}: ${charge.title}`, note: "" });
    const qr = await gw.generateQrCode(created.paypalInvoiceId);
    await mutate((state) => {
      const row = state.invoices.find((x) => x.id === inv.id)!;
      Object.assign(row, { paypalInvoiceId: created.paypalInvoiceId, status: "SENT", sentAt: new Date().toISOString(), payerViewUrl: s.payerViewUrl, qrCodeDataUrl: qr });
    });
    sent++;
  }
  return { sent };
}

export function lateInvoices(chargeId?: string) {
  const state = readState();
  return state.invoices.filter((i) => {
    if (i.status !== "SENT") return false;
    if (chargeId && i.chargeId !== chargeId) return false;
    const c = state.charges.find((x) => x.id === i.chargeId);
    // Remind anyone past due; for a charge with no due date, anyone sent 3+ days ago.
    return c?.dueDate ? isLate(i, c) : Date.now() - new Date(i.sentAt ?? i.createdAt).getTime() > 3 * 86_400_000;
  });
}

export async function draftReminders(invoiceIds?: string[]): Promise<(Nudge & { invoiceId: string })[]> {
  const state = readState();
  const targets = invoiceIds?.length ? state.invoices.filter((i) => invoiceIds.includes(i.id) && i.status === "SENT") : lateInvoices();
  const reqs = targets.map((inv) => {
    const fam = state.team.families.find((f) => f.id === inv.payerFamilyId)!;
    const charge = state.charges.find((c) => c.id === inv.chargeId);
    return {
      invoiceId: inv.id,
      familyId: fam.id,
      guardianFirstName: fam.guardian.split(" ")[0],
      surname: fam.surname,
      language: fam.language,
      playerNames: fam.players.map((p) => p.name.split(" ")[0]),
      chargeTitle: charge?.title ?? "team fees",
      amount: formatCents(inv.amountCents),
      dueDate: charge?.dueDate ?? null,
      daysLate: daysLate(charge),
      remindersSoFar: inv.reminders.length,
    };
  });
  // One family can owe on two charges; draft per invoice by keying on invoice id.
  const byFamily = new Map<string, typeof reqs>();
  for (const r of reqs) byFamily.set(r.familyId, [...(byFamily.get(r.familyId) ?? []), r]);
  const first = reqs.filter((r, i) => reqs.findIndex((x) => x.familyId === r.familyId) === i);
  const merged = first.map((r) => {
    const all = byFamily.get(r.familyId)!;
    if (all.length === 1) return r;
    const total = all.reduce((a, x) => a + targets.find((t) => t.id === x.invoiceId)!.amountCents, 0);
    return { ...r, chargeTitle: all.map((x) => x.chargeTitle).join(" + "), amount: formatCents(total) };
  });
  const nudges = await draftNudges(merged, { team: state.team.name, treasurer: state.team.treasurer, today: todayIso() });
  return nudges.flatMap((n) => (byFamily.get(n.familyId) ?? []).map((r) => ({ ...n, invoiceId: r.invoiceId })));
}

export async function sendReminders(reminders: { invoiceId: string; subject: string; message: string }[]) {
  const gw = gateway();
  const results: { invoiceId: string; ok: boolean; error?: string }[] = [];
  for (const r of reminders) {
    const inv = readState().invoices.find((i) => i.id === r.invoiceId);
    if (!inv?.paypalInvoiceId || inv.status !== "SENT") {
      results.push({ invoiceId: r.invoiceId, ok: false, error: "Invoice is not awaiting payment" });
      continue;
    }
    const link = `${publicBaseUrl()}/pay/${inv.id}`;
    try {
      await gw.sendReminder(inv.paypalInvoiceId, { subject: r.subject.slice(0, 120), note: `${r.message.slice(0, 3500)}\n\n${link}` });
      await mutate((state) => {
        const row = state.invoices.find((i) => i.id === r.invoiceId)!;
        const fam = state.team.families.find((f) => f.id === row.payerFamilyId)!;
        row.reminders.push({ at: new Date().toISOString(), language: fam.language, message: r.message });
        state.events.push({ id: newId("e"), at: new Date().toISOString(), type: "invoice.reminder", summary: `Friendly nudge sent to the ${fam.surname} family`, amountCents: 0, source: "agent", ref: row.id, paypalEventId: null });
      });
      results.push({ invoiceId: r.invoiceId, ok: true });
    } catch (e) {
      results.push({ invoiceId: r.invoiceId, ok: false, error: (e as Error).message });
    }
  }
  return results;
}

/** Mark a game final and pay its referee through PayPal Payouts. */
export async function finalizeGame(gameId: string, score: { us: number; them: number }) {
  const state = readState();
  const game = state.games.find((g) => g.id === gameId);
  if (!game) throw new Error("Unknown game");
  if (game.status === "final" && game.payout) throw new Error("This game is already final and the referee was paid.");
  const ref = state.team.referees.find((r) => r.id === game.refereeId)!;
  const payout = await gateway().createPayout({
    senderBatchId: `${state.team.shortName}-${game.id}-${Date.now().toString(36)}`,
    emailSubject: `${state.team.name} referee fee`,
    emailMessage: `Thanks for reffing ${state.team.name} vs ${game.opponent}!`,
    items: [{ receiverEmail: ref.email, amountCents: ref.feeCents, note: `Referee fee: vs ${game.opponent}`, senderItemId: game.id }],
  });
  await mutate((s) => {
    const g = s.games.find((x) => x.id === gameId)!;
    g.status = "final";
    g.score = score;
    g.payout = { batchId: payout.batchId, itemId: null, status: "PENDING", amountCents: ref.feeCents, createdAt: new Date().toISOString(), paidAt: null };
    s.events.push({ id: newId("e"), at: new Date().toISOString(), type: "payout.created", summary: `Final ${score.us}-${score.them} vs ${g.opponent}: paying referee ${ref.name}`, amountCents: 0, source: "treasurer", ref: payout.batchId, paypalEventId: null });
  });
  return { batchId: payout.batchId };
}

/** Live mode: catch payments PayPal has recorded even if a webhook never reached us (e.g. on localhost). */
export async function syncFromPayPal(): Promise<{ checked: number; updated: number }> {
  const gw = gateway();
  if (gw.mode !== "live") return { checked: 0, updated: 0 };
  const open = readState().invoices.filter((i) => i.status === "SENT" && i.paypalInvoiceId);
  let updated = 0;
  for (const inv of open) {
    try {
      const remote = await gw.getInvoice(inv.paypalInvoiceId!);
      if (remote.status === "PAID" || remote.status === "MARKED_AS_PAID") {
        const r = await handlePayPalEvent(
          { id: `SYNC-${inv.paypalInvoiceId}-PAID`, event_type: "INVOICING.INVOICE.PAID", resource: { id: inv.paypalInvoiceId, payments: { paid_amount: { value: (remote.paidCents / 100).toFixed(2) } } } },
          "paypal-sync",
        );
        if (r.handled) updated++;
      }
    } catch (e) {
      console.warn(`[sideline] sync failed for ${inv.paypalInvoiceId}: ${(e as Error).message}`);
    }
  }
  return { checked: open.length, updated };
}

/** Simulator only: what a family does on PayPal's checkout page. */
export async function simulatePayment(invoiceId: string, method: "PAYPAL" | "VENMO" = "PAYPAL") {
  const sim = simulator();
  if (!sim) throw new Error("Simulated payments are only available without PayPal credentials. Pay through the real PayPal link instead.");
  const inv = readState().invoices.find((i) => i.id === invoiceId);
  if (!inv?.paypalInvoiceId) throw new Error("That invoice has not been sent yet.");
  rehydrate(inv);
  await sim.payInvoice(inv.paypalInvoiceId, method);
}

export async function simulatePaymentByPayPalId(paypalInvoiceId: string, method: "PAYPAL" | "VENMO" = "PAYPAL") {
  const inv = readState().invoices.find((i) => i.paypalInvoiceId === paypalInvoiceId);
  if (!inv) throw new Error("Unknown PayPal invoice");
  return simulatePayment(inv.id, method);
}

/** The simulator keeps its invoices in memory; after a restart, re-register them from the store. */
function rehydrate(inv: Invoice) {
  const sim = simulator();
  if (!sim || !inv.paypalInvoiceId) return;
  const charge = readState().charges.find((c) => c.id === inv.chargeId);
  if (charge) sim.adopt(inv.paypalInvoiceId, draftInput(inv, charge), inv.status, inv.payerViewUrl);
}

export function rehydrateAll() {
  for (const inv of readState().invoices) rehydrate(inv);
}

/**
 * Live mode only: the demo team starts with three unpaid uniform invoices. Create
 * them as real PayPal invoices the first time the app runs with credentials, so
 * reminders and payments work on them like any other invoice.
 */
export async function publishSeedInvoices(): Promise<number> {
  const gw = gateway();
  const sim = simulator();
  if (sim) {
    // Simulator: give the seeded open invoices the same payer link and QR code a sent invoice has.
    const bare = readState().invoices.filter((i) => i.status === "SENT" && i.paypalInvoiceId && !i.qrCodeDataUrl);
    for (const inv of bare) {
      const url = `${publicBaseUrl()}/sandbox-checkout/${encodeURIComponent(inv.paypalInvoiceId!)}`;
      const charge = readState().charges.find((c) => c.id === inv.chargeId)!;
      sim.adopt(inv.paypalInvoiceId!, draftInput(inv, charge), "SENT", url);
      const qr = await sim.generateQrCode(inv.paypalInvoiceId!);
      await mutate((state) => {
        const row = state.invoices.find((x) => x.id === inv.id)!;
        row.payerViewUrl = url;
        row.qrCodeDataUrl = qr;
      });
    }
    return bare.length;
  }
  if (gw.mode !== "live") return 0;
  const pending = readState().invoices.filter((i) => i.paypalInvoiceId?.startsWith("SEED-"));
  let n = 0;
  const stamp = Date.now().toString(36).toUpperCase().slice(-4);
  for (const inv of pending) {
    const charge = readState().charges.find((c) => c.id === inv.chargeId)!;
    const input = { ...draftInput(inv, charge), invoiceNumber: `${inv.paypalInvoiceNumber}-${stamp}`, dueDate: null };
    try {
      const created = await gw.createDraftInvoice(input);
      const sent = await gw.sendInvoice(created.paypalInvoiceId, { subject: `${readState().team.name}: ${charge.title}`, note: "" });
      const qr = await gw.generateQrCode(created.paypalInvoiceId);
      await mutate((state) => {
        const row = state.invoices.find((x) => x.id === inv.id)!;
        Object.assign(row, { paypalInvoiceId: created.paypalInvoiceId, paypalInvoiceNumber: input.invoiceNumber, payerViewUrl: sent.payerViewUrl, qrCodeDataUrl: qr });
      });
      n++;
    } catch (e) {
      console.warn(`[sideline] could not publish seed invoice ${inv.id}: ${(e as Error).message}`);
    }
  }
  return n;
}
