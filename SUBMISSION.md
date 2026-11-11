# Devpost submission draft: Sideline

Paste-ready text for the PayPal AI Hackathon form. Facts only; edit freely.

## Tagline
The AI treasurer for youth sports teams: paste the coach's group chat, every family gets a PayPal invoice, refs get paid at the final whistle.

## Links
- Live demo: https://sideline.172-235-32-223.sslip.io (PayPal simulator mode until sandbox keys are added; labelled in the app)
- Code (MIT): https://github.com/spragginsdesigns/sideline
- Video: <YouTube link>

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

## How we built it
- Next.js 16, React 19, TypeScript, Tailwind CSS 4.
- PayPal REST: Invoicing v2 (create, send, QR code, remind, record payment, cancel), Payouts v1, Transaction Search v1, webhook signature verification. Every money step is idempotent (client idempotency keys, deterministic invoice numbers, one sender_batch_id per game, webhook de-duplication).
- AI: OpenAI Responses API (gpt-5.6-luna) with strict JSON schemas whose family fields are enums of the roster, so the model cannot invent a family or compute a dollar figure; per-family reminder calls; a function-calling treasurer agent.
- AG Grid Community (theming API, custom renderers, external filters, quick filter, pinned totals row, flashCells) and AG Charts Community.
- AI tools used to build it: Claude Code (Anthropic) for development; ElevenLabs for the video voiceover and music.

## Challenges we ran into
Real group chats are messy: half-Spanish messages, "she already paid half in cash", "covering half of the Vangs". Early versions let the model do arithmetic and got "half" wrong for a two-player family; the fix was to have the model report rules and fractions only, with every cent computed by a tested engine.

## Accomplishments that we're proud of
- Money that reconciles to the cent, with 20 unit tests on the engine.
- Reminders a parent actually wants to receive, in their own language.
- Safe to click twice: no double invoices, no double referee payouts.

## What we learned
Let the AI read and write words; keep it away from the math.

## What's next for Sideline
Multi-team leagues, recurring dues, PayPal Venmo-first checkout for teen-heavy teams, and an end-of-season export for the league.

## Built with
nextjs, react, typescript, tailwindcss, paypal-invoicing, paypal-payouts, paypal-webhooks, openai, ag-grid, ag-charts
