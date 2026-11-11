import { ok, fail, body } from "@/lib/http";
import { askTreasurer } from "@/lib/ai/treasurer";

export async function POST(req: Request) {
  try {
    const b = await body<{ question: string; history?: { role: "user" | "assistant"; content: string }[] }>(req);
    const q = (b.question ?? "").trim();
    if (!q) throw new Error("Ask a question about the team's money.");
    return ok(await askTreasurer(q, Array.isArray(b.history) ? b.history : []));
  } catch (e) {
    return fail(e);
  }
}
