import { ok, fail, body } from "@/lib/http";
import { runTool, TREASURER_TOOL_NAMES } from "@/lib/ai/treasurer";
import { draftReminders, lateInvoices } from "@/lib/sideline";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The AG Studio treasurer agent's own tools. They run on the server because they read the ledger
 * and PayPal. All of them are read-only: draft_nudges writes words, never sends them. Sending is
 * a button a person presses (POST /api/reminders/send).
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
      if (late.length === 0) return ok({ summary: "Nobody is past due", result: { nudges: [], note: "No family is past its due date, so there is nobody to nudge." } });
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
