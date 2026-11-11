import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { readState } from "@/lib/store";
import { gateway } from "@/lib/paypal";
import { formatCents } from "@/lib/money";
import { isLate } from "@/lib/summary";
import { LANGUAGE_NAMES, type LanguageCode } from "@/lib/types";
import { DATE_LOCALE, t } from "@/lib/i18n";
import { Logo } from "@/components/TopBar";
import { PayButton } from "./PayButton";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ invoiceId: string }> }): Promise<Metadata> {
  const { invoiceId } = await params;
  const state = readState();
  const inv = state.invoices.find((i) => i.id === invoiceId);
  const charge = inv && state.charges.find((c) => c.id === inv.chargeId);
  return { title: charge ? `${charge.title} · ${state.team.name}` : "Sideline", robots: { index: false } };
}

export default async function PayPage({ params, searchParams }: { params: Promise<{ invoiceId: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { invoiceId } = await params;
  const { lang: langParam } = await searchParams;
  const state = readState();
  const inv = state.invoices.find((i) => i.id === invoiceId);
  if (!inv) notFound();
  const charge = state.charges.find((c) => c.id === inv.chargeId)!;
  const fam = state.team.families.find((f) => f.id === inv.payerFamilyId)!;
  const familyLang = fam.language;
  const lang: LanguageCode = langParam === "en" ? "en" : familyLang;
  const first = fam.guardian.split(" ")[0];
  const late = isLate(inv, charge);
  const lastNudge = inv.reminders.at(-1);
  const mode = gateway().mode;
  const payHref = mode === "live" ? inv.payerViewUrl : inv.paypalInvoiceId ? `/sandbox-checkout/${encodeURIComponent(inv.paypalInvoiceId)}` : null;
  const date = (iso: string) => new Date(iso).toLocaleDateString(DATE_LOCALE[lang] ?? "en-US", { month: "short", day: "numeric" });
  const dueLine =
    inv.status === "PAID"
      ? t(lang, "paidOn", { date: date(inv.paidAt!), method: inv.paidVia ?? "PayPal" })
      : charge.dueDate
        ? t(lang, late ? "wasDue" : "due", { date: date(`${charge.dueDate}T12:00:00`) })
        : t(lang, "anytime");
  const itemLabel = (desc: string) => {
    const covering = desc.match(/^Covering (?:part of )?the (.+?) family/);
    if (covering) return t(lang, "covering", { family: covering[1] });
    const own = desc.match(/^(.+?) family share/);
    if (own) return t(lang, "yourShare", { family: own[1] }) + desc.slice(own[0].length);
    return desc;
  };

  return (
    <div className="pitch min-h-dvh" lang={lang}>
      <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-6">
        <div className="flex items-center justify-between">
          <Logo />
          {familyLang !== "en" && (
            <a className="rounded-full border border-chalk/15 px-3 py-1.5 text-xs text-chalk-dim hover:text-chalk" href={lang === "en" ? `/pay/${inv.id}` : `/pay/${inv.id}?lang=en`}>
              {lang === "en" ? LANGUAGE_NAMES[familyLang] : "English"}
            </a>
          )}
        </div>

        <section className="card overflow-hidden">
          <div className="border-b border-chalk/10 bg-gradient-to-br from-led/15 via-transparent to-transparent px-5 py-5">
            <div className="label !text-led-bright">{state.team.name}</div>
            <h1 className="mt-1 font-display text-3xl font-semibold uppercase leading-tight">{t(lang, "hi", { name: first })}</h1>
            <p className="mt-1 text-chalk-dim">{t(lang, "share", { family: fam.surname, charge: charge.title })}</p>
          </div>

          <ul className="divide-y divide-chalk/8 px-5">
            {inv.items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <div className="font-semibold">{itemLabel(it.description)}</div>
                  <div className="text-sm text-chalk-faint">{it.name.split(": ").slice(1).join(": ")}</div>
                </div>
                <span className="led shrink-0 font-semibold">{formatCents(it.amountCents)}</span>
              </li>
            ))}
          </ul>

          <div className="flex items-end justify-between border-t border-chalk/10 bg-night-950/40 px-5 py-4">
            <div>
              <div className="label">{t(lang, "total")}</div>
              <div className={`text-xs ${late && inv.status !== "PAID" ? "text-coral-soft" : "text-chalk-faint"}`}>{dueLine}</div>
            </div>
            <div className={`led text-4xl font-bold ${inv.status === "PAID" ? "led-green" : "led-amber"}`}>{formatCents(inv.amountCents)}</div>
          </div>

          {lastNudge && inv.status !== "PAID" && (
            <div className="border-t border-chalk/10 px-5 py-4">
              <div className="label mb-1.5">{t(lang, "messageFrom", { name: state.team.treasurer.split(" ")[0] })}</div>
              <p className="whitespace-pre-wrap leading-relaxed text-chalk">{lastNudge.message}</p>
            </div>
          )}

          <div className="px-5 pt-1 pb-5">
            <PayButton
              status={inv.status}
              href={payHref}
              mode={mode}
              invoiceNumber={inv.paypalInvoiceNumber}
              qr={inv.qrCodeDataUrl}
              labels={{ payWith: t(lang, "payWith"), thanks: t(lang, "thanks"), seen: t(lang, "seen"), showQr: t(lang, "showQr"), hideQr: t(lang, "hideQr") }}
            />
          </div>
        </section>

        <p className="px-2 text-center text-xs leading-relaxed text-chalk-faint">
          {t(lang, "moneyTo", { team: state.team.name, treasurer: state.team.treasurer })} {t(lang, "methods")}{" "}
          <a className="text-sky underline-offset-2 hover:underline" href="/report">
            {t(lang, "report")}
          </a>
        </p>
      </main>
    </div>
  );
}
