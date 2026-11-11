// "Ask the treasurer": a tool-calling agent. The model never sees the whole
// database; it asks for what it needs through tools that read the ledger and
// PayPal (list_invoices, list_transactions mirror PayPal Agent Toolkit tools).
import type OpenAI from "openai";
import { openai } from "./client.ts";
import { AI_MODEL } from "../config.ts";
import { readState } from "../store.ts";
import { gateway } from "../paypal/index.ts";
import { formatCents } from "../money.ts";
import { daysLate, isLate, teamSummary } from "../summary.ts";

export interface ToolTrace {
  tool: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface TreasurerAnswer {
  answer: string;
  trace: ToolTrace[];
}

type FnTool = OpenAI.Responses.FunctionTool;

const nullableString = (description: string) => ({ type: ["string", "null"], description });

const TOOLS: FnTool[] = [
  {
    type: "function",
    name: "get_team_summary",
    description: "Team bank balance, money in and out this season, amount still outstanding, and per-charge totals.",
    strict: true,
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    type: "function",
    name: "list_invoices",
    description: "List family invoices with PayPal invoice number, status (SENT = unpaid, PAID), amount, due date, days late, reminders sent, and what the invoice covers.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        status: { type: ["string", "null"], enum: ["SENT", "PAID", "CANCELLED", null], description: "Filter by status, or null for all." },
        charge: nullableString("Part of a charge title to filter on, e.g. 'Fresno', or null for all charges."),
        family: nullableString("Part of a family surname to filter on, or null."),
      },
      required: ["status", "charge", "family"],
    },
  },
  {
    type: "function",
    name: "list_transactions",
    description: "Every dollar in and out of the team account between two dates: invoice payments, referee payouts, expenses, opening balance. Use for 'where did our money go' questions.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        start_date: nullableString("YYYY-MM-DD, or null for the start of the season."),
        end_date: nullableString("YYYY-MM-DD, or null for today."),
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    type: "function",
    name: "list_games",
    description: "The schedule: opponents, dates, scores, the referee, and the referee payout status for each game.",
    strict: true,
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
];

/** Read-only lookups over the ledger and PayPal. Shared by Ask the treasurer and the AG Studio treasurer agent. */
export const TREASURER_TOOL_NAMES = ["get_team_summary", "list_invoices", "list_transactions", "list_games"] as const;

export async function runTool(name: string, args: Record<string, unknown>): Promise<{ result: unknown; summary: string }> {
  const state = readState();
  const fam = (id: string) => state.team.families.find((f) => f.id === id);
  switch (name) {
    case "get_team_summary": {
      const s = teamSummary(state);
      return {
        summary: `Balance ${formatCents(s.balanceCents)}, outstanding ${formatCents(s.outstandingCents)}`,
        result: {
          team: state.team.name,
          season: state.team.season,
          bank_balance: formatCents(s.balanceCents),
          carried_over_from_last_season: formatCents(s.openingCents),
          money_in_this_season: formatCents(s.moneyInCents),
          money_out_this_season: formatCents(s.moneyOutCents),
          still_owed_by_families: formatCents(s.outstandingCents),
          covered_by_team_scholarships: formatCents(s.absorbedCents),
          referee_payouts_in_flight: formatCents(s.pendingPayoutCents),
          charges: s.charges.map((c) => ({
            title: c.title,
            due: c.dueDate,
            billed: formatCents(c.billedCents),
            collected: formatCents(c.collectedCents),
            outstanding: formatCents(c.outstandingCents),
            families_paid: `${c.paid} of ${c.invoices}`,
            late: c.late,
          })),
        },
      };
    }
    case "list_invoices": {
      const status = typeof args.status === "string" ? args.status : null;
      const charge = typeof args.charge === "string" ? args.charge.toLowerCase() : null;
      const family = typeof args.family === "string" ? args.family.toLowerCase() : null;
      const rows = state.invoices
        .filter((i) => !status || i.status === status)
        .map((i) => ({ i, c: state.charges.find((c) => c.id === i.chargeId), f: fam(i.payerFamilyId) }))
        .filter(({ c }) => !charge || c?.title.toLowerCase().includes(charge))
        .filter(({ f }) => !family || f?.surname.toLowerCase().includes(family))
        .map(({ i, c, f }) => ({
          paypal_invoice_number: i.paypalInvoiceNumber,
          family: `${f?.surname} (${f?.guardian})`,
          charge: c?.title,
          amount: formatCents(i.amountCents),
          status: i.status,
          due: c?.dueDate ?? null,
          days_late: isLate(i, c) ? daysLate(c) : 0,
          paid_at: i.paidAt,
          reminders_sent: i.reminders.length,
          covers: i.items.map((it) => it.description),
        }));
      return { summary: `${rows.length} invoice${rows.length === 1 ? "" : "s"}`, result: rows };
    }
    case "list_transactions": {
      const start = typeof args.start_date === "string" ? args.start_date : "0000";
      const end = typeof args.end_date === "string" ? `${args.end_date}T23:59:59` : "9999";
      const rows = state.events
        .filter((e) => e.amountCents !== 0 && e.at >= start && e.at <= end)
        .map((e) => ({ date: e.at.slice(0, 10), amount: formatCents(e.amountCents, { sign: true }), what: e.summary, recorded_by: e.source }));
      let paypal: unknown = undefined;
      const gw = gateway();
      if (gw.mode === "live") {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const tx = await gw.listTransactions({
            startDate: typeof args.start_date === "string" ? args.start_date : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10),
            endDate: typeof args.end_date === "string" ? args.end_date : today,
          });
          paypal = tx.map((t) => ({ id: t.id, date: t.date.slice(0, 10), amount: formatCents(t.amountCents, { sign: true }), what: t.description }));
        } catch (e) {
          paypal = `PayPal transaction search unavailable: ${(e as Error).message}`;
        }
      }
      return { summary: `${rows.length} ledger entries`, result: { ledger: rows, paypal_transactions: paypal } };
    }
    case "list_games": {
      const rows = state.games.map((g) => {
        const ref = state.team.referees.find((r) => r.id === g.refereeId);
        return {
          opponent: g.opponent,
          date: g.date.slice(0, 10),
          status: g.status,
          score: g.score ? `${g.score.us}-${g.score.them}` : null,
          referee: ref?.name,
          referee_fee: ref ? formatCents(ref.feeCents) : null,
          payout: g.payout ? { status: g.payout.status, amount: formatCents(g.payout.amountCents) } : "not paid yet",
        };
      });
      return { summary: `${rows.length} games`, result: rows };
    }
  }
  return { summary: "unknown tool", result: { error: `unknown tool ${name}` } };
}

