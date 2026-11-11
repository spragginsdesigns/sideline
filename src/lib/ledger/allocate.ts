// Deterministic money engine. The AI only *reads* the coach's message into
// ChargeRules (who, what kind of rule, which fraction); every dollar is computed
// here, in integer cents, so the result is exact, explainable and repeatable.
import type { Charge, ChargeLine, Family, InvoiceItem, PrepaidMethod } from "../types.ts";

export interface ChargeRules {
  title: string;
  amountKind: "team_total" | "per_family" | "per_player";
  amountCents: number;
  splitBasis: "family" | "player"; // only used for team_total
  dueDate: string | null;
  scholarshipFamilyIds: string[];
  scholarshipPolicy: "team_absorbs" | "split_among_others";
  /** payer covers `fraction` (0..1] of covered's share. */
  coverings: { payerFamilyId: string; coveredFamilyId: string; fraction: number }[];
  /** A family pays a fraction of its share ("half") or a fixed amount; the team fund covers any difference. */
  adjustments: { familyId: string; fraction: number | null; amountCents: number | null; reason: string }[];
  /** Money already handed over outside PayPal (cash, Venmo, Zelle...). amountCents null = the whole share. */
  prepaid: { familyId: string; amountCents: number | null; fraction?: number | null; method: PrepaidMethod }[];
  excludedFamilyIds: string[]; // not taking part at all (injured, not going)
  notes: string[]; // human-readable rules the AI applied
  ambiguities: string[]; // things the treasurer should double-check
}

export interface Allocation {
  lines: ChargeLine[];
  shareCents: Record<string, number>; // each participating family's share before covers/prepaid
  totalCents: number; // sum of every share (stated total plus rounding)
  absorbedCents: number; // the team fund covers this (scholarships, discounts)
  absorbedByFamily: Record<string, number>; // the same cents, by the family they were absorbed for
  prepaid: { familyId: string; amountCents: number; method: PrepaidMethod }[];
  prepaidCents: number;
  invoicedCents: number;
  roundingCents: number; // pennies added by rounding the per-player share up to a whole cent
  surplusCents: number; // extra paid above a normal share (a family chipping in more), goes to the team fund
  perUnitCents: number | null;
  warnings: string[];
}

function units(f: Family, basis: "family" | "player"): number {
  return basis === "player" ? Math.max(1, f.players.length) : 1;
}

/** Split `total` across weights so that the parts are whole cents and sum exactly to total. */
export function splitExact(totalCents: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0 || totalCents <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * w) / sumW);
  const floors = raw.map(Math.floor);
  let leftover = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }
  return floors;
}

const clampFraction = (f: number, max = 1) => (Number.isFinite(f) ? Math.min(max, Math.max(0, f)) : 1);

