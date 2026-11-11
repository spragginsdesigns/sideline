// LivePayPalGateway: the real PayPal REST API (sandbox or production).
//
// Endpoints used (field names checked against PayPal's published OpenAPI specs):
//   POST /v1/oauth2/token                                     client-credentials access token
//   POST /v2/invoicing/invoices                               create draft invoice
//   POST /v2/invoicing/invoices/{id}/send                     send invoice (returns payer-view link)
//   POST /v2/invoicing/invoices/{id}/generate-qr-code         QR code PNG (base64)
//   POST /v2/invoicing/invoices/{id}/remind                   payment reminder
//   POST /v2/invoicing/invoices/{id}/cancel                   cancel a sent invoice
//   GET  /v2/invoicing/invoices/{id}                          invoice details
//   POST /v1/payments/payouts                                 batch payout
//   GET  /v1/reporting/transactions                           Transaction Search (needs the permission on the app)
//   POST /v1/notifications/verify-webhook-signature           webhook signature check
//
// Only global fetch is used. The client secret and access token are never logged.

import type {
  CreatedInvoice,
  CreatedPayout,
  DraftInvoiceInput,
  PayoutInput,
  PayPalGateway,
  RemoteInvoice,
  RemoteTransaction,
  SentInvoice,
  WebhookVerifyInput,
} from "./gateway";

const BASE_URLS = {
  sandbox: "https://api-m.sandbox.paypal.com",
  production: "https://api-m.paypal.com",
} as const;

const TOKEN_REFRESH_MARGIN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RANGE_MS = 31 * 24 * 60 * 60 * 1000;
const MAX_TRANSACTION_PAGES = 10;

export interface LivePayPalConfig {
  clientId: string;
  clientSecret: string;
  environment: "sandbox" | "production";
  webhookId?: string;
}

export class PayPalApiError extends Error {
  readonly status: number;
  readonly paypalName: string | null;
  readonly debugId: string | null;
  readonly issues: string[];

  constructor(opts: { status: number; method: string; path: string; name?: string | null; message?: string | null; debugId?: string | null; issues?: string[] }) {
    const issues = opts.issues ?? [];
    const parts = [`PayPal ${opts.method} ${opts.path} failed (${opts.status})`];
    if (opts.name) parts.push(opts.name);
    if (opts.message) parts.push(opts.message);
    if (issues.length) parts.push(`issues: ${issues.join(", ")}`);
    if (opts.debugId) parts.push(`debug_id ${opts.debugId}`);
    super(parts.join(": "));
    this.name = "PayPalApiError";
    this.status = opts.status;
    this.paypalName = opts.name ?? null;
    this.debugId = opts.debugId ?? null;
    this.issues = issues;
  }
}

// ---------- money ----------

/** Integer cents -> PayPal decimal string, e.g. 2813 -> "28.13", -4500 -> "-45.00". */
export function centsToValue(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`amount must be integer cents, got ${cents}`);
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** PayPal decimal string -> integer cents, e.g. "28.13" -> 2813, "-45.00" -> -4500. Missing/invalid -> 0. */
export function valueToCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

// ---------- small helpers ----------

type Json = Record<string, any>;

interface Link {
  href?: string;
  rel?: string;
}

function findLink(body: Json | null, rel: string): string | null {
  if (!body) return null;
  if (body.rel === rel && typeof body.href === "string") return body.href;
  const links: Link[] = Array.isArray(body.links) ? body.links : [];
  const hit = links.find((l) => l?.rel === rel && typeof l.href === "string");
  return hit?.href ?? null;
}

