import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/seed.ts";
import { teamSummary } from "../src/lib/summary.ts";
import { studioTables } from "../src/lib/studio/tables.ts";
import { recordTokens, takeTurnBudget, toResponsesInput, visitor } from "../src/lib/studio/llm.ts";
import { allocate, invoicesFor, type ChargeRules } from "../src/lib/ledger/allocate.ts";
import type { AppState, Charge, Invoice } from "../src/lib/types.ts";

const cents = (dollars: number) => Math.round(dollars * 100);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("studio tables reconcile with the ledger to the cent", () => {
  const state = seedState();
  const s = teamSummary(state);
  const t = studioTables(state, "simulator");
  // Every dollar in the ledger table is a dollar in the team account.
  assert.equal(cents(sum(t.ledger.map((r) => r.amount))), s.balanceCents);
  assert.equal(cents(sum(t.ledger.map((r) => r.money_out))), s.moneyOutCents);
  // The Spending table is the ledger's money-out entries, nothing more and nothing less.
  assert.equal(cents(sum(t.spending.map((r) => r.amount))), s.moneyOutCents);
  assert.ok(t.spending.every((r) => r.amount > 0));
  // What families still owe on the dashboard is what the board says is outstanding.
  assert.equal(cents(sum(t.dues.map((r) => r.outstanding))), s.outstandingCents);
  assert.equal(cents(sum(t.dues.map((r) => r.team_covered))), s.absorbedCents);
  assert.equal(cents(sum(t.dues.map((r) => r.collected))), sum(s.charges.map((c) => c.collectedCents)));
});

test("a family past its due date is Late, a scholarship is Team fund, and a paid one is Paid", () => {
  const t = studioTables(seedState(), "simulator");
  const by = (family: string) => t.dues.find((r) => r.family === family)!;
  assert.equal(by("Vang").status, "Late");
  assert.ok(by("Vang").days_late > 0);
  assert.equal(by("Vang").paid_via, "Not paid yet");
  assert.equal(by("Ortiz").status, "Team fund");
  assert.equal(by("Ortiz").outstanding, 0);
  assert.equal(by("Garcia").status, "Paid");
  assert.equal(by("Garcia").paid_via, "PayPal");
  // One row per family per charge, each with a unique key (Studio's primary key).
  assert.equal(new Set(t.dues.map((r) => r.id)).size, t.dues.length);
  assert.equal(t.dues.length, 14);
});

test("money paid outside PayPal before invoicing is credited to that family, not lost", () => {
  const state = seedState();
  const chen = state.team.families.find((f) => f.id === "f-chen")!;
  state.charges.push({
    id: "c-test",
    title: "Tournament",
    totalCents: 4000,
    dueDate: null,
    createdAt: new Date().toISOString(),
    sourceMessage: "",
    rulesSummary: [],
    warnings: [],
    lines: [{ familyId: chen.id, payerFamilyId: chen.id, amountCents: 4000, reason: "share", note: "" }],
    absorbedCents: 0,
    prepaid: [{ familyId: chen.id, amountCents: 4000, method: "cash" }],
  });
  const row = studioTables(state, "simulator").dues.find((r) => r.id === "c-test|f-chen")!;
  assert.equal(row.status, "Paid");
  assert.equal(row.collected, 40);
  assert.equal(row.paid_via, "Cash");
  assert.equal(row.outstanding, 0);
});

test("referee payouts show as paid by PayPal only once the payout succeeded", () => {
  const t = studioTables(seedState(), "simulator");
  assert.deepEqual(
    t.games.map((g) => g.payout),
    ["Paid by PayPal", "Paid by PayPal", "Not yet", "Not yet", "Not yet"],
  );
  assert.equal(sum(t.games.map((g) => g.paid_out)), 90);
});

test("studio conversation items map onto Responses API input items", () => {
  const input = toResponsesInput([
    { type: "message", role: "user", content: [{ type: "text", text: "Who still owes?" }] },
    { type: "reasoning", id: "rs_1", summary: [] },
    { type: "function_call", callId: "call_1", name: "list_invoices", arguments: '{"status":"SENT"}' },
    { type: "function_call_output", callId: "call_1", output: "[]" },
    { type: "message", role: "assistant", content: [{ type: "text", text: "Nobody." }] },
    { type: "message", role: "system", content: [{ type: "text", text: "Be brief." }] },
    { type: "message", role: "user", content: [] },
  ]);
  assert.deepEqual(input, [
    { role: "user", content: "Who still owes?" },
    { type: "function_call", call_id: "call_1", name: "list_invoices", arguments: '{"status":"SENT"}' },
    { type: "function_call_output", call_id: "call_1", output: "[]" },
    { role: "assistant", content: "Nobody." },
    { role: "developer", content: "Be brief." },
  ]);
});

