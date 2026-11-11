// PayPal webhook receiver. Subscribe this URL to INVOICING.INVOICE.PAID,
// INVOICING.INVOICE.CANCELLED and PAYMENT.PAYOUTS-ITEM.* in the PayPal
// developer dashboard, and set PAYPAL_WEBHOOK_ID.
import { NextResponse } from "next/server";
import { gateway } from "@/lib/paypal";
import { handlePayPalEvent } from "@/lib/webhooks";

export async function POST(req: Request) {
  const rawBody = await req.text();
  const gw = gateway();
  if (gw.mode !== "live") return NextResponse.json({ error: "PayPal is not configured" }, { status: 503 });
  const headers: Record<string, string | null> = {};
  for (const h of ["paypal-auth-algo", "paypal-cert-url", "paypal-transmission-id", "paypal-transmission-sig", "paypal-transmission-time"]) headers[h] = req.headers.get(h);
  const verified = await gw.verifyWebhook({ headers, rawBody });
  if (!verified) return NextResponse.json({ error: "signature verification failed" }, { status: 401 });
  try {
    const result = await handlePayPalEvent(JSON.parse(rawBody), "paypal-webhook");
    console.log(`[sideline] webhook ${headers["paypal-transmission-id"]}: ${result.note}`);
    // Unmatched payment events get a 404 so PayPal retries them later; other event types are acknowledged.
    const ours = /^(INVOICING\.INVOICE\.(PAID|CANCELLED)|PAYMENT\.PAYOUTS-ITEM\.)/.test(String(JSON.parse(rawBody).event_type));
    return NextResponse.json(result, { status: !result.handled && !result.duplicate && ours ? 404 : 200 });
  } catch (e) {
    console.error(`[sideline] webhook failed: ${(e as Error).message}`);
    return NextResponse.json({ error: "handler failed" }, { status: 500 });
  }
}