export function allocate(rules: ChargeRules, families: Family[]): Allocation {
  const warnings: string[] = [];
  const byId = new Map(families.map((f) => [f.id, f]));
  const name = (id: string) => byId.get(id)?.surname ?? id;
  const known = (id: string) => byId.has(id);

  // A scholarship family is on the charge (the team pays for them), so it wins over an exclusion.
  const scholarship = new Set(rules.scholarshipFamilyIds.filter(known));
  const excluded = new Set(rules.excludedFamilyIds.filter((id) => known(id) && !scholarship.has(id)));
  const participants = families.filter((f) => !excluded.has(f.id));

  // 1. Each participating family's share.
  const share = new Map<string, number>();
  let perUnit: number | null = null;
  let rounding = 0;
  if (rules.amountKind === "team_total") {
    const payingUnits = participants
      .filter((f) => !(rules.scholarshipPolicy === "split_among_others" && scholarship.has(f.id)))
      .reduce((a, f) => a + units(f, rules.splitBasis), 0);
    if (payingUnits > 0) {
      // Everyone pays the same per-player (or per-family) amount, rounded UP to a whole cent;
      // the few cents of rounding go to the team fund, so no parent pays a penny more than another.
      perUnit = Math.ceil(rules.amountCents / payingUnits);
      rounding = perUnit * payingUnits - rules.amountCents;
    } else if (rules.amountCents > 0) {
      warnings.push("No family is left to pay this charge.");
    }
    for (const f of participants) {
      const zero = rules.scholarshipPolicy === "split_among_others" && scholarship.has(f.id);
      share.set(f.id, zero ? 0 : (perUnit ?? 0) * units(f, rules.splitBasis));
    }
  } else {
    perUnit = rules.amountCents;
    const basis = rules.amountKind === "per_player" ? "player" : "family";
    for (const f of participants) share.set(f.id, rules.amountCents * units(f, basis));
    if (rules.scholarshipPolicy === "split_among_others") {
      // The other families split the scholarship families' shares between them.
      const others = participants.filter((f) => !scholarship.has(f.id));
      const extra = participants.filter((f) => scholarship.has(f.id)).reduce((a, f) => a + (share.get(f.id) ?? 0), 0);
      const parts = splitExact(extra, others.map((f) => units(f, basis)));
      others.forEach((f, i) => share.set(f.id, (share.get(f.id) ?? 0) + parts[i]));
      for (const f of participants) if (scholarship.has(f.id)) share.set(f.id, 0);
      if (extra > 0 && others.length === 0) warnings.push("No family is left to share the scholarship.");
    }
  }

  // 2. What each family itself owes after scholarships and adjustments; the team fund absorbs the rest.
  const owes = new Map<string, number>();
  const ownNote = new Map<string, string>();
  let absorbed = 0;
  const absorbedBy = new Map<string, number>();
  let surplus = 0;
  const adjusted = new Map<string, ChargeRules["adjustments"][number]>();
  for (const a of rules.adjustments) {
    if (!known(a.familyId) || excluded.has(a.familyId)) continue;
    if (scholarship.has(a.familyId)) {
      warnings.push(`The ${name(a.familyId)} family is on scholarship, so their discount was ignored.`);
      continue;
    }
    if (adjusted.has(a.familyId)) warnings.push(`The ${name(a.familyId)} family had two discounts; kept the last one.`);
    adjusted.set(a.familyId, a);
  }
  for (const f of participants) {
    const s = share.get(f.id) ?? 0;
    if (scholarship.has(f.id)) {
      owes.set(f.id, 0);
      if (rules.scholarshipPolicy === "team_absorbs") {
        absorbed += s;
        if (s > 0) absorbedBy.set(f.id, s);
      }
      ownNote.set(f.id, rules.scholarshipPolicy === "team_absorbs" ? "Scholarship: the team fund covers it" : "Scholarship: no charge");
      continue;
    }
    const a = adjusted.get(f.id);
    if (!a) {
      owes.set(f.id, s);
      continue;
    }
    let pay = s;
    if (a.fraction !== null && a.fraction !== undefined) pay = Math.round(s * clampFraction(a.fraction, 5));
    else if (a.amountCents !== null && a.amountCents !== undefined) pay = Math.max(0, Math.round(a.amountCents));
    if (pay > s * 3 && s > 0) warnings.push(`The ${f.surname} family's amount (${(pay / 100).toFixed(2)}) is over three times a normal share. Double-check it.`);
    absorbed += Math.max(0, s - pay);
    if (s - pay > 0) absorbedBy.set(f.id, s - pay);
    surplus += Math.max(0, pay - s);
    owes.set(f.id, pay);
    ownNote.set(f.id, `${a.reason || "Adjusted"}${pay < s ? `: the team fund covers the other ${((s - pay) / 100).toFixed(2)}` : pay > s ? `: ${((pay - s) / 100).toFixed(2)} extra goes to the team fund` : ""}`);
  }

  // 3. Who pays for whom. Full covers chain (A covers B, B covers C => A pays C); partial covers split the share.
  const covers = new Map<string, { payer: string; fraction: number }>();
  for (const c of rules.coverings) {
    if (!known(c.payerFamilyId) || !known(c.coveredFamilyId) || c.payerFamilyId === c.coveredFamilyId) continue;
    if (excluded.has(c.payerFamilyId)) {
      warnings.push(`The ${name(c.payerFamilyId)} family is not on this charge, so they cannot cover anyone.`);
      continue;
    }
    if (excluded.has(c.coveredFamilyId) || scholarship.has(c.coveredFamilyId)) continue;
    if (covers.has(c.coveredFamilyId)) {
      warnings.push(`The ${name(c.coveredFamilyId)} family was covered twice; kept the first.`);
      continue;
    }
    covers.set(c.coveredFamilyId, { payer: c.payerFamilyId, fraction: clampFraction(c.fraction ?? 1) });
  }
  const fullPayer = (id: string): string => {
    const seen = new Set<string>();
    let cur = id;
    while (covers.get(cur)?.fraction === 1 && !seen.has(cur)) {
      seen.add(cur);
      cur = covers.get(cur)!.payer;
    }
    return cur;
  };

  const lines: ChargeLine[] = [];
  for (const f of families) {
    if (excluded.has(f.id)) {
      lines.push({ familyId: f.id, payerFamilyId: null, amountCents: 0, reason: "excluded", note: "Not on this charge" });
      continue;
    }
    const amount = owes.get(f.id) ?? 0;
    if (scholarship.has(f.id)) {
      lines.push({ familyId: f.id, payerFamilyId: null, amountCents: 0, reason: "scholarship", note: ownNote.get(f.id)! });
      continue;
    }
    const reason = adjusted.has(f.id) ? "adjusted" : "share";
    const cover = covers.get(f.id);
    if (cover && cover.fraction < 1) {
      const coveredPart = Math.round(amount * cover.fraction);
      const payer = fullPayer(cover.payer);
      lines.push({ familyId: f.id, payerFamilyId: payer, amountCents: coveredPart, reason: "covered", note: `${Math.round(cover.fraction * 100)}% covered by the ${name(payer)} family` });
      lines.push({ familyId: f.id, payerFamilyId: f.id, amountCents: amount - coveredPart, reason, note: ownNote.get(f.id) ?? "" });
      continue;
    }
    const payer = fullPayer(f.id);
    lines.push({
      familyId: f.id,
      payerFamilyId: payer,
      amountCents: amount,
      reason: payer !== f.id ? "covered" : reason,
      note: payer !== f.id ? `Covered by the ${name(payer)} family` : ownNote.get(f.id) ?? "",
    });
  }

  // 4. Money already handed over outside PayPal reduces what the payer is invoiced.
  const billOf = (payer: string) => lines.filter((l) => l.payerFamilyId === payer).reduce((a, l) => a + l.amountCents, 0);
  const prepaid: Allocation["prepaid"] = [];
  // A family can pay in several pieces (cash and Venmo): add them up per family, then cap at the bill.
  const byFamily = new Map<string, { amount: number; method: PrepaidMethod }>();
  for (const p of rules.prepaid) {
    if (!known(p.familyId) || excluded.has(p.familyId)) continue;
    const bill = billOf(p.familyId);
    if (bill === 0) {
      if (covers.has(p.familyId)) warnings.push(`The ${name(p.familyId)} family already paid, but someone else is covering them. Check who should get the credit.`);
      continue;
    }
    const amt =
      p.amountCents !== null && p.amountCents !== undefined
        ? Math.round(p.amountCents)
        : p.fraction !== null && p.fraction !== undefined
          ? Math.round(bill * clampFraction(p.fraction))
          : bill;
    const prev = byFamily.get(p.familyId);
    byFamily.set(p.familyId, { amount: (prev?.amount ?? 0) + amt, method: prev && prev.method !== p.method ? "other" : p.method });
  }
  for (const [familyId, { amount, method }] of byFamily) {
    const bill = billOf(familyId);
    let amt = amount;
    if (amt > bill) {
      warnings.push(`The ${name(familyId)} family already paid ${(amt / 100).toFixed(2)}, more than their ${(bill / 100).toFixed(2)} share. The extra ${((amt - bill) / 100).toFixed(2)} is not credited here.`);
      amt = bill;
    }
    if (amt > 0) prepaid.push({ familyId, amountCents: amt, method });
  }

  const totalCents = [...share.values()].reduce((a, b) => a + b, 0);
  const prepaidCents = prepaid.reduce((a, p) => a + p.amountCents, 0);
  const invoicedCents = lines.reduce((a, l) => a + (l.payerFamilyId ? l.amountCents : 0), 0) - prepaidCents;
  return { lines, shareCents: Object.fromEntries(share), totalCents, absorbedCents: absorbed, absorbedByFamily: Object.fromEntries(absorbedBy), prepaid, prepaidCents, invoicedCents, roundingCents: rounding, surplusCents: surplus, perUnitCents: perUnit, warnings };
}

