# Devpost submission draft: Sideline

Paste-ready text for the PayPal AI Hackathon form. Facts only; edit freely.

## Tagline
The AI treasurer for youth sports teams: paste the coach's group chat, every family gets a PayPal invoice, and an AG Studio scoreboard builds itself as they pay.

## Links
- Live demo: https://sideline.172-235-32-223.sslip.io (runs on the real PayPal sandbox; the badge in the app says which mode is running)
- Code (MIT): https://github.com/spragginsdesigns/sideline
- Video: https://youtu.be/fvb8oSl9lVQ

## Inspiration
Every youth and rec team has one volunteer parent who ends up as treasurer: collecting dues from 12 to 20 families, handling the exceptions (siblings, a scholarship kid, one family covering another), paying referees, and answering "where did our money go?". It runs on a group chat, Venmo requests and a spreadsheet. US families spend more than $40 billion a year on kids' sports, and the money still moves by group text.

## What it does
1. The treasurer pastes the coach's message ("Fresno tournament is $450, split it, the Garcias are covering the Nguyens, Mia is on scholarship"). AI reads it into rules; a deterministic engine does the math in integer cents and refuses to send anything that doesn't reconcile.
2. Every family gets its own PayPal invoice with a QR code and a mobile pay page in their language (Spanish, Vietnamese, Hmong, Punjabi, Tagalog, Chinese).
3. A live AG Grid scoreboard: PayPal's INVOICING.INVOICE.PAID webhook turns a family's row green the moment they pay. Cash payments are recorded on the PayPal invoice.
4. Late families get a kind reminder written in their own language, sent as a PayPal invoice reminder.
5. Marking a game final pays the referee through PayPal Payouts, confirmed by webhook.
6. "Ask the treasurer": a tool-calling agent answers money questions from the ledger and PayPal, never guessing.
7. A season report for parents (AG Charts + AG Grid) that shows totals, not each family's finances.
8. The Studio tab: an AG Studio dashboard over the same ledger. A stadium scoreboard and a bench of jerseys (two custom widgets) turn green as PayPal reports payments. Ask the treasurer agent "who still owes, and chart it": it reads the PayPal invoices, answers, then hands the chart to AG Studio's built-in agents, which build it on the page. Ask it to nudge late families and each reminder appears in the chat as a card in the family's language, with one button that sends them as PayPal reminders. The agent drafts; a person sends.

## How we built it
- Next.js 16, React 19, TypeScript, Tailwind CSS 4.
- PayPal REST: Invoicing v2 (create, send, QR code, remind, record payment, cancel), Payouts v1, Transaction Search v1, webhook signature verification. Every money step is idempotent (client idempotency keys, deterministic invoice numbers, one sender_batch_id per game, webhook de-duplication).
- AI: OpenAI Responses API (gpt-5.6-luna) with strict JSON schemas whose family fields are enums of the roster, so the model cannot invent a family or compute a dollar figure; per-family reminder calls; a function-calling treasurer agent; and six agents in AG Studio's Agent Framework (our treasurer agent plus Studio's built-in team) sharing that model.
- AG Studio 3.1 (the Studio tab):
  - Custom widgets: a Scoreboard and The bench, built on the widget API with data handles, so filters, cross filters and live updates apply to them like any built-in widget.
  - Theming: one Studio theme for the panels, grid widgets and chart palette.
  - Layout tools: edit and view modes, three pages, a button-filter widget, a single-column responsive layout for phones, the layout saved per browser.
  - Live data: each change from PayPal is applied as a Studio transaction, so widgets update in place.
  - Studio Agent Framework: a custom treasurer agent is the primary agent, next to Studio's five built-in agents. It has its own tools (PayPal invoices, the ledger and transaction search, referee payouts, nudge drafting) and delegates widget building to Studio's lead, planning, data, page and widget agents. Tool components render PayPal invoices and nudge cards in the chat panel.
  - Our own model behind an `AgLlmAdapter`: every turn goes through our server, so the model key never reaches the browser.
- AG Grid Community (theming API, custom renderers, external filters, quick filter, pinned totals row, flashCells) and AG Charts Community on the Board and the Season report.
- AI tools used to build it: Claude Code (Anthropic) for development; ElevenLabs for the video voiceover and music.

## Challenges we ran into
Real group chats are messy: half-Spanish messages, "she already paid half in cash", "covering half of the Vangs". Early versions let the model do arithmetic and got "half" wrong for a two-player family; the fix was to have the model report rules and fractions only, with every cent computed by a tested engine.

## Accomplishments that we're proud of
- Money that reconciles to the cent, with 36 unit tests, including that the Studio dashboard's totals equal the ledger's.
- A dashboard that builds itself: one sentence to our agent, and AG Studio's agents plan, place and wire up the widgets on live PayPal data.
- Reminders a parent actually wants to receive, in their own language.
- Safe to click twice: no double invoices, no double referee payouts.

## What we learned
Let the AI read and write words; keep it away from the math.

## Where it stands today
Sideline runs end to end on the real PayPal sandbox, and the demo video was recorded on it. In the recorded run on Nov 11, 2026:
- 12 invoices were created and sent through Invoicing v2, each with PayPal's QR code (for example INV2-VEJJ-SQ5B-2KKY-2CGB, $56.26).
- A buyer paid one by card on PayPal's own invoice page. PayPal's signed INVOICING.INVOICE.PAID webhook (WH-6FU587433B5938032-2VR49330A0738330A) credited it on the board about 11 seconds later.
- During the AG Studio scene, two more sandbox payments arrived by signed webhook and the scoreboard and jerseys updated live, with no reload.
- Late families' nudges went out as real PayPal invoice reminders.
- The referee was paid through Payouts v1 (batch XQENV8Q3ZVYBS). The demo referee's email has no PayPal account, so PayPal holds that payout as UNCLAIMED until it is claimed, and the app says so.

The hosted demo runs on the same sandbox app. The built-in simulator is still there for anyone who runs the repo without PayPal keys, and the app always shows which mode it is in.

## What's next for Sideline
Multi-team leagues, recurring dues, PayPal Venmo-first checkout for teen-heavy teams, and an end-of-season export for the league.

## Built with
nextjs, react, typescript, tailwindcss, paypal-invoicing, paypal-payouts, paypal-webhooks, openai, ag-studio, ag-grid, ag-charts
