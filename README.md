# Sideline

**The AI treasurer for youth and rec sports teams, built on PayPal.**

Every youth team has a volunteer parent collecting dues from 12 to 20 families. They also handle the exceptions (siblings, a scholarship kid, one family covering for another), pay the referees, and answer "where did our money go?". Today that runs on a group chat, Venmo requests and a spreadsheet.

Sideline turns that into a scoreboard:

1. **Paste the coach's message.** "Fresno tournament is $450 for the team, split it, the Garcias are covering the Nguyens, Mia is on scholarship, the Chens already gave me $40 cash." The AI reads it into rules; a deterministic engine does the math in cents and accounts for every one: *invoiced + already paid + covered by the team fund = $450.00* (any rounding, at most a few cents so every player pays the same, goes to the team fund).
2. **Every family gets its own PayPal invoice**, with a QR code and a mobile pay page. Families can pay with PayPal, Venmo or a card.
3. **The board turns green live.** The `INVOICING.INVOICE.PAID` webhook flips the family's row the moment they pay.
4. **Cash still counts.** Money handed over in cash, Venmo or Zelle is credited to that family (never spread onto everyone else), and a cash payment after invoicing is recorded on the family's PayPal invoice with the Invoicing payments API.
5. **Kind nudges in the family's language, only once they're late.** The AI writes each late family a short, warm reminder in their own language (Spanish, Vietnamese, Hmong, Punjabi, Tagalog, Chinese…) with an English check for the treasurer. It is sent as a PayPal invoice reminder.
6. **Refs are paid at the final whistle.** Marking a game final pays the referee through PayPal Payouts, and the `PAYMENT.PAYOUTS-ITEM.SUCCEEDED` webhook confirms it.
7. **Ask the treasurer anything.** "How much is left for Fresno, and who's behind?" A tool-calling agent answers from the ledger and PayPal, never guessing a number.
8. **The parent's pay page speaks their language**: Spanish, Vietnamese, Hmong, Punjabi, Tagalog or Chinese, with English one tap away.
9. **A season report for every parent**: every dollar in and out, charted. Individual families' payments are rolled up so nobody's finances are on display.

## How it uses PayPal

| PayPal API | Where |
|---|---|
| OAuth 2.0 client credentials | `src/lib/paypal/live.ts` (cached token, one retry on 401) |
| Invoicing v2: create draft, send, generate QR code, remind, record payment (cash/check), cancel, show | `createCharge`, `sendReminders`, `recordOfflinePayment` in `src/lib/sideline.ts` |
| Payouts v1: create batch payout | `finalizeGame` in `src/lib/sideline.ts` |
| Transaction Search v1 | the treasurer agent's `list_transactions` tool |
| Webhooks: verify signature, `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED`, `PAYMENT.PAYOUTS-ITEM.*` | `src/app/api/paypal/webhook/route.ts`, `src/lib/webhooks.ts` (idempotent by event id) |

**Money safety.** Every step is idempotent: the browser sends an idempotency key with each charge, so a double-click can't bill families twice. Invoice numbers are deterministic per charge and family, each PayPal invoice id is saved the moment PayPal returns it so a retry resumes instead of duplicating, a game is claimed before its referee payout and its `sender_batch_id` is fixed per game, and webhook events are de-duplicated by id. All rules sent from the browser are re-validated on the server: integer cents, roster ids, amounts capped at $20,000.

If webhooks can't reach the app (for example on localhost), the board also polls open invoices with `GET /v2/invoicing/invoices/{id}` and feeds anything paid through the same handler.

**No keys? It still runs.** Without `PAYPAL_CLIENT_ID`/`PAYPAL_CLIENT_SECRET`, Sideline swaps in a local simulator (`src/lib/paypal/simulator.ts`). The simulator returns PayPal-shaped responses and emits PayPal-shaped webhook events into the same handler, so the whole product can be tried in one command. A banner and badge always say which mode you are in.

## How it uses AI

All three AI features run on the OpenAI Responses API (`SIDELINE_MODEL`, default `gpt-5.6-luna`):

- **Reading the message** (`src/lib/ai/rules.ts`): structured output with a strict JSON schema. Family names can only be roster ids (an enum), so the model cannot invent a family. It lists what it applied and anything ambiguous, and treats the pasted text strictly as data. It never does arithmetic.
- **The money engine** (`src/lib/ledger/allocate.ts`) is plain TypeScript in integer cents. It handles team totals, per-player and per-family splits, scholarships (team-absorbed or split), full and partial covers (including chains), "half price" and fixed-amount adjustments, money already paid outside PayPal, and exclusions. The AI only reports fractions ("half" = 0.5); it never computes a dollar figure. Tests are in `tests/allocate.test.ts`.
- **Nudges** (`src/lib/ai/nudges.ts`): one model call per family (so languages never bleed between families), in the family's language with a native-sounding register, plus an English translation for the treasurer. The prompt rules out guilt, fees and threats; nudges unlock only after the due date and never twice in a day.
- **Ask the treasurer** (`src/lib/ai/treasurer.ts`): a function-calling loop over `get_team_summary`, `list_invoices`, `list_transactions` (PayPal Transaction Search in live mode) and `list_games`. Tool names follow PayPal's Agent Toolkit; the tools are implemented directly against the REST API here. The agent is read-only, answers in the language you ask in, and the UI shows which tools ran.

## Built with

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **AG Grid** (the live family board, the transaction ledger) and **AG Charts** (collection donut, bank balance, spending breakdown), both Community editions
- PayPal REST APIs, OpenAI Responses API
- Code written with help from AI coding agents (Claude Code)

## Run it

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY; PayPal keys are optional
npm run dev                  # http://localhost:3000
npm test                     # money engine + PayPal client tests
```

### With the PayPal sandbox

1. Create a sandbox REST app at developer.paypal.com and put its client id and secret in `.env.local`. Enable **Payouts** on the app.
2. Create a sandbox **personal** account. Use its email for one family in `src/lib/seed.ts` so you can pay as that family.
3. Expose the app (for example with `ngrok http 3000`), set `SIDELINE_PUBLIC_URL`, and add a webhook for `<url>/api/paypal/webhook` subscribed to `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED` and `PAYMENT.PAYOUTS-ITEM.*`. Put its id in `PAYPAL_WEBHOOK_ID`. Without a public URL, the board still picks up payments by polling.

The demo team (Valley Hawks U11 Girls, Fresno CA) and every family in it are fictional. **Reset demo team** on the board restores the starting state.

## Project layout

```
src/lib/ledger/allocate.ts   deterministic money engine
src/lib/ai/                  message reader, nudges, treasurer agent
src/lib/paypal/              gateway interface, live REST client, simulator
src/lib/webhooks.ts          one idempotent handler for every PayPal event
src/lib/sideline.ts          app services (charges, reminders, payouts, sync)
src/app/board                treasurer dashboard
src/app/pay/[invoiceId]      the parent's mobile pay page
src/app/report               public season report
```

## License

MIT
