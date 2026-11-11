import { ok, fail, body } from "@/lib/http";
import { finalizeGame } from "@/lib/sideline";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const b = await body<{ us: number; them: number }>(req);
    const us = Number(b.us), them = Number(b.them);
    if (!Number.isInteger(us) || !Number.isInteger(them) || us < 0 || them < 0 || us > 99 || them > 99) throw new Error("Enter the final score as two whole numbers.");
    return ok(await finalizeGame(id, { us, them }));
  } catch (e) {
    return fail(e);
  }
}