export async function askTreasurer(question: string, history: { role: "user" | "assistant"; content: string }[] = []): Promise<TreasurerAnswer> {
  const state = readState();
  const today = new Date().toISOString().slice(0, 10);
  const input: OpenAI.Responses.ResponseInputItem[] = [
    {
      role: "system",
      content: `You are Sideline, the AI treasurer for ${state.team.name} (${state.team.sport}, ${state.team.city}, ${state.team.season}). The treasurer is ${state.team.treasurer}. Today is ${today}.
Answer questions about the team's money using the tools; never guess a number you have not read from a tool. Be brief and warm: 1 to 4 sentences, or a short list when naming families. Use exact dollar amounts. When families are behind, name them kindly and suggest a nudge, never shame. Families that aren't past their due date are not "behind" yet.
Always answer in the language the question is written in.
You can only read. If asked to do something, point to the real control in Sideline, and only these exist:
- "New charge" box: paste a group-chat message, "Read it with AI", then "Send N PayPal invoices".
- "Nudge N late" button on the board (also a bell icon on a family's row): drafts reminders, sent as PayPal invoice reminders.
- The banknote icon on a family's row: records a cash payment on their PayPal invoice.
- "Final · pay ref" on a game: pays the referee through PayPal Payouts.
- "Season report" in the top bar.
If none of these does what they ask, say Sideline can't do that yet. Never invent a button. Plain text, no markdown headings.`,
    },
    ...history.slice(-6).map((h) => ({ role: h.role, content: h.content }) as OpenAI.Responses.ResponseInputItem),
    { role: "user", content: question.slice(0, 1000) },
  ];
  const trace: ToolTrace[] = [];
  for (let turn = 0; turn < 6; turn++) {
    const r = await openai().responses.create({ model: AI_MODEL, reasoning: { effort: "low" }, input, tools: TOOLS, max_output_tokens: 4000 });
    const calls = r.output.filter((o): o is OpenAI.Responses.ResponseFunctionToolCall => o.type === "function_call");
    if (calls.length === 0) {
      return { answer: r.output_text?.trim() || "I couldn't work that out. Try asking another way?", trace };
    }
    input.push(...(r.output as OpenAI.Responses.ResponseInputItem[]));
    for (const call of calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.arguments || "{}");
      } catch {
        args = {};
      }
      const { result, summary } = await runTool(call.name, args);
      trace.push({ tool: call.name, args, summary });
      input.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
  return { answer: "That took more lookups than I expected. Try a narrower question?", trace };
}