/** A charge built the way the app builds one: the money engine's lines, one invoice per payer. */
function engineCharge(state: AppState, over: Partial<ChargeRules>): Charge {
  const rules: ChargeRules = {
    title: "Pizza party",
    amountKind: "per_player",
    amountCents: 4000,
    splitBasis: "player",
    dueDate: null,
    scholarshipFamilyIds: [],
    scholarshipPolicy: "team_absorbs",
    coverings: [],
    adjustments: [],
    prepaid: [],
    excludedFamilyIds: [],
    notes: [],
    ambiguities: [],
    ...over,
  };
  const a = allocate(rules, state.team.families);
  const charge: Charge = {
    id: "c-engine",
    title: rules.title,
    totalCents: a.totalCents,
    dueDate: null,
    createdAt: new Date().toISOString(),
    sourceMessage: "",
    rulesSummary: [],
    warnings: [],
    lines: a.lines,
    absorbedCents: a.absorbedCents,
    absorbedByFamily: a.absorbedByFamily,
    prepaid: a.prepaid,
  };
  state.charges.push(charge);
  for (const inv of invoicesFor({ title: charge.title, lines: a.lines, prepaid: a.prepaid }, state.team.families)) {
    state.invoices.push({ id: `i-engine-${inv.payerFamilyId}`, chargeId: charge.id, payerFamilyId: inv.payerFamilyId, items: inv.items, amountCents: inv.amountCents, status: "SENT", paypalInvoiceId: "X", paypalInvoiceNumber: "N", payerViewUrl: null, qrCodeDataUrl: null, createdAt: charge.createdAt, sentAt: charge.createdAt, paidAt: null, paidVia: null, reminders: [] } satisfies Invoice);
  }
  return charge;
}

test("a charge from the money engine keeps its scholarship, covered and discounted families on the dashboard", () => {
  const state = seedState();
  const charge = engineCharge(state, {
    scholarshipFamilyIds: ["f-ortiz"],
    coverings: [{ payerFamilyId: "f-lee", coveredFamilyId: "f-kaur", fraction: 1 }],
    adjustments: [{ familyId: "f-miller", fraction: 0.5, amountCents: null, reason: "Half price" }],
    prepaid: [{ familyId: "f-garcia", amountCents: 1000, method: "cash" }],
    excludedFamilyIds: ["f-chen"],
  });
  const rows = studioTables(state, "simulator").dues.filter((r) => r.id.startsWith("c-engine|"));
  const by = (family: string) => rows.find((r) => r.family === family);
  // Everyone on the charge has a row; the family that is not taking part has none.
  assert.equal(rows.length, 13);
  assert.equal(by("Chen"), undefined);
  // Scholarship: no invoice, the team fund covers the whole share.
  assert.equal(by("Ortiz")!.status, "Team fund");
  assert.equal(by("Ortiz")!.team_covered, 40);
  assert.equal(by("Ortiz")!.billed, 0);
  // Fully covered by another family: on the bench, owing nothing, and the payer carries both shares.
  assert.equal(by("Kaur")!.status, "Covered");
  assert.equal(by("Kaur")!.paid_via, "Covered by the Lee family");
  assert.equal(by("Lee")!.outstanding, 80);
  // Half price: the family owes half, the team fund covers the other half.
  assert.equal(by("Miller")!.outstanding, 20);
  assert.equal(by("Miller")!.team_covered, 20);
  // Cash before invoicing is collected money; the rest is still owed.
  assert.equal(by("Garcia")!.collected, 10);
  assert.equal(by("Garcia")!.outstanding, 30);
  // The dashboard's totals are the engine's totals, to the cent.
  assert.equal(cents(sum(rows.map((r) => r.team_covered))), charge.absorbedCents);
  assert.equal(cents(sum(rows.map((r) => r.billed)) + sum(rows.map((r) => r.team_covered))), charge.totalCents);
  const s = teamSummary(state);
  const all = studioTables(state, "simulator").dues;
  assert.equal(cents(sum(all.map((r) => r.team_covered))), s.absorbedCents);
  assert.equal(cents(sum(all.map((r) => r.outstanding))), s.outstandingCents);
});

test("a tool call without its result, or a result without its call, never reaches the model", () => {
  const input = toResponsesInput([
    { type: "message", role: "user", content: [{ type: "text", text: "Chart it" }] },
    { type: "function_call", callId: "cancelled", name: "add_widget", arguments: "{}" },
    { type: "function_call_output", callId: "orphan", output: "ok" },
    { type: "function_call", callId: "good", name: "view_schema", arguments: "{}" },
    { type: "function_call_output", callId: "good", output: "{}" },
  ]);
  assert.deepEqual(
    input.map((i) => ("call_id" in i ? `${i.type}:${i.call_id}` : "message")),
    ["message", "function_call:good", "function_call_output:good"],
  );
});

test("one visitor cannot use up everyone's AI turns, and the budget recovers", () => {
  const t0 = 1_800_000_000_000;
  let refused = 0;
  for (let i = 0; i < 200; i++) {
    try {
      takeTurnBudget("203.0.113.9", t0 + i);
    } catch {
      refused++;
    }
  }
  assert.equal(refused, 140, "a burst of 200 turns from one address is cut at 60 a minute");
  // Another visitor is still served in the same minute...
  assert.doesNotThrow(() => takeTurnBudget("198.51.100.7", t0 + 500));
  // ...and the first one is served again a minute later.
  assert.doesNotThrow(() => takeTurnBudget("203.0.113.9", t0 + 61_000));
  // A batch (one nudge per late family) is all or nothing.
  assert.throws(() => takeTurnBudget("192.0.2.1", t0 + 62_000, 61));
  assert.doesNotThrow(() => takeTurnBudget("192.0.2.1", t0 + 62_000, 3));
});

test("the daily token cap stops the agents until the next day", () => {
  const day = Date.UTC(2031, 0, 5, 12);
  recordTokens(40_000_000, day);
  assert.throws(() => takeTurnBudget("203.0.113.50", day + 1000), /today/);
  assert.doesNotThrow(() => takeTurnBudget("203.0.113.50", day + 86_400_000));
});

test("the visitor is the address the nearest proxy saw, not one the client wrote", () => {
  const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
  assert.equal(visitor(req({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" })), "203.0.113.9");
  assert.equal(visitor(req({ "x-real-ip": "198.51.100.7" })), "198.51.100.7");
  assert.equal(visitor(req({})), "local");
});
