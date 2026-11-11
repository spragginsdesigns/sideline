import { test } from "node:test";
import assert from "node:assert/strict";
import { allocate, invoicesFor, splitExact, type ChargeRules } from "../src/lib/ledger/allocate.ts";
import { seedTeam } from "../src/lib/seed.ts";

const team = seedTeam();
const fams = team.families;
const id = (surname: string) => fams.find((f) => f.surname === surname)!.id;
const players = fams.reduce((n, f) => n + f.players.length, 0); // 16

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
    adjustments: [],
    prepaid: [],
    excludedFamilyIds: [],
    notes: [],
    ambiguities: [],
    ...over,
  };
}
const invoiced = (a: ReturnType<typeof allocate>) => invoicesFor({ title: "x", lines: a.lines, prepaid: a.prepaid }, fams);
/** Every cent is accounted for: invoiced + already paid + team-covered = total share. */
function balanced(a: ReturnType<typeof allocate>) {
  const inv = invoiced(a).reduce((s, i) => s + i.amountCents, 0);
  assert.equal(inv, a.invoicedCents);
  assert.equal(inv + a.prepaidCents + a.absorbedCents, a.totalCents);
}

test("splitExact always sums to the total", () => {
  for (const total of [1, 99, 45000, 45001, 123457]) for (const w of [[1, 1, 1], [2, 1, 1, 1, 1, 1, 1], [3, 7]]) assert.equal(splitExact(total, w).reduce((a, b) => a + b, 0), total);
});

test("every player pays the same amount; rounding goes to the team fund", () => {
  const a = allocate(rules({}), fams);
  assert.equal(a.perUnitCents, Math.ceil(45000 / players));
  assert.equal(a.totalCents, 45000 + a.roundingCents);
  assert.ok(a.roundingCents >= 0 && a.roundingCents < players);
  const singles = invoiced(a).filter((i) => fams.find((f) => f.id === i.payerFamilyId)!.players.length === 1);
  assert.equal(new Set(singles.map((i) => i.amountCents)).size, 1);
  balanced(a);
});

test("scholarship absorbed by the team, one family covering another", () => {
  const a = allocate(rules({ scholarshipFamilyIds: [id("Ortiz")], coverings: [{ payerFamilyId: id("Garcia"), coveredFamilyId: id("Nguyen"), fraction: 1 }] }), fams);
  assert.equal(a.absorbedCents, a.perUnitCents);
  const inv = invoiced(a);
  assert.equal(inv.find((i) => i.payerFamilyId === id("Garcia"))!.items.length, 2);
  assert.ok(!inv.some((i) => i.payerFamilyId === id("Nguyen")));
  assert.ok(!inv.some((i) => i.payerFamilyId === id("Ortiz")));
  balanced(a);
});

test("scholarship split among the others", () => {
  const a = allocate(rules({ scholarshipFamilyIds: [id("Ortiz")], scholarshipPolicy: "split_among_others" }), fams);
  assert.equal(a.absorbedCents, 0);
  assert.equal(a.perUnitCents, Math.ceil(45000 / (players - 1)));
  balanced(a);
});

test("half price is half of that family's own share (two players)", () => {
  const a = allocate(rules({ amountKind: "per_player", amountCents: 3750, adjustments: [{ familyId: id("Reyes"), fraction: 0.5, amountCents: null, reason: "Half price" }] }), fams);
  assert.equal(invoiced(a).find((i) => i.payerFamilyId === id("Reyes"))!.amountCents, 3750);
  assert.equal(a.absorbedCents, 3750);
  balanced(a);
});

test("cash already paid stays on the charge and reduces only that family's invoice", () => {
  const a = allocate(rules({ amountKind: "per_family", amountCents: 6000, prepaid: [{ familyId: id("Chen"), amountCents: 4000, method: "cash" }, { familyId: id("Lee"), amountCents: null, method: "venmo" }] }), fams);
  const inv = invoiced(a);
  assert.equal(inv.find((i) => i.payerFamilyId === id("Chen"))!.amountCents, 2000);
  assert.ok(!inv.some((i) => i.payerFamilyId === id("Lee")), "fully prepaid family gets no invoice");
  assert.equal(inv.find((i) => i.payerFamilyId === id("Garcia"))!.amountCents, 6000, "others are not charged more");
  assert.equal(a.prepaidCents, 10000);
  balanced(a);
});

test("covering half of another family's share", () => {
  const a = allocate(rules({ amountKind: "per_family", amountCents: 9230, coverings: [{ payerFamilyId: id("Singh"), coveredFamilyId: id("Vang"), fraction: 0.5 }] }), fams);
  const inv = invoiced(a);
  assert.equal(inv.find((i) => i.payerFamilyId === id("Singh"))!.amountCents, 9230 + 4615);
  assert.equal(inv.find((i) => i.payerFamilyId === id("Vang"))!.amountCents, 4615);
  balanced(a);
});

test("a family listed as both scholarship and excluded stays on as a scholarship", () => {
  const a = allocate(rules({ scholarshipFamilyIds: [id("Ortiz")], excludedFamilyIds: [id("Ortiz")] }), fams);
  assert.equal(a.lines.find((l) => l.familyId === id("Ortiz"))!.reason, "scholarship");
  assert.ok(a.absorbedCents > 0);
  balanced(a);
});

test("unknown ids, self-cover, double cover and a cover chain are handled", () => {
  const a = allocate(
    rules({
      coverings: [
        { payerFamilyId: "nope", coveredFamilyId: id("Lee"), fraction: 1 },
        { payerFamilyId: id("Lee"), coveredFamilyId: id("Lee"), fraction: 1 },
        { payerFamilyId: id("Garcia"), coveredFamilyId: id("Nguyen"), fraction: 1 },
        { payerFamilyId: id("Nguyen"), coveredFamilyId: id("Vang"), fraction: 1 },
        { payerFamilyId: id("Singh"), coveredFamilyId: id("Nguyen"), fraction: 1 },
      ],
    }),
    fams,
  );
  assert.ok(a.warnings.some((w) => w.includes("covered twice")));
  assert.equal(a.lines.find((l) => l.familyId === id("Vang"))!.payerFamilyId, id("Garcia"));
  balanced(a);
});

test("an excluded family pays nothing and does not raise anyone else's share when amounts are per player", () => {
  const a = allocate(rules({ amountKind: "per_player", amountCents: 1200, excludedFamilyIds: [id("Chen")] }), fams);
  assert.ok(!invoiced(a).some((i) => i.payerFamilyId === id("Chen")));
  assert.equal(invoiced(a).find((i) => i.payerFamilyId === id("Garcia"))!.amountCents, 1200);
  balanced(a);
});

test("prepaid more than the share is capped with a warning", () => {
  const a = allocate(rules({ amountKind: "per_family", amountCents: 3000, prepaid: [{ familyId: id("Lor"), amountCents: 5000, method: "zelle" }] }), fams);
  assert.ok(a.warnings.some((w) => w.includes("more than")));
  balanced(a);
});

test("paid half in cash credits half of that family's own bill (two players)", () => {
  const a = allocate(rules({ amountKind: "per_player", amountCents: 3750, prepaid: [{ familyId: id("Reyes"), amountCents: null, fraction: 0.5, method: "cash" }] }), fams);
  assert.equal(invoiced(a).find((i) => i.payerFamilyId === id("Reyes"))!.amountCents, 3750);
  assert.equal(a.prepaidCents, 3750);
  balanced(a);
});
