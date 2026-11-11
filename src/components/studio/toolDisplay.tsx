"use client";
// How Sideline's own tools appear in AG Studio's chat panel: a line of plain words per call, and for
// two of them a body that opens underneath: the PayPal invoices that were read, and the nudge cards
// with the one button that actually sends anything.
import { useState } from "react";
import type { AgAiToolDetailParams, AgAiToolLabelParams } from "ag-studio";
import type { AgAiToolDisplay } from "ag-studio-react";

interface Envelope<T> {
  summary: string;
  result: T;
}
interface NudgeDraft {
  invoiceId: string;
  family: string;
  guardian: string;
  language: string;
  charge: string;
  amountCents: number;
  subject: string;
  message: string;
  english: string;
}
interface InvoiceLine {
  paypal_invoice_number: string | null;
  family: string;
  amount: string;
  status: string;
  days_late: number;
}

const LANG: Record<string, string> = { en: "English", es: "Español", vi: "Tiếng Việt", hmn: "Hmoob", pa: "ਪੰਜਾਬੀ", tl: "Tagalog", zh: "中文" };

function envelope<T>(result: AgAiToolDetailParams["result"] | AgAiToolLabelParams["result"]): Envelope<T> | null {
  if (!result || !result.success) return null;
  return (result.data as Envelope<T> | undefined) ?? null;
}

const label =
  (doing: string, done: string) =>
  ({ result, status }: AgAiToolLabelParams) => {
    if (status === "cancelled") return { text: doing, pill: "Stopped" };
    if (result == null) return { text: doing };
    if (!result.success) return { text: `Could not finish: ${doing.toLowerCase()}` };
    return { text: done, pill: envelope<unknown>(result)?.summary || undefined };
  };

function NudgeCards({ result }: AgAiToolDetailParams) {
  const data = envelope<{ nudges: NudgeDraft[]; note?: string }>(result);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  if (!result) return <div className="sl-nudge-en">Writing each family&apos;s reminder in their own language…</div>;
  if (!data) return null;
  const nudges = data.result.nudges ?? [];
  if (nudges.length === 0) return <div className="sl-nudge-en">{data.result.note ?? "Nobody is past due."}</div>;

  async function send() {
    setState("sending");
    try {
      const res = await fetch("/api/reminders/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reminders: nudges.map((n) => ({ invoiceId: n.invoiceId, subject: n.subject, message: n.message })) }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; results?: { ok: boolean; error?: string }[] };
      if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
      const failed = (json.results ?? []).filter((r) => !r.ok);
      if (failed.length) throw new Error(failed[0].error ?? "PayPal did not accept a reminder");
      setState("sent");
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  return (
    <div className="sl-nudges">
      {nudges.map((n) => (
        <div key={n.invoiceId} className="sl-nudge">
          <div className="sl-nudge-head">
            <span>
              {n.guardian} · ${(n.amountCents / 100).toFixed(2)}
            </span>
            <span className="sl-nudge-lang">{LANG[n.language] ?? n.language}</span>
          </div>
          <div className="sl-nudge-msg" lang={n.language}>
            {n.message}
          </div>
          {n.language !== "en" && <div className="sl-nudge-en">In English: {n.english}</div>}
        </div>
      ))}
      {state === "sent" ? (
        <div className="sl-nudge-sent">Sent as {nudges.length} PayPal invoice reminder{nudges.length === 1 ? "" : "s"}.</div>
      ) : (
        <button type="button" className="sl-nudge-send" disabled={state === "sending"} onClick={send}>
          {state === "sending" ? "Sending…" : `Send ${nudges.length} as PayPal reminders`}
        </button>
      )}
      {state === "error" && <div className="sl-nudge-en" style={{ color: "#f87171" }}>{error}</div>}
    </div>
  );
}

function InvoiceTable({ result }: AgAiToolDetailParams) {
  const data = envelope<InvoiceLine[]>(result);
  if (!data || !Array.isArray(data.result)) return null;
  return (
    <table className="sl-tool-table">
      <thead>
        <tr>
          <th>PayPal invoice</th>
          <th>Family</th>
          <th>Amount</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {data.result.slice(0, 20).map((r, i) => (
          <tr key={i}>
            <td>{r.paypal_invoice_number ?? ""}</td>
            <td>{r.family.split(" (")[0]}</td>
            <td>{r.amount}</td>
            <td>{r.status === "PAID" ? "Paid" : r.days_late > 0 ? `${r.days_late}d late` : "Open"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const sidelineToolDisplay: Record<string, AgAiToolDisplay> = {
  get_team_summary: { label: label("Reading the team account", "Read the team account") },
  list_invoices: { label: label("Reading PayPal invoices", "Read PayPal invoices"), detail: InvoiceTable },
  list_transactions: { label: label("Reading PayPal transactions and the ledger", "Read PayPal transactions and the ledger") },
  list_games: { label: label("Checking referee payouts", "Checked referee payouts") },
  draft_nudges: { label: label("Drafting nudges in each family's language", "Drafted nudges"), detail: NudgeCards },
};
