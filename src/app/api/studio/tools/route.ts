import { ok, fail, body } from "@/lib/http";
import { runTool, TREASURER_TOOL_NAMES } from "@/lib/ai/treasurer";
import { draftReminders, lateInvoices } from "@/lib/sideline";
import { readState } from "@/lib/store";
import { isLate } from "@/lib/summary";
import { takeTurnBudget, visitor } from "@/lib/studio/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The AG Studio treasurer agent's own tools. They run on the server because they read the ledger
 * and PayPal. All of them are read-only: draft_nudges writes words, never sends them. Sending is
 * a button a person presses (POST /api/reminders/send). draft_nudges makes one model call per
 * late family, so it draws on the same AI budget as the agents' turns.
 */
export async function POST(req: Request) {
  try {
    const b = await body<{ name?: string; args?: Record<string, unknown> }>(req);
    const name = String(b.name ?? "");
    const args = b.args && typeof b.args === "object" ? b.args : {};
    if ((TREASURER_TOOL_NAMES as readonly string[]).includes(name)) return ok(await runTool(name, args));
    if (name === "draft_nudges") {
      const state = readState();
      const late = lateInvoices();
      if (late.length === 0) {
        // "Nobody to nudge" has two causes, and the treasurer should hear the right one.
        const pastDue = state.invoices.filter((i) => i.status === "SENT" && isLate(i, state.charges.find((c) => c.id === i.chargeId)));
        return pastDue.length
          ? ok({ summary: "Already nudged today", result: { nudges: [], note: `${pastDue.length} famil${pastDue.length === 1 ? "y is" : "ies are"} past due, and each was already nudged in the last day. Sideline never nudges a family twice in a day.` } })
          : ok({ summary: "Nobody is past due", result: { nudges: [], note: "No family is past its due date, so there is nobody to nudge." } });
      }
      takeTurnBudget(visitor(req), Date.now(), late.length);
      const drafts = await draftReminders(late.map((i) => i.id));
      const nudges = drafts.map((d) => {
        const inv = state.invoices.find((i) => i.id === d.invoiceId);
        const fam = state.team.families.find((f) => f.id === d.familyId);
        const charge = state.charges.find((c) => c.id === inv?.chargeId);
        return {
          invoiceId: d.invoiceId,
          family: fam?.surname ?? "",
          guardian: fam?.guardian ?? "",
          language: d.language,
          charge: charge?.title ?? "",
          amountCents: inv?.amountCents ?? 0,
          subject: d.subject,
          message: d.message,
          english: d.english,
        };
      });
      return ok({ summary: `${nudges.length} nudge${nudges.length === 1 ? "" : "s"} drafted`, result: { nudges } });
    }
    throw new Error(`Unknown tool ${name}`);
  } catch (e) {
    return fail(e);
  }
}
