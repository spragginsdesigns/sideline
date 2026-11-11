import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { LivePayPalGateway, centsToValue, parseQrResponse, valueToCents } from "../src/lib/paypal/live.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubFetch(respond: (call: Call) => Response): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const tokenResponse = () => json({ access_token: "TEST_TOKEN", token_type: "Bearer", expires_in: 32400 });

function gateway() {
  return new LivePayPalGateway({ clientId: "cid", clientSecret: "secret", environment: "sandbox", webhookId: "WH-1" });
}

test("caches the OAuth token across API calls", async () => {
  const calls = stubFetch((call) => {
    if (call.url.endsWith("/v1/oauth2/token")) return tokenResponse();
    return json({ id: "INV2-AAAA", status: "SENT", detail: { invoice_number: "N1" }, amount: { currency_code: "USD", value: "10.00" } });
  });
  const gw = gateway();
  await gw.getInvoice("INV2-AAAA");
  await gw.getInvoice("INV2-AAAA");

  const tokenCalls = calls.filter((c) => c.url.endsWith("/v1/oauth2/token"));
  assert.equal(tokenCalls.length, 1);
  assert.equal(calls.length, 3);
  assert.equal(tokenCalls[0].headers.Authorization, `Basic ${Buffer.from("cid:secret").toString("base64")}`);
  assert.equal(tokenCalls[0].body, "grant_type=client_credentials");
  assert.ok(calls[1].url.startsWith("https://api-m.sandbox.paypal.com/"));
  assert.equal(calls[1].headers.Authorization, "Bearer TEST_TOKEN");
  assert.equal(calls[2].headers.Authorization, "Bearer TEST_TOKEN");
});

test("create draft invoice sends the PayPal v2 body shape for a 2-item invoice", async () => {
  const calls = stubFetch((call) => {
    if (call.url.endsWith("/v1/oauth2/token")) return tokenResponse();
    // Minimal-style response: only a self link, no id field.
    return json({ rel: "self", href: "https://api-m.sandbox.paypal.com/v2/invoicing/invoices/INV2-ZZZZ-1234", method: "GET" }, 201);
  });
  const created = await gateway().createDraftInvoice({
    invoiceNumber: "HAWKS-FRESNO-GARCIA",
    currency: "USD",
    note: "Spring season dues",
    memo: "internal memo",
    dueDate: "2026-12-01",
    recipient: { givenName: "Ana", surname: "Garcia", email: "ana@example.com" },
    items: [
      { name: "Season dues", description: "Spring 2027", amountCents: 22500 },
      { name: "Uniform", description: "Jersey + socks", amountCents: 2813 },
    ],
    invoicer: { businessName: "Fresno Hawks U10", email: "treasurer@example.com" },
  });

  assert.deepEqual(created, { paypalInvoiceId: "INV2-ZZZZ-1234", invoiceNumber: "HAWKS-FRESNO-GARCIA", status: "DRAFT" });

  const create = calls[1];
  assert.equal(create.method, "POST");
  assert.equal(create.url, "https://api-m.sandbox.paypal.com/v2/invoicing/invoices");
  assert.equal(create.headers.Prefer, "return=representation");
  assert.deepEqual(JSON.parse(create.body!), {
    detail: {
      invoice_number: "HAWKS-FRESNO-GARCIA",
      currency_code: "USD",
      note: "Spring season dues",
      memo: "internal memo",
      payment_term: { due_date: "2026-12-01" },
    },
    invoicer: { business_name: "Fresno Hawks U10", email_address: "treasurer@example.com" },
    primary_recipients: [
      { billing_info: { name: { given_name: "Ana", surname: "Garcia" }, email_address: "ana@example.com" } },
    ],
    items: [
      { name: "Season dues", description: "Spring 2027", quantity: "1", unit_amount: { currency_code: "USD", value: "225.00" } },
      { name: "Uniform", description: "Jersey + socks", quantity: "1", unit_amount: { currency_code: "USD", value: "28.13" } },
    ],
  });
});

test("money conversion is exact", () => {
  assert.equal(valueToCents("28.13"), 2813);
  assert.equal(valueToCents("-45.00"), -4500);
  assert.equal(valueToCents("0.29"), 29);
  assert.equal(valueToCents(undefined), 0);
  assert.equal(centsToValue(2813), "28.13");
  assert.equal(centsToValue(22500), "225.00");
  assert.equal(centsToValue(-4500), "-45.00");
  assert.equal(centsToValue(5), "0.05");
  assert.throws(() => centsToValue(12.5));
});

test("QR parsing handles plain base64 and multipart bodies", async () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]).toString("base64");
  const enc = new TextEncoder();

  assert.equal(parseQrResponse(enc.encode(png)), `data:image/png;base64,${png}`);

  const multipart = `--abc123\r\nContent-Type: text/plain\r\n\r\n${png.slice(0, 10)}\r\n${png.slice(10)}\r\n--abc123--\r\n`;
  assert.equal(parseQrResponse(enc.encode(multipart)), `data:image/png;base64,${png}`);
  assert.equal(parseQrResponse(enc.encode("not a qr")), null);

  // Through the gateway: plain base64 text body.
  stubFetch((call) => (call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : new Response(png, { status: 200 })));
  assert.equal(await gateway().generateQrCode("INV2-AAAA"), `data:image/png;base64,${png}`);

  // Failure never throws.
  stubFetch((call) => (call.url.endsWith("/v1/oauth2/token") ? tokenResponse() : json({ name: "RESOURCE_NOT_FOUND", debug_id: "d1" }, 404)));
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await gateway().generateQrCode("INV2-NOPE"), null);
  } finally {
    console.warn = warn;
  }
});