/** True when every cent reconciles: invoiced + already paid + team-covered = total + extra chipped in. */
export function balances(a: Allocation, invoiced: number): boolean {
  return invoiced === a.invoicedCents && invoiced + a.prepaidCents + a.absorbedCents === a.totalCents + a.surplusCents;
}

const METHOD: Record<PrepaidMethod, string> = { cash: "cash", venmo: "Venmo", zelle: "Zelle", check: "check", other: "outside PayPal" };
export function methodLabel(m: PrepaidMethod) {
  return METHOD[m] ?? "outside PayPal";
}

/** Group a charge's lines into one invoice per paying family, net of what they already paid. */
export function invoicesFor(charge: Pick<Charge, "title" | "lines"> & { prepaid?: Allocation["prepaid"] }, families: Family[]) {
  const byId = new Map(families.map((f) => [f.id, f]));
  const groups = new Map<string, InvoiceItem[]>();
  for (const l of charge.lines) {
    if (!l.payerFamilyId || l.amountCents <= 0) continue;
    const fam = byId.get(l.familyId)!;
    const players = fam.players.map((p) => p.name).join(" & ");
    const own = l.payerFamilyId === l.familyId;
    const item: InvoiceItem = {
      name: `${charge.title}: ${players}`,
      description: own ? `${fam.surname} family share${l.reason === "adjusted" && l.note ? ` (${l.note.split(":")[0].toLowerCase()})` : ""}` : l.note.startsWith("Covered") ? `Covering the ${fam.surname} family` : `Covering part of the ${fam.surname} family's share`,
      amountCents: l.amountCents,
    };
    const list = groups.get(l.payerFamilyId) ?? [];
    if (own) list.unshift(item);
    else list.push(item);
    groups.set(l.payerFamilyId, list);
  }
  const out: { payerFamilyId: string; items: InvoiceItem[]; amountCents: number; prepaidCents: number }[] = [];
  for (const [payerFamilyId, items] of groups) {
    const paidList = charge.prepaid?.filter((p) => p.familyId === payerFamilyId) ?? [];
    const paid = paidList[0];
    let credit = paidList.reduce((a, p) => a + p.amountCents, 0);
    const totalCredit = credit;
    // PayPal invoice items are positive, so apply the credit by reducing items (own share first).
    const net = items
      .map((it) => {
        const take = Math.min(credit, it.amountCents);
        credit -= take;
        return take ? { ...it, amountCents: it.amountCents - take, description: `${it.description}, less ${(take / 100).toFixed(2)} already paid in ${methodLabel(paid!.method)}` } : it;
      })
      .filter((it) => it.amountCents > 0);
    const amountCents = net.reduce((a, i) => a + i.amountCents, 0);
    if (amountCents > 0) out.push({ payerFamilyId, items: net, amountCents, prepaidCents: totalCredit });
  }
  return out;
}
