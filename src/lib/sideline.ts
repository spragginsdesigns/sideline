// Application services. Every PayPal call goes through gateway(); every state
// change goes through mutate(). PayPal calls happen outside mutate() so the
// simulator's webhook events (which also mutate) never deadlock.
import { gateway, simulator } from "./paypal/index.ts";
import { mutate, newId, readState } from "./store.ts";
import { allocate, invoicesFor, methodLabel, type Allocation, type ChargeRules } from "./ledger/allocate.ts";
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
  const clean = validateRules(rules);
  const allocation = allocate(clean, state.team.families);
  const invoices = invoicesFor({ title: clean.title, lines: allocation.lines, prepaid: allocation.prepaid }, state.team.families);
  return { rules: clean, allocation, invoices, isMoneyRequest };
}

const MAX_CENTS = 2_000_000; // $20,000: far above any youth-team charge, well below a typo'd fortune

/** Rules come back from the browser, so check every field before any money logic sees them. */
export function validateRules(r: ChargeRules): ChargeRules {
  if (!r || typeof r !== "object") throw new Error("Missing charge rules");
  const ids = new Set(readState().team.families.map((f) => f.id));
  const cents = (v: unknown, what: string) => {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_CENTS) throw new Error(`${what} must be a whole number of cents between $0 and $20,000`);
    return v;
  };
  const idList = (v: unknown, what: string) => {
    if (!Array.isArray(v)) throw new Error(`${what} must be a list`);
    for (const id of v) if (typeof id !== "string" || !ids.has(id)) throw new Error(`${what} has an unknown family`);
    return v as string[];
  };
  if (!["team_total", "per_family", "per_player"].includes(r.amountKind)) throw new Error("Unknown amount kind");
  if (!["family", "player"].includes(r.splitBasis)) throw new Error("Unknown split basis");
  if (!["team_absorbs", "split_among_others"].includes(r.scholarshipPolicy)) throw new Error("Unknown scholarship policy");
  if (r.dueDate !== null && !(typeof r.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.dueDate))) throw new Error("Due date must be YYYY-MM-DD");
  const title = String(r.title ?? "").trim().slice(0, 60);
  if (!title) throw new Error("The charge needs a title");
  if (!Array.isArray(r.coverings) || !Array.isArray(r.adjustments) || !Array.isArray(r.prepaid)) throw new Error("Malformed rules");
  const fraction = (v: unknown, what: string, max = 1) => {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > max) throw new Error(`${what} must be a fraction between 0 and ${max}`);
    return v;
  };
  return {
    title,
    amountKind: r.amountKind,
    amountCents: cents(r.amountCents, "The amount"),
    splitBasis: r.splitBasis,
    dueDate: r.dueDate,
    scholarshipFamilyIds: idList(r.scholarshipFamilyIds, "Scholarships"),
    scholarshipPolicy: r.scholarshipPolicy,
    coverings: r.coverings.map((c) => {
      idList([c?.payerFamilyId, c?.coveredFamilyId], "A covering");
      return { payerFamilyId: c.payerFamilyId, coveredFamilyId: c.coveredFamilyId, fraction: fraction(c.fraction ?? 1, "A covering") };
    }),
    adjustments: r.adjustments.map((a) => {
      idList([a?.familyId], "A discount");
      return {
        familyId: a.familyId,
        fraction: a.fraction === null || a.fraction === undefined ? null : fraction(a.fraction, "A discount", 5),
        amountCents: a.amountCents === null || a.amountCents === undefined ? null : cents(a.amountCents, "A fixed amount"),
        reason: String(a.reason ?? "").slice(0, 120),
      };
    }),
    prepaid: r.prepaid.map((p) => {
      idList([p?.familyId], "An earlier payment");
      if (!["cash", "venmo", "zelle", "check", "other"].includes(p.method)) throw new Error("Unknown payment method");
      return {
        familyId: p.familyId,
        amountCents: p.amountCents === null || p.amountCents === undefined ? null : cents(p.amountCents, "An earlier payment"),
        fraction: p.fraction === null || p.fraction === undefined ? null : fraction(p.fraction, "An earlier payment"),
        method: p.method,
      };
    }),
    excludedFamilyIds: idList(r.excludedFamilyIds, "Exclusions"),
    notes: (Array.isArray(r.notes) ? r.notes : []).map((n) => String(n).slice(0, 240)).slice(0, 20),
    ambiguities: (Array.isArray(r.ambiguities) ? r.ambiguities : []).map((n) => String(n).slice(0, 240)).slice(0, 20),
  };
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

/**
 * Take one invoice as far as it can go: create the PayPal draft, send it, fetch its QR code.
 * Each step is saved as soon as PayPal confirms it, so a retry resumes where it stopped
 * instead of creating a second PayPal invoice.
 */
