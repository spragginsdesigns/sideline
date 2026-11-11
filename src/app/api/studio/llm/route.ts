import { ok, fail, body } from "@/lib/http";
import { runStudioTurn, takeTurnBudget, type StudioTurnRequest } from "@/lib/studio/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** One turn of an AG Studio agent: the browser sends Studio's request, the server calls the model. */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 600_000) throw new Error("That conversation is too long. Start a new one.");
    takeTurnBudget();
    let b: StudioTurnRequest;
    try {
      b = JSON.parse(raw) as StudioTurnRequest;
    } catch {
      throw new Error("Expected a JSON body");
    }
    return ok(await runStudioTurn(b, req.signal));
  } catch (e) {
    return fail(e);
  }
}
