import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, invoicesFor, splitExact, type ChargeRules } from "../src/lib/ledger/allocate.ts";
import { seedTeam } from "../src/lib/seed.ts";

const team = seedTeam();
const fams = team.families;
const id = (surname: string) => fams.find((f) => f.surname === surname)!.id;

function rules(over: Partial<ChargeRules>): ChargeRules {
  return {
    title: "Fresno Tournament",
    amountKind: "team_total",
    amountCents: 45000,
    splitBasis: "player",
    dueDate: null,
    scholarshipFamilyIds: [],
    scholarshipPolicy: "team_absorbs",
    coverings: [],
    customAmounts: [],
    excludedFamilyIds: [],
    notes: [],
    ambiguities: [],
    ...over,
  };
}

test("splitExact always sums to the total", () => {
  for (const total of [1, 99, 45000, 45001, 123457]) {
    for (const w of [[1, 1, 1], [2, 1, 1, 1, 1, 1, 1], [3, 7]]) {
      assert.equal(splitExact(total, w).reduce((a, b) => a + b, 0), total);
    }
  }
});

test("team total, per player, scholarship absorbed by the team, one family covering another", () => {
  const a = allocate(
    rules({ scholarshipFamilyIds: [id("Ortiz")], coverings: [{ payerFamilyId: id("Garcia"), coveredFamilyId: id("Nguyen") }] }),
    fams,
  );
  assert.equal(a.totalCents, 45000);
  const players = fams.reduce((n, f) => n + f.players.length, 0);
  const ortiz = a.lines.find((l) => l.familyId === id("Ortiz"))!;
  assert.equal(ortiz.payerFamilyId, null);
  assert.equal(a.absorbedCents, ortiz.amountCents);
  assert.ok(Math.abs(ortiz.amountCents - Math.round(45000 / players)) <= 1);
  const inv = invoicesFor({ title: "Fresno", lines: a.lines }, fams);
  const garcia = inv.find((i) => i.payerFamilyId === id("Garcia"))!;
  assert.equal(garcia.items.length, 2);
  assert.ok(!inv.some((i) => i.payerFamilyId === id("Nguyen")));
  assert.equal(inv.reduce((s, i) => s + i.amountCents, 0) + a.absorbedCents, 45000);
});

test("scholarship split among the others still sums to the total", () => {
  const a = allocate(rules({ scholarshipFamilyIds: [id("Ortiz")], scholarshipPolicy: "split_among_others" }), fams);
  assert.equal(a.absorbedCents, 0);
  const inv = invoicesFor({ title: "x", lines: a.lines }, fams);
  assert.equal(inv.reduce((s, i) => s + i.amountCents, 0), 45000);
});

test("per family amount with an excluded family and a custom amount", () => {
  const a = allocate(
    rules({
      amountKind: "per_family",
      amountCents: 6500,
      excludedFamilyIds: [id("Lee")],
      customAmounts: [{ familyId: id("Singh"), amountCents: 3250, reason: "Half price, joined late" }],
    }),
    fams,
  );
  assert.equal(a.lines.find((l) => l.familyId === id("Lee"))!.reason, "excluded");
  assert.equal(a.lines.find((l) => l.familyId === id("Singh"))!.amountCents, 3250);
  assert.equal(a.totalCents, 6500 * (fams.length - 2) + 3250);
});

test("unknown ids, self-cover, double cover and a cover chain are handled", () => {
  const a = allocate(
    rules({
      coverings: [
        { payerFamilyId: "nope", coveredFamilyId: id("Lee") },
        { payerFamilyId: id("Lee"), coveredFamilyId: id("Lee") },
        { payerFamilyId: id("Garcia"), coveredFamilyId: id("Nguyen") },
        { payerFamilyId: id("Nguyen"), coveredFamilyId: id("Vang") },
        { payerFamilyId: id("Singh"), coveredFamilyId: id("Nguyen") },
      ],
    }),
    fams,
  );
  assert.ok(a.warnings.some((w) => w.includes("unknown")));
  assert.ok(a.warnings.some((w) => w.includes("covered twice")));
  assert.equal(a.lines.find((l) => l.familyId === id("Vang"))!.payerFamilyId, id("Garcia"));
  assert.equal(a.totalCents, 45000);
});

test("custom amounts above the total do not create negative shares", () => {
  const a = allocate(rules({ amountCents: 1000, customAmounts: [{ familyId: id("Singh"), amountCents: 5000, reason: "x" }] }), fams);
  assert.ok(a.lines.every((l) => l.amountCents >= 0));
  assert.ok(a.warnings.length > 0);
});

test("a family listed as both scholarship and excluded stays on as a team-covered scholarship", () => {
  const a = allocate(rules({ scholarshipFamilyIds: [id("Ortiz")], excludedFamilyIds: [id("Ortiz")] }), fams);
  const ortiz = a.lines.find((l) => l.familyId === id("Ortiz"))!;
  assert.equal(ortiz.reason, "scholarship");
  assert.ok(a.absorbedCents > 0);
  assert.equal(a.totalCents, 45000);
});
