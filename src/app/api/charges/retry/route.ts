import { ok, fail, body } from "@/lib/http";
import { retryDrafts } from "@/lib/sideline";

export async function POST(req: Request) {
  try {
    const b = await body<{ chargeId: string }>(req);
    return ok(await retryDrafts(b.chargeId));
  } catch (e) {
    return fail(e);
  }
}
