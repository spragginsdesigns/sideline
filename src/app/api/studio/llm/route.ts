import { ok, fail } from "@/lib/http";
import { recordTokens, runStudioTurn, takeTurnBudget, visitor, type StudioTurnRequest } from "@/lib/studio/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** One turn of an AG Studio agent: the browser sends Studio's request, the server calls the model. */
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 400_000) throw new Error("That conversation is too long. Start a new one.");
    let b: StudioTurnRequest;
    try {
      b = JSON.parse(raw) as StudioTurnRequest;
    } catch {
      throw new Error("Expected a JSON body");
    }
    if (!b || !Array.isArray(b.input) || b.input.length === 0) throw new Error("Expected a conversation to answer.");
    // Only a well-formed turn spends budget, so junk requests cannot lock real visitors out.
    takeTurnBudget(visitor(req));
    const turn = await runStudioTurn(b, req.signal);
    recordTokens(turn.usage?.totalTokens);
    return ok(turn);
  } catch (e) {
    return fail(e);
  }
}
