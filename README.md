# Sideline

**The AI treasurer for youth and rec sports teams, built on PayPal.**

**Live demo:** https://sideline.172-235-32-223.sslip.io (runs Sideline's PayPal simulator until sandbox keys are configured; the banner says so). Try the board, paste a group-chat message, then open a family's pay page on your phone.

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
10. **A dashboard that builds itself.** The **Studio** tab is an AG Studio dashboard over the same ledger: a stadium scoreboard, a bench of jerseys that turn green as families pay, and charts and tables anyone can rearrange. Ask the treasurer agent "who still owes, and chart it" and it reads the PayPal invoices, answers, then hands the chart to AG Studio's built-in agents, which build it on the page.

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

## How it uses AG Studio

`/studio` is one AG Studio component (`ag-studio-react`) fed by three tables built from the ledger (`src/lib/studio/tables.ts`): family dues, the team ledger, and games with referee payouts.

| AG Studio feature | Where |
|---|---|
| **Custom widgets** | `src/components/studio/widgets.tsx`: a **Scoreboard** (collected vs still owed as home and away scores, percent collected as the clock) and **The bench** (one jersey per family, coloured by payment status). Both read through the widget API, so page filters and filter widgets apply to them, and both appear in the widget menu with their own data-mapping forms and AI metadata. |
| **Theming** | `src/components/studio/theme.ts`: one `studioTheme.withParams(...)` theme restyles Studio's panels, the grid widgets and the chart palette to Sideline's night-game colours. |
| **Layout tools** | Edit and view modes, three pages, a button-filter widget, `responsiveLayoutBreakpoints` with `singleColumnLayout` for phones, and the layout saved per browser with a reset. |
| **Live data** | `src/components/studio/data.ts`: each poll is diffed and applied with `getDataEngine().applyTransaction(...)`, so a payment PayPal reports updates the widgets in place and the table flashes the cells that changed. The custom widgets hold a data handle (`widgetApi.getDataHandle()`), so they stay live across Studio's own refreshes. |
| **Studio Agent Framework** | `src/components/studio/agents.ts`: `createAiHarness` with a **custom treasurer agent** as the primary agent (`directLlmRunner`) next to Studio's five built-in agents. The treasurer has its own tools, defined with `api.defineAiTool`: `get_team_summary`, `list_invoices`, `list_transactions`, `list_games` and `draft_nudges`. When an answer belongs on the page it calls `delegate_to` and Studio's built-in lead, planning, data, page and widget agents build the widget. |
| **Tool components** | `src/components/studio/toolDisplay.tsx` (`aiToolDisplay`): the chat panel shows the PayPal invoices a call read, and nudges as cards in each family's language with one **Send as PayPal reminders** button. The agent only drafts; a person sends. |
| **Your own model** | `src/components/studio/adapter.ts` implements `AgLlmAdapter`. Each turn goes to `POST /api/studio/llm`, which calls the OpenAI Responses API with the server's key, so no key reaches the browser. The route never passes on provider-hosted tools, and a per-visitor and per-day budget (turns and tokens, in memory) keeps a public demo from becoming a free model endpoint. |

AG Studio is a commercial product. Without a licence key it runs in trial mode (a watermark outside localhost); set `NEXT_PUBLIC_AG_STUDIO_LICENSE_KEY` to a key from AG Grid's free 45-day trial to remove it.

## How it uses AI

Every AI feature runs on the OpenAI Responses API (`SIDELINE_MODEL`, default `gpt-5.6-luna`):

