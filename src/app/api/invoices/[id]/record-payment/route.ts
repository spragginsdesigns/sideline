import { ok, fail, body } from "@/lib/http";
import { recordOfflinePayment } from "@/lib/sideline";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ method?: string }>(req);
    await recordOfflinePayment(id, b.method === "CHECK" ? "CHECK" : "CASH");
    return ok({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
