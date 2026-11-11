// Deterministic money engine. The AI only *reads* the coach's message into
// ChargeRules; every dollar is computed here, in integer cents, so the totals
// always add up and the result is the same every time.
import type { Charge, ChargeLine, Family, InvoiceItem } from "../types.ts";

export interface ChargeRules {
  title: string;
  amountKind: "team_total" | "per_family" | "per_player";
  amountCents: number;
  splitBasis: "family" | "player"; // only used for team_total
  dueDate: string | null;
  scholarshipFamilyIds: string[];
  scholarshipPolicy: "team_absorbs" | "split_among_others";
  coverings: { payerFamilyId: string; coveredFamilyId: string }[];
  customAmounts: { familyId: string; amountCents: number; reason: string }[];
  excludedFamilyIds: string[];
  notes: string[]; // human-readable rules the AI applied
  ambiguities: string[]; // things the treasurer should double-check
}

export interface Allocation {
  lines: ChargeLine[];
  totalCents: number; // everything owed, including absorbed scholarship shares
  absorbedCents: number;
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
  // Largest remainder first; ties break on original order for stability.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (leftover <= 0) break;
    floors[i] += 1;
    leftover -= 1;
  }
  return floors;
}

export function allocate(rules: ChargeRules, families: Family[]): Allocation {
  const warnings: string[] = [];
  const byId = new Map(families.map((f) => [f.id, f]));
  const known = (id: string, what: string) => {
    if (byId.has(id)) return true;
    warnings.push(`Ignored ${what} for an unknown family (${id}).`);
    return false;
  };

  // A scholarship family is on the charge (the team pays for them), so a scholarship
  // always wins over an exclusion of the same family.
  const scholarship = new Set(rules.scholarshipFamilyIds.filter((id) => known(id, "a scholarship")));
  const excluded = new Set(rules.excludedFamilyIds.filter((id) => known(id, "an exclusion") && !scholarship.has(id)));
  const custom = new Map<string, { amountCents: number; reason: string }>();
  for (const c of rules.customAmounts) {
    if (!known(c.familyId, "a custom amount") || excluded.has(c.familyId)) continue;
    if (c.amountCents < 0) {
      warnings.push(`Ignored a negative amount for ${byId.get(c.familyId)!.surname}.`);
      continue;
    }
    if (scholarship.has(c.familyId)) {
      warnings.push(
        `${byId.get(c.familyId)!.surname} has both a scholarship and a custom amount; kept the custom amount.`,
      );
      scholarship.delete(c.familyId);
    }
    custom.set(c.familyId, c);
  }

  const participants = families.filter((f) => !excluded.has(f.id));
  const shares = new Map<string, number>();
  let absorbed = 0;

  if (rules.amountKind === "team_total") {
    const basis = rules.splitBasis;
    const customSum = [...custom.values()].reduce((a, c) => a + c.amountCents, 0);
    let remaining = rules.amountCents - customSum;
    if (remaining < 0) {
      warnings.push("The custom amounts add up to more than the team total; nobody else owes anything.");
      remaining = 0;
    }
    const open = participants.filter((f) => !custom.has(f.id));
    const payers = rules.scholarshipPolicy === "split_among_others" ? open.filter((f) => !scholarship.has(f.id)) : open;
    const parts = splitExact(
      remaining,
      payers.map((f) => units(f, basis)),
    );
    payers.forEach((f, i) => shares.set(f.id, parts[i]));
    for (const f of open) if (!shares.has(f.id)) shares.set(f.id, 0);
    if (rules.scholarshipPolicy === "team_absorbs") {
      for (const id of scholarship) {
        absorbed += shares.get(id) ?? 0;
      }
    }
    if (payers.length === 0 && remaining > 0) warnings.push("No family is left to pay this charge.");
  } else {
    for (const f of participants) {
      if (custom.has(f.id)) continue;
      const each = rules.amountKind === "per_player" ? rules.amountCents * units(f, "player") : rules.amountCents;
      shares.set(f.id, each);
      if (scholarship.has(f.id)) absorbed += each;
    }
  }
  for (const [id, c] of custom) shares.set(id, c.amountCents);

  // Who pays for whom. A family can be covered once; chains (A covers B, B covers C) resolve to A.
  const payerOf = new Map<string, string>();
  for (const c of rules.coverings) {
    if (!known(c.payerFamilyId, "a covering") || !known(c.coveredFamilyId, "a covering")) continue;
    if (c.payerFamilyId === c.coveredFamilyId) continue;
    if (excluded.has(c.payerFamilyId)) {
      warnings.push(`${byId.get(c.payerFamilyId)!.surname} is not on this charge, so they cannot cover anyone.`);
      continue;
    }
    if (payerOf.has(c.coveredFamilyId)) {
      warnings.push(`${byId.get(c.coveredFamilyId)!.surname} was covered twice; kept the first.`);
      continue;
    }
    payerOf.set(c.coveredFamilyId, c.payerFamilyId);
  }
  const resolvePayer = (id: string): string => {
    const seen = new Set<string>();
    let cur = id;
    while (payerOf.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = payerOf.get(cur)!;
    }
    return cur;
  };

  const lines: ChargeLine[] = [];
  for (const f of families) {
    if (excluded.has(f.id)) {
      lines.push({ familyId: f.id, payerFamilyId: null, amountCents: 0, reason: "excluded", note: "Not on this charge" });
      continue;
    }
    const amount = shares.get(f.id) ?? 0;
    if (scholarship.has(f.id)) {
      const note =
        rules.scholarshipPolicy === "team_absorbs" ? "Scholarship: the team fund covers it" : "Scholarship: no charge";
      lines.push({ familyId: f.id, payerFamilyId: null, amountCents: rules.scholarshipPolicy === "team_absorbs" ? amount : 0, reason: "scholarship", note });
      continue;
    }
    const payer = resolvePayer(f.id);
    const c = custom.get(f.id);
    const note = payer !== f.id ? `Covered by the ${byId.get(payer)!.surname} family` : c ? c.reason : "";
    lines.push({ familyId: f.id, payerFamilyId: payer, amountCents: amount, reason: c ? "custom" : "share", note });
  }

  const totalCents = lines.reduce((a, l) => a + (l.reason === "excluded" ? 0 : l.amountCents), 0);
  return { lines, totalCents, absorbedCents: absorbed, warnings };
}

/** Group a charge's lines into one invoice per paying family. */
export function invoicesFor(charge: Pick<Charge, "title" | "lines">, families: Family[]) {
  const byId = new Map(families.map((f) => [f.id, f]));
  const groups = new Map<string, InvoiceItem[]>();
  for (const l of charge.lines) {
    if (!l.payerFamilyId || l.amountCents <= 0) continue;
    const fam = byId.get(l.familyId)!;
    const players = fam.players.map((p) => p.name).join(" & ");
    const item: InvoiceItem = {
      name: `${charge.title}: ${players}`,
      description: l.payerFamilyId === l.familyId ? `${fam.surname} family share` : `Covering the ${fam.surname} family`,
      amountCents: l.amountCents,
    };
    const list = groups.get(l.payerFamilyId) ?? [];
    // Keep the payer's own line first.
    if (l.payerFamilyId === l.familyId) list.unshift(item);
    else list.push(item);
    groups.set(l.payerFamilyId, list);
  }
  return [...groups.entries()].map(([payerFamilyId, items]) => ({
    payerFamilyId,
    items,
    amountCents: items.reduce((a, i) => a + i.amountCents, 0),
  }));
}