async function publishInvoice(invoiceId: string): Promise<void> {
  const gw = gateway();
  const team = readState().team;
  let inv = readState().invoices.find((i) => i.id === invoiceId)!;
  const charge = readState().charges.find((c) => c.id === inv.chargeId)!;
  if (!inv.paypalInvoiceId) {
    const created = await gw.createDraftInvoice(draftInput(inv, charge));
    await mutate((state) => {
      state.invoices.find((x) => x.id === invoiceId)!.paypalInvoiceId = created.paypalInvoiceId;
    });
    inv = readState().invoices.find((i) => i.id === invoiceId)!;
  }
  if (inv.status === "DRAFT") {
    const sent = await gw.sendInvoice(inv.paypalInvoiceId!, {
      subject: `${team.name}: ${charge.title} (${formatCents(inv.amountCents)})`,
      note: `Pay with PayPal, Venmo or card. Questions? Reply to ${team.treasurer}.`,
    });
    await mutate((state) => {
      const row = state.invoices.find((x) => x.id === invoiceId)!;
      row.status = "SENT";
      row.sentAt = new Date().toISOString();
      row.payerViewUrl = sent.payerViewUrl;
    });
  }
  if (!readState().invoices.find((i) => i.id === invoiceId)!.qrCodeDataUrl) {
    const qr = await gw.generateQrCode(inv.paypalInvoiceId!);
    if (qr) await mutate((state) => void (state.invoices.find((x) => x.id === invoiceId)!.qrCodeDataUrl = qr));
  }
}

async function publishAll(invoiceIds: string[]) {
  const failed: { family: string; error: string }[] = [];
  let sent = 0;
  // Small parallel batches: fast for the treasurer, polite to PayPal's rate limits.
  const BATCH = 4;
  for (let i = 0; i < invoiceIds.length; i += BATCH) {
    await Promise.all(
      invoiceIds.slice(i, i + BATCH).map(async (id) => {
        const inv = readState().invoices.find((x) => x.id === id)!;
        const fam = readState().team.families.find((f) => f.id === inv.payerFamilyId)!;
        try {
          await publishInvoice(id);
          sent++;
        } catch (e) {
          failed.push({ family: fam.surname, error: (e as Error).message });
        }
      }),
    );
  }
  return { sent, failed };
}

/**
 * Confirm a preview: store the charge, then create, send and QR-code one PayPal invoice per paying family.
 * `clientKey` makes the call idempotent: a double-click or retried request returns the first charge.
 */
export async function createCharge(rules: ChargeRules, sourceMessage: string, clientKey?: string): Promise<{ chargeId: string; sent: number; failed: { family: string; error: string }[]; duplicate?: boolean }> {
  const preview = buildPreview(rules);
  if (preview.invoices.length === 0) throw new Error("Nobody owes anything on this charge, so there is nothing to send.");
  const key = clientKey?.slice(0, 80) || undefined;
  const chargeId = newId("c");
  const outcome = await mutate((state) => {
    if (key) {
      const existing = state.charges.find((c) => c.clientKey === key);
      if (existing) return { existing: existing.id };
    }
    const stamp = chargeId.split("-").pop()!.toUpperCase();
    const charge: Charge = {
      id: chargeId,
      title: preview.rules.title,
      totalCents: preview.allocation.totalCents,
      dueDate: preview.rules.dueDate,
      createdAt: new Date().toISOString(),
      sourceMessage: sourceMessage.slice(0, 4000),
      rulesSummary: preview.rules.notes,
      warnings: [...preview.rules.ambiguities, ...preview.allocation.warnings],
      lines: preview.allocation.lines,
      absorbedCents: preview.allocation.absorbedCents,
      prepaid: preview.allocation.prepaid,
      roundingCents: preview.allocation.roundingCents,
      clientKey: key,
    };
    state.charges.push(charge);
    // Money already handed to the treasurer is real money in: record it now.
    for (const pp of preview.allocation.prepaid) {
      const fam = state.team.families.find((f) => f.id === pp.familyId)!;
      state.events.push({ id: newId("e"), at: charge.createdAt, type: "payment.offline", summary: `${fam.surname} family paid ${formatCents(pp.amountCents)} ${methodLabel(pp.method)} toward ${charge.title} (recorded by the treasurer)`, amountCents: pp.amountCents, source: "treasurer", ref: chargeId, paypalEventId: null });
    }
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
        // Deterministic per charge + family: PayPal rejects a duplicate invoice number.
        paypalInvoiceNumber: `${state.team.shortName}-${slug(charge.title)}-${slug(fam.surname)}-${stamp}`,
        payerViewUrl: null,
        qrCodeDataUrl: null,
        createdAt: new Date().toISOString(),
        sentAt: null,
        paidAt: null,
        paidVia: null,
        reminders: [],
      });
    }
    return { existing: null };
  });
  if (outcome.existing) {
    const n = readState().invoices.filter((i) => i.chargeId === outcome.existing && i.status !== "DRAFT").length;
    return { chargeId: outcome.existing, sent: n, failed: [], duplicate: true };
  }

  const ids = readState().invoices.filter((i) => i.chargeId === chargeId).map((i) => i.id);
  const { sent, failed } = await publishAll(ids);
  const charge = readState().charges.find((c) => c.id === chargeId)!;
  await mutate((state) => {
    state.events.push({
      id: newId("e"),
      at: new Date().toISOString(),
      type: "charge.created",
      summary: `${charge.title}: ${sent} PayPal invoice${sent === 1 ? "" : "s"} sent${failed.length ? `, ${failed.length} failed` : ""}${charge.absorbedCents ? ` · ${formatCents(charge.absorbedCents)} scholarship covered by the team` : ""}`,
      amountCents: 0,
      source: "treasurer",
      ref: chargeId,
      paypalEventId: null,
    });
  });
  return { chargeId, sent, failed };
}

