// Demo team. Every name, email and family here is fictional.
import type { AppState, Charge, Game, Invoice, LedgerEvent, Team } from "./types.ts";

export function seedTeam(): Team {
  const fam = (
    id: string,
    surname: string,
    guardian: string,
    language: Team["families"][number]["language"],
    players: [string, number][],
  ) => ({
    id,
    surname,
    guardian,
    language,
    email: `${guardian.split(" ")[0].toLowerCase()}.${surname.toLowerCase()}@example.com`,
    players: players.map(([name, jersey]) => ({ name, jersey })),
  });
  return {
    id: "valley-hawks-u11",
    name: "Valley Hawks U11 Girls",
    shortName: "HAWKS",
    sport: "Soccer",
    season: "Fall 2026",
    city: "Fresno, CA",
    coach: "Coach Dana Brooks",
    treasurer: "Priya Shah",
    treasurerEmail: "treasurer@valleyhawks.example.com",
    families: [
      fam("f-garcia", "Garcia", "Ana Garcia", "es", [["Sofia Garcia", 7]]),
      fam("f-nguyen", "Nguyen", "Linh Nguyen", "vi", [["Emma Nguyen", 4]]),
      fam("f-ortiz", "Ortiz", "Rosa Ortiz", "es", [["Mia Ortiz", 10]]),
      fam("f-lee", "Lee", "Daniel Lee", "en", [["Chloe Lee", 2]]),
      fam("f-singh", "Singh", "Harpreet Singh", "pa", [["Simran Singh", 11], ["Amrit Singh", 15]]),
      fam("f-vang", "Vang", "Pao Vang", "hmn", [["Nou Vang", 9]]),
      fam("f-johnson", "Johnson", "Keisha Johnson", "en", [["Ava Johnson", 1]]),
      fam("f-reyes", "Reyes", "Marisol Reyes", "es", [["Lucia Reyes", 14], ["Isabel Reyes", 18]]),
      fam("f-santos", "Santos", "Jo Santos", "tl", [["Bea Santos", 6]]),
      fam("f-miller", "Miller", "Tom Miller", "en", [["Harper Miller", 3]]),
      fam("f-chen", "Chen", "Wei Chen", "zh", [["Lily Chen", 8]]),
      fam("f-kaur", "Kaur", "Manpreet Kaur", "pa", [["Jasleen Kaur", 12]]),
      fam("f-thompson", "Thompson", "Erin Thompson", "en", [["Zoe Thompson", 5]]),
      fam("f-lor", "Lor", "Mai Lor", "hmn", [["Kalia Lor", 16]]),
    ],
    referees: [
      { id: "r-okafor", name: "Chidi Okafor", email: "chidi.ref@example.com", feeCents: 4500 },
      { id: "r-martinez", name: "Gabby Martinez", email: "gabby.ref@example.com", feeCents: 4500 },
    ],
  };
}

const DAY = 86_400_000;

