import Link from "next/link";
import { ArrowRight, BellRing, Bot, FileText, MessageSquareText, Whistle } from "lucide-react";
import { Logo } from "@/components/TopBar";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";

const STEPS = [
  { Icon: MessageSquareText, title: "Paste the group chat", body: "“$450 for Fresno, split it, the Garcias are covering the Nguyens, Mia’s on scholarship.” Sideline reads it, applies every exception, and does the math to the cent." },
  { Icon: FileText, title: "Every family gets a PayPal invoice", body: "One tap sends each family their own PayPal invoice with a QR code. Pay with PayPal, Venmo or card." },
  { Icon: BellRing, title: "Kind nudges, in their language", body: "Late? Sideline writes a friendly reminder in Spanish, Vietnamese, Hmong, Punjabi… and sends it as a PayPal reminder." },
  { Icon: Whistle, title: "Refs paid at the final whistle", body: "Mark the game final and the referee is paid through PayPal Payouts. The webhook confirms it on the board." },
  { Icon: Bot, title: "Ask the treasurer anything", body: "“How much is left for Fresno and who’s behind?” An AI agent answers from the ledger and PayPal, never guessing." },
];

export default function Home() {
  const state = readState();
  const firstOpen = state.invoices.find((i) => i.status === "SENT");
  return (
    <div className="pitch min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <Link href="/board" className="btn btn-ghost">
          Open the board
        </Link>
      </header>
      <main className="mx-auto max-w-6xl px-5 pb-20">
        <section className="pt-10 pb-14 sm:pt-16">
          <div className="label !text-led-bright">The AI treasurer for youth & rec sports teams</div>
          <h1 className="mt-3 max-w-4xl font-display text-5xl font-bold uppercase leading-[0.95] tracking-wide sm:text-7xl">
            Coach the kids.
            <br />
            <span className="led-amber">Sideline chases the money.</span>
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-chalk-dim">
            Every team has one parent stuck collecting dues from 14 families over a group chat, Venmo requests and a spreadsheet. Sideline turns the coach&apos;s messy message into a PayPal invoice for every family, nudges late payers kindly, pays the referee when the game is final, and shows parents where every dollar went.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href="/board" className="btn btn-primary !min-h-13 !px-6 !text-base">
              Open the treasurer&apos;s board <ArrowRight size={18} />
            </Link>
            {firstOpen && (
              <Link href={`/pay/${firstOpen.id}`} className="btn btn-ghost !min-h-13 !px-6 !text-base">
                See what a parent gets
              </Link>
            )}
            <Link href="/report" className="btn btn-ghost !min-h-13 !px-6 !text-base">
              Season report
            </Link>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map(({ Icon, title, body }, i) => (
            <div key={title} className="card flex flex-col gap-3 p-5">
              <div className="flex items-center justify-between">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-led/12 text-led-bright">
                  <Icon size={20} />
                </span>
                <span className="led text-sm text-chalk-faint">0{i + 1}</span>
              </div>
              <h2 className="font-display text-lg font-semibold uppercase leading-tight tracking-wide">{title}</h2>
              <p className="text-sm leading-relaxed text-chalk-dim">{body}</p>
            </div>
          ))}
        </section>

        <section className="mt-14 grid grid-cols-1 gap-6 rounded-2xl border border-chalk/10 bg-night-850/80 p-6 sm:p-8 lg:grid-cols-3">
          <div>
            <div className="label">Built on PayPal</div>
            <p className="mt-2 text-sm leading-relaxed text-chalk-dim">Invoicing v2 (create, send, QR code, remind, cancel), Payouts, Transaction Search, and signed webhooks: INVOICING.INVOICE.PAID and PAYMENT.PAYOUTS-ITEM.*.</p>
          </div>
          <div>
            <div className="label">AI that does real work</div>
            <p className="mt-2 text-sm leading-relaxed text-chalk-dim">The model reads the message into rules; a deterministic engine does the math, so totals always add up. Reminders are written per family, per language. The treasurer agent answers by calling tools.</p>
          </div>
          <div>
            <div className="label">A scoreboard, not a spreadsheet</div>
            <p className="mt-2 text-sm leading-relaxed text-chalk-dim">AG Grid and AG Charts power the live board and the season report: rows turn green the moment PayPal says a family paid.</p>
          </div>
        </section>
      </main>
    </div>
  );
}