/** Retry invoices a failed send left behind; resumes each from the step it reached. */
export async function retryDrafts(chargeId: string) {
  if (!readState().charges.some((c) => c.id === chargeId)) throw new Error("Unknown charge");
  const ids = readState().invoices.filter((i) => i.chargeId === chargeId && (i.status === "DRAFT" || (i.status === "SENT" && !i.qrCodeDataUrl))).map((i) => i.id);
  return publishAll(ids);
}

/** A family paid cash or by check: record it on their PayPal invoice so PayPal and the board agree. */
export async function recordOfflinePayment(invoiceId: string, method: "CASH" | "CHECK") {
  const inv = readState().invoices.find((i) => i.id === invoiceId);
  if (!inv?.paypalInvoiceId || inv.status !== "SENT") throw new Error("That invoice is not waiting for payment.");
  rehydrate(inv);
  await gateway().recordPayment(inv.paypalInvoiceId, { method, amountCents: inv.amountCents, date: todayIso(), note: `Recorded by ${readState().team.treasurer} in Sideline` });
  if (gateway().mode === "live") await syncFromPayPal();
}

export function lateInvoices(chargeId?: string) {
  const state = readState();
  return state.invoices.filter((i) => {
    if (i.status !== "SENT") return false;
    if (chargeId && i.chargeId !== chargeId) return false;
    const c = state.charges.find((x) => x.id === i.chargeId);
    // Remind anyone past due (for a charge with no due date, anyone sent 3+ days ago),
    // but never twice in a day.
    const last = i.reminders.at(-1);
    if (last && Date.now() - new Date(last.at).getTime() < 86_400_000) return false;
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
  const team = readState().team;
  // Claim the game before any network call, so a double-click or a second tab can't pay the referee twice.
  const claim = await mutate((s) => {
    const g = s.games.find((x) => x.id === gameId);
    if (!g) throw new Error("Unknown game");
    if (g.payout) throw new Error("This game is already final and the referee was paid.");
    if (new Date(g.date).getTime() > Date.now() + 3 * 3600_000) throw new Error("That game hasn't been played yet.");
    const ref = s.team.referees.find((r) => r.id === g.refereeId)!;
    g.payout = { batchId: "", itemId: null, status: "PROCESSING", amountCents: ref.feeCents, createdAt: new Date().toISOString(), paidAt: null };
    return { ref, opponent: g.opponent };
  });
  try {
    const payout = await gateway().createPayout({
      // One payout per game, ever: PayPal rejects a reused sender_batch_id.
      senderBatchId: `${team.shortName}-${team.id}-${gameId}`.slice(0, 127),
      emailSubject: `${team.name} referee fee`,
      emailMessage: `Thanks for reffing ${team.name} vs ${claim.opponent}!`,
      items: [{ receiverEmail: claim.ref.email, amountCents: claim.ref.feeCents, note: `Referee fee: vs ${claim.opponent}`, senderItemId: gameId }],
    });
    await mutate((s) => {
      const g = s.games.find((x) => x.id === gameId)!;
      g.status = "final";
      g.score = score;
      g.payout = { ...g.payout!, batchId: payout.batchId, status: g.payout?.status === "SUCCESS" ? "SUCCESS" : "PENDING" };
      s.events.push({ id: newId("e"), at: new Date().toISOString(), type: "payout.created", summary: `Final ${score.us}-${score.them} vs ${g.opponent}: paying referee ${claim.ref.name}`, amountCents: 0, source: "treasurer", ref: payout.batchId, paypalEventId: null });
    });
    return { batchId: payout.batchId };
  } catch (e) {
    await mutate((s) => {
      const g = s.games.find((x) => x.id === gameId)!;
      if (g.payout?.status === "PROCESSING") g.payout = null;
    });
    throw e;
  }
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
export async function simulatePayment(invoiceId: string, method: "PAYPAL" | "VENMO" | "CARD" = "PAYPAL") {
  const sim = simulator();
  if (!sim) throw new Error("Simulated payments are only available without PayPal credentials. Pay through the real PayPal link instead.");
  const inv = readState().invoices.find((i) => i.id === invoiceId);
  if (!inv?.paypalInvoiceId) throw new Error("That invoice has not been sent yet.");
  rehydrate(inv);
  await sim.payInvoice(inv.paypalInvoiceId, method);
}

export async function simulatePaymentByPayPalId(paypalInvoiceId: string, method: "PAYPAL" | "VENMO" | "CARD" = "PAYPAL") {
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
