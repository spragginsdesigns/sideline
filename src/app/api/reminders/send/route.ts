import { ok, fail, body } from "@/lib/http";
import { sendReminders } from "@/lib/sideline";

export async function POST(req: Request) {
  try {
    const b = await body<{ reminders: { invoiceId: string; subject: string; message: string }[] }>(req);
    if (!Array.isArray(b.reminders) || b.reminders.length === 0) throw new Error("No reminders to send");
    return ok({ results: await sendReminders(b.reminders) });
  } catch (e) {
    return fail(e);
  }
}
