import { test } from "node:test";
import assert from "node:assert/strict";
import { seedState } from "../src/lib/seed.ts";
import { teamSummary } from "../src/lib/summary.ts";
import { studioTables } from "../src/lib/studio/tables.ts";
import { toResponsesInput, takeTurnBudget } from "../src/lib/studio/llm.ts";

const cents = (dollars: number) => Math.round(dollars * 100);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

test("studio tables reconcile with the ledger to the cent", () => {
  const state = seedState();
  const s = teamSummary(state);
  const t = studioTables(state, "simulator");
  // Every dollar in the ledger table is a dollar in the team account.
  assert.equal(cents(sum(t.ledger.map((r) => r.amount))), s.balanceCents);
  assert.equal(cents(sum(t.ledger.map((r) => r.money_out))), s.moneyOutCents);
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

test("the AI turn budget refuses a flood and recovers a minute later", () => {
  const t0 = 1_800_000_000_000;
  let refused = 0;
  for (let i = 0; i < 200; i++) {
    try {
      takeTurnBudget(t0 + i);
    } catch {
      refused++;
    }
  }
  assert.ok(refused > 0, "a burst of 200 turns in 200ms must hit the per-minute cap");
  assert.doesNotThrow(() => takeTurnBudget(t0 + 61_000));
});
