import { dashboardView } from "@/lib/view";
import { ok, fail } from "@/lib/http";
import { ensureFresh } from "@/lib/fresh";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureFresh();
    return ok(dashboardView());
  } catch (e) {
    return fail(e, 500);
  }
}
