import { ok, fail, body } from "@/lib/http";
import { draftReminders } from "@/lib/sideline";

export async function POST(req: Request) {
  try {
    const b = await body<{ invoiceIds?: string[] }>(req);
    return ok({ nudges: await draftReminders(b.invoiceIds) });
  } catch (e) {
    return fail(e);
  }
}