- **Reading the message** (`src/lib/ai/rules.ts`): structured output with a strict JSON schema. Family names can only be roster ids (an enum), so the model cannot invent a family. It lists what it applied and anything ambiguous, and treats the pasted text strictly as data. It never does arithmetic.
- **The money engine** (`src/lib/ledger/allocate.ts`) is plain TypeScript in integer cents. It handles team totals, per-player and per-family splits, scholarships (team-absorbed or split), full and partial covers (including chains), "half price" and fixed-amount adjustments, money already paid outside PayPal, and exclusions. The AI only reports fractions ("half" = 0.5); it never computes a dollar figure. Tests are in `tests/allocate.test.ts`.
- **Nudges** (`src/lib/ai/nudges.ts`): one model call per family (so languages never bleed between families), in the family's language with a native-sounding register, plus an English translation for the treasurer. The prompt rules out guilt, fees and threats; nudges unlock only after the due date and never twice in a day.
- **The Studio treasurer agent** (`src/components/studio/agents.ts`): the same read-only tools inside AG Studio's Agent Framework, plus delegation to Studio's built-in agents to build widgets. Six agents share one model through a server-side adapter. Each built-in agent keeps its own instructions, with Sideline's house rules appended.
- **Ask the treasurer** (`src/lib/ai/treasurer.ts`): a function-calling loop over `get_team_summary`, `list_invoices`, `list_transactions` (PayPal Transaction Search in live mode) and `list_games`. Tool names follow PayPal's Agent Toolkit; the tools are implemented directly against the REST API here. The agent is read-only, answers in the language you ask in, and the UI shows which tools ran.

## Built with

- Next.js 16, React 19, TypeScript, Tailwind CSS 4
- **AG Studio** 3.1 (the Studio dashboard: custom widgets, theming, responsive layout, live transactions, the Studio Agent Framework), which brings AG Grid Enterprise and AG Charts Enterprise for its built-in widgets
- **AG Grid** (the live family board, the transaction ledger) and **AG Charts** (collection donut, bank balance, spending breakdown), Community editions, on the Board and the Season report
- PayPal REST APIs, OpenAI Responses API
- Code written with help from AI coding agents (Claude Code)

## Run it

```bash
npm install
cp .env.example .env.local   # add OPENAI_API_KEY; PayPal keys are optional
npm run dev                  # http://localhost:3000
npm test                     # money engine, PayPal client and Studio data tests
```

### With the PayPal sandbox

1. Create a sandbox REST app at developer.paypal.com and put its client id and secret in `.env.local`. Enable **Payouts** on the app.
2. Create a sandbox **personal** account. Use its email for one family in `src/lib/seed.ts` so you can pay as that family.
3. Expose the app (for example with `ngrok http 3000`), set `SIDELINE_PUBLIC_URL`, and add a webhook for `<url>/api/paypal/webhook` subscribed to `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED` and `PAYMENT.PAYOUTS-ITEM.*`. Put its id in `PAYPAL_WEBHOOK_ID`. Without a public URL, the board still picks up payments by polling.

The demo team (Valley Hawks U11 Girls, Fresno CA) and every family in it are fictional. **Reset demo team** on the board restores the starting state.

### Public demo settings

The hosted demo is one shared team, so it sets a few optional limits (all off by default):

| Variable | Demo value | What it does |
|---|---|---|
| `SIDELINE_AI_PER_IP_HOURLY` | 40 | AI calls one visitor can make per hour |
| `SIDELINE_AI_DAILY_CAP` | 400 | AI calls the deployment can make per day |
| `SIDELINE_IDLE_RESET_MINUTES` | 30 | the demo team resets after 30 idle minutes, so every visitor starts fresh |
| `SIDELINE_MAX_CHARGES` | 25 | most charges the shared team can hold |

## Project layout

```
src/lib/ledger/allocate.ts   deterministic money engine
src/lib/ai/                  message reader, nudges, treasurer agent
src/lib/paypal/              gateway interface, live REST client, simulator
src/lib/webhooks.ts          one idempotent handler for every PayPal event
src/lib/sideline.ts          app services (charges, reminders, payouts, sync)
src/lib/studio/              the tables AG Studio reads, and the server half of its LLM adapter
src/components/studio/       the AG Studio dashboard: widgets, theme, agents, tool components
src/app/studio               the Studio page
src/app/board                treasurer dashboard
src/app/pay/[invoiceId]      the parent's mobile pay page
src/app/report               public season report
```

## License

MIT for everything in this repository. AG Studio, AG Grid Enterprise and AG Charts Enterprise are commercial libraries from AG Grid Ltd, installed from npm under their own licence and not part of this repository.