function lastPathSegment(href: string): string | null {
  const path = href.split(/[?#]/)[0].replace(/\/+$/, "");
  const seg = path.slice(path.lastIndexOf("/") + 1);
  return seg ? decodeURIComponent(seg) : null;
}

/** RFC 3339 with seconds and an offset, as Transaction Search requires. Date-only input is widened to the whole day (UTC). */
function toPayPalDate(input: string, edge: "start" | "end"): Date {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const d = new Date(dateOnly ? `${input}T${edge === "start" ? "00:00:00" : "23:59:59"}Z` : input);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid date: ${input}`);
  return d;
}

function formatPayPalDate(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

const PNG_BASE64_PREFIX = "iVBORw0KGgo"; // base64 of the 8-byte PNG signature

/** Pull a base64 PNG out of whatever the QR endpoint returned: raw PNG bytes, plain base64, multipart/related, or JSON. */
export function parseQrResponse(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
  }
  // Base64 may be line-wrapped anywhere; multipart boundaries ("--"), headers (":") and JSON quotes end the match.
  const text = new TextDecoder().decode(bytes).replace(/\s+/g, "");
  const match = text.match(new RegExp(`${PNG_BASE64_PREFIX}[A-Za-z0-9+/=]*`));
  if (!match || match[0].length <= PNG_BASE64_PREFIX.length) return null;
  return `data:image/png;base64,${match[0]}`;
}

// ---------- gateway ----------

export class LivePayPalGateway implements PayPalGateway {
  readonly mode = "live" as const;
  readonly environment: "sandbox" | "production";

  private readonly baseUrl: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookId: string | undefined;
  private token: { value: string; expiresAt: number } | null = null;
  private pendingToken: Promise<string> | null = null;

  constructor(config: LivePayPalConfig) {
    this.environment = config.environment;
    this.baseUrl = BASE_URLS[config.environment];
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.webhookId = config.webhookId || undefined;
  }

  // ----- auth + transport -----

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - TOKEN_REFRESH_MARGIN_MS) return this.token.value;
    if (!this.pendingToken) {
      this.pendingToken = this.fetchToken().finally(() => {
        this.pendingToken = null;
      });
    }
    return this.pendingToken;
  }

  private async fetchToken(): Promise<string> {
    const path = "/v1/oauth2/token";
    const basic = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = await readJson(res);
    if (!res.ok || typeof body?.access_token !== "string") {
      throw new PayPalApiError({
        status: res.status,
        method: "POST",
        path,
        name: body?.error ?? body?.name ?? null,
        message: body?.error_description ?? body?.message ?? (res.ok ? "no access_token in response" : null),
        debugId: body?.debug_id ?? res.headers.get("paypal-debug-id"),
      });
    }
    const expiresInSec = Number(body.expires_in) || 0;
    this.token = { value: body.access_token, expiresAt: Date.now() + expiresInSec * 1000 };
    return body.access_token;
  }

  /** JSON request against the REST API. Returns the parsed body, or null for an empty/204 response. */
  private async request(method: "GET" | "POST", path: string, opts: { body?: unknown; rawBody?: string; headers?: Record<string, string> } = {}, retried = false): Promise<Json | null> {
    const res = await this.send(method, path, opts);
    if (res.status === 401 && !retried) {
      // Token revoked or expired early: drop the cache and retry once.
      this.token = null;
      return this.request(method, path, opts, true);
    }
    const body = await readJson(res);
    if (!res.ok) throw apiError(res, method, path, body);
    return body;
  }

  private async send(method: "GET" | "POST", path: string, opts: { body?: unknown; rawBody?: string; headers?: Record<string, string> }): Promise<Response> {
    const token = await this.accessToken();
    const hasBody = opts.rawBody !== undefined || opts.body !== undefined;
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...opts.headers,
      },
      body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  }

  // ----- invoicing v2 -----

  async createDraftInvoice(input: DraftInvoiceInput): Promise<CreatedInvoice> {
    const invoicer: Json = { business_name: input.invoicer.businessName };
    if (input.invoicer.email) invoicer.email_address = input.invoicer.email;
    if (input.invoicer.website) invoicer.website = input.invoicer.website;

    const detail: Json = {
      invoice_number: input.invoiceNumber,
      currency_code: input.currency,
      note: input.note,
    };
    if (input.memo) detail.memo = input.memo;
    if (input.dueDate) detail.payment_term = { due_date: input.dueDate };

    const payload = {
      detail,
      invoicer,
      primary_recipients: [
        {
          billing_info: {
            name: { given_name: input.recipient.givenName, surname: input.recipient.surname },
            email_address: input.recipient.email,
          },
        },
      ],
      items: input.items.map((item) => ({
        name: item.name,
        description: item.description,
        quantity: "1",
        unit_amount: { currency_code: input.currency, value: centsToValue(item.amountCents) },
      })),
    };

    const body = await this.request("POST", "/v2/invoicing/invoices", {
      body: payload,
      headers: { Prefer: "return=representation" },
    });

    // return=representation gives the full invoice; return=minimal (or an older API) gives a self link.
    const selfHref = findLink(body, "self");
    const id = (typeof body?.id === "string" ? body.id : null) ?? (selfHref ? lastPathSegment(selfHref) : null);
    if (!id) throw new Error("PayPal create invoice response had neither an id nor a self link");
    return {
      paypalInvoiceId: id,
      invoiceNumber: body?.detail?.invoice_number ?? input.invoiceNumber,
      status: body?.status ?? "DRAFT",
    };
  }

  async sendInvoice(paypalInvoiceId: string, opts: { subject: string; note: string }): Promise<SentInvoice> {
    const body = await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/send`, {
      body: notification(opts),
    });
    const payerView = findLink(body, "payer-view");
    if (payerView) return { payerViewUrl: payerView };
    const invoice = await this.getInvoice(paypalInvoiceId);
    return { payerViewUrl: invoice.payerViewUrl };
  }

  async generateQrCode(paypalInvoiceId: string): Promise<string | null> {
    const path = `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/generate-qr-code`;
    try {
      let res = await this.send("POST", path, { body: { width: 300, height: 300 } });
      if (res.status === 401) {
        this.token = null;
        res = await this.send("POST", path, { body: { width: 300, height: 300 } });
      }
      if (!res.ok) {
        const body = await readJson(res).catch(() => null);
        console.warn(`[paypal] QR code unavailable for ${paypalInvoiceId}: ${apiError(res, "POST", path, body).message}`);
        return null;
      }
      const qr = parseQrResponse(new Uint8Array(await res.arrayBuffer()));
      if (!qr) console.warn(`[paypal] QR code response for ${paypalInvoiceId} had no PNG (content-type ${res.headers.get("content-type")})`);
      return qr;
    } catch (err) {
      console.warn(`[paypal] QR code request failed for ${paypalInvoiceId}: ${(err as Error).message}`);
      return null;
    }
  }

  async sendReminder(paypalInvoiceId: string, opts: { subject: string; note: string }): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/remind`, {
      body: notification(opts),
    });
  }

  async cancelInvoice(paypalInvoiceId: string, opts: { subject: string; note: string }): Promise<void> {
    await this.request("POST", `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}/cancel`, {
      body: notification(opts),
    });
  }

  async getInvoice(paypalInvoiceId: string): Promise<RemoteInvoice> {
    const inv = await this.request("GET", `/v2/invoicing/invoices/${encodeURIComponent(paypalInvoiceId)}`);
    return {
      paypalInvoiceId: inv?.id ?? paypalInvoiceId,
      invoiceNumber: inv?.detail?.invoice_number ?? "",
      status: inv?.status ?? "UNKNOWN",
      amountCents: valueToCents(inv?.amount?.value),
      paidCents: valueToCents(inv?.payments?.paid_amount?.value),
      recipientEmail: inv?.primary_recipients?.[0]?.billing_info?.email_address ?? null,
      payerViewUrl: inv?.detail?.metadata?.recipient_view_url ?? null,
    };
  }

  // ----- payouts v1 -----

  async createPayout(input: PayoutInput): Promise<CreatedPayout> {
    const body = await this.request("POST", "/v1/payments/payouts", {
      body: {
        sender_batch_header: {
          sender_batch_id: input.senderBatchId,
          email_subject: input.emailSubject,
          email_message: input.emailMessage,
        },
        items: input.items.map((item) => ({
          recipient_type: "EMAIL",
          amount: { value: centsToValue(item.amountCents), currency: "USD" },
          note: item.note,
          sender_item_id: item.senderItemId,
          receiver: item.receiverEmail,
        })),
      },
    });
    const header = body?.batch_header;
    if (!header?.payout_batch_id) throw new Error("PayPal payout response had no batch_header.payout_batch_id");
    return { batchId: header.payout_batch_id, batchStatus: header.batch_status ?? "PENDING" };
  }

  // ----- transaction search v1 -----

  async listTransactions(range: { startDate: string; endDate: string }): Promise<RemoteTransaction[]> {
    const end = toPayPalDate(range.endDate, "end");
    let start = toPayPalDate(range.startDate, "start");
    if (end.getTime() - start.getTime() > MAX_RANGE_MS) start = new Date(end.getTime() - MAX_RANGE_MS);

    const out: RemoteTransaction[] = [];
    for (let page = 1; page <= MAX_TRANSACTION_PAGES; page++) {
      const qs = new URLSearchParams({
        start_date: formatPayPalDate(start),
        end_date: formatPayPalDate(end),
        fields: "transaction_info,cart_info",
        page_size: "100",
        page: String(page),
      });
      let body: Json | null;
      try {
        body = await this.request("GET", `/v1/reporting/transactions?${qs.toString()}`);
      } catch (err) {
        if (err instanceof PayPalApiError && err.status === 403) {
          console.warn(`[paypal] Transaction Search is not enabled for this app (403${err.debugId ? `, debug_id ${err.debugId}` : ""}); returning no transactions.`);
          return out;
        }
        throw err;
      }
      const details: Json[] = Array.isArray(body?.transaction_details) ? body.transaction_details : [];
      for (const d of details) {
        const t = d?.transaction_info;
        if (!t?.transaction_id) continue;
        out.push({
          id: t.transaction_id,
          date: t.transaction_initiation_date ?? t.transaction_updated_date ?? "",
          amountCents: valueToCents(t.transaction_amount?.value),
          status: t.transaction_status ?? "",
          description: t.transaction_subject || t.transaction_note || "",
        });
      }
      const totalPages = Number(body?.total_pages) || 1;
      if (page >= totalPages) break;
    }
    return out;
  }

  // ----- webhooks -----

  async verifyWebhook(input: WebhookVerifyInput): Promise<boolean> {
    if (!this.webhookId) {
      console.warn("[paypal] PAYPAL_WEBHOOK_ID is not set; rejecting webhook because its signature cannot be verified.");
      return false;
    }
    const h = input.headers;
    const fields = {
      auth_algo: h["paypal-auth-algo"],
      cert_url: h["paypal-cert-url"],
      transmission_id: h["paypal-transmission-id"],
      transmission_sig: h["paypal-transmission-sig"],
      transmission_time: h["paypal-transmission-time"],
    };
    if (Object.values(fields).some((v) => !v)) {
      console.warn("[paypal] webhook is missing PayPal signature headers; rejecting.");
      return false;
    }
    try {
      JSON.parse(input.rawBody);
    } catch {
      console.warn("[paypal] webhook body is not valid JSON; rejecting.");
      return false;
    }
    // Splice the raw body in verbatim (it is valid JSON, checked above) so re-serialization
    // cannot alter the event PayPal signed.
    const head = JSON.stringify({ ...fields, webhook_id: this.webhookId });
    const rawBody = `${head.slice(0, -1)},"webhook_event":${input.rawBody}}`;
    try {
      const body = await this.request("POST", "/v1/notifications/verify-webhook-signature", { rawBody });
      return body?.verification_status === "SUCCESS";
    } catch (err) {
      console.warn(`[paypal] webhook verification call failed: ${(err as Error).message}`);
      return false;
    }
  }
}

function notification(opts: { subject: string; note: string }) {
  return { subject: opts.subject, note: opts.note, send_to_invoicer: false, send_to_recipient: true };
}

async function readJson(res: Response): Promise<Json | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function apiError(res: Response, method: string, path: string, body: Json | null): PayPalApiError {
  const issues: string[] = Array.isArray(body?.details)
    ? body.details.map((d: Json) => d?.issue).filter((i: unknown): i is string => typeof i === "string")
    : [];
  return new PayPalApiError({
    status: res.status,
    method,
    path: path.split("?")[0],
    name: body?.name ?? body?.error ?? null,
    message: body?.message ?? body?.error_description ?? null,
    debugId: body?.debug_id ?? res.headers.get("paypal-debug-id"),
    issues,
  });
}

/** Returns the live gateway when PayPal credentials are configured, otherwise null (the app falls back to the simulator). */
export function createLiveGateway(): LivePayPalGateway | null {
  const clientId = process.env.PAYPAL_CLIENT_ID?.trim();
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  const environment = process.env.PAYPAL_ENV?.trim().toLowerCase() === "production" ? "production" : "sandbox";
  return new LivePayPalGateway({
    clientId,
    clientSecret,
    environment,
    webhookId: process.env.PAYPAL_WEBHOOK_ID?.trim(),
  });
}