export function seedState(now = Date.now()): AppState {
  const team = seedTeam();
  const iso = (offsetDays: number, hour = 10) => {
    const d = new Date(now + offsetDays * DAY);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const ymd = (offsetDays: number) => iso(offsetDays).slice(0, 10);

  // An earlier charge: fall uniforms + league fee, $85 per player, Ortiz on scholarship.
  const uniformsLines = team.families.map((f) => {
    const amt = 8500 * f.players.length;
    if (f.id === "f-ortiz")
      return { familyId: f.id, payerFamilyId: null, amountCents: amt, reason: "scholarship" as const, note: "Scholarship: the team fund covers it" };
    return { familyId: f.id, payerFamilyId: f.id, amountCents: amt, reason: "share" as const, note: "" };
  });
  const uniforms: Charge = {
    id: "c-uniforms",
    title: "Fall uniforms & league fee",
    totalCents: uniformsLines.reduce((a, l) => a + l.amountCents, 0),
    dueDate: ymd(-6),
    createdAt: iso(-24),
    sourceMessage: "Uniforms + league fee is $85 a kid, due by the 4th. Mia is on scholarship again, team covers her.",
    rulesSummary: ["$85.00 per player", "Mia Ortiz on scholarship: the team fund covers it", "Due in two weeks"],
    warnings: [],
    lines: uniformsLines,
    absorbedCents: 8500,
  };

  const latePayers = new Set(["f-vang", "f-santos", "f-chen"]);
  const invoices: Invoice[] = uniformsLines
    .filter((l) => l.payerFamilyId)
    .map((l, i) => {
      const fam = team.families.find((f) => f.id === l.familyId)!;
      const paid = !latePayers.has(fam.id);
      return {
        id: `i-uni-${fam.id.slice(2)}`,
        chargeId: uniforms.id,
        payerFamilyId: fam.id,
        items: [
          {
            name: `${uniforms.title}: ${fam.players.map((p) => p.name).join(" & ")}`,
            description: `${fam.surname} family share`,
            amountCents: l.amountCents,
          },
        ],
        amountCents: l.amountCents,
        status: paid ? "PAID" : "SENT",
        // Unpaid seed invoices get a placeholder id; publishSeedInvoices() swaps it for a real PayPal invoice in live mode.
        paypalInvoiceId: paid ? null : `SEED-INV-${fam.surname.toUpperCase()}`,
        paypalInvoiceNumber: `HAWKS-UNI-${fam.surname.toUpperCase()}`,
        payerViewUrl: null,
        qrCodeDataUrl: null,
        createdAt: iso(-24),
        sentAt: iso(-24, 11),
        paidAt: paid ? iso(-23 + (i % 9), 19) : null,
        paidVia: paid ? "PayPal" : null,
        reminders: [],
      } satisfies Invoice;
    });

  const games: Game[] = [
    { id: "g-1", opponent: "Clovis Comets", date: iso(-15, 9), field: "Woodward Park Field 3", refereeId: "r-okafor", status: "final", score: { us: 3, them: 1 }, payout: { batchId: "SEED-PAYOUT-1", itemId: "SEED-ITEM-1", status: "SUCCESS", amountCents: 4500, createdAt: iso(-15, 11), paidAt: iso(-15, 11) } },
    { id: "g-2", opponent: "Madera Mustangs", date: iso(-8, 9), field: "Woodward Park Field 1", refereeId: "r-martinez", status: "final", score: { us: 2, them: 2 }, payout: { batchId: "SEED-PAYOUT-2", itemId: "SEED-ITEM-2", status: "SUCCESS", amountCents: 4500, createdAt: iso(-8, 11), paidAt: iso(-8, 11) } },
    { id: "g-3", opponent: "Visalia Vipers", date: iso(0, 9), field: "Riverside Fields 2", refereeId: "r-okafor", status: "scheduled", score: null, payout: null },
    { id: "g-4", opponent: "Sanger Storm", date: iso(7, 10), field: "Woodward Park Field 3", refereeId: "r-martinez", status: "scheduled", score: null, payout: null },
    { id: "g-5", opponent: "Fresno Tournament: pool play", date: iso(13, 8), field: "Fresno Regional Sports Complex", refereeId: "r-okafor", status: "scheduled", score: null, payout: null },
  ];

  const events: LedgerEvent[] = [
    { id: "e-open", at: iso(-30), type: "opening.balance", summary: "Carried over from the spring season", amountCents: 64000, source: "seed", ref: null, paypalEventId: null },
    { id: "e-uni", at: iso(-24), type: "charge.created", summary: `${uniforms.title}: ${invoices.length} invoices sent`, amountCents: 0, source: "treasurer", ref: uniforms.id, paypalEventId: null },
    { id: "e-kit", at: iso(-20), type: "expense", summary: "Uniform order, Fresno Soccer Supply", amountCents: -98000, source: "treasurer", ref: null, paypalEventId: null },
    { id: "e-league", at: iso(-19), type: "expense", summary: "CYSA league registration", amountCents: -21000, source: "treasurer", ref: null, paypalEventId: null },
  ];
  for (const inv of invoices) {
    if (inv.status === "PAID" && inv.paidAt) {
      const fam = team.families.find((f) => f.id === inv.payerFamilyId)!;
      events.push({ id: `e-paid-${inv.id}`, at: inv.paidAt, type: "invoice.paid", summary: `${fam.surname} family paid ${uniforms.title}`, amountCents: inv.amountCents, source: "seed", ref: inv.id, paypalEventId: null });
    }
  }
  for (const g of games) {
    if (g.payout) {
      const ref = team.referees.find((r) => r.id === g.refereeId)!;
      events.push({ id: `e-payout-${g.id}`, at: g.payout.paidAt!, type: "payout.succeeded", summary: `Referee ${ref.name} paid for vs ${g.opponent}`, amountCents: -g.payout.amountCents, source: "seed", ref: g.payout.batchId, paypalEventId: null });
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  return { version: 1, epoch: now.toString(36), team, charges: [uniforms], invoices, games, events, processedWebhookIds: [] };
}
