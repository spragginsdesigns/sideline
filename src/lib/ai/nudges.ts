// Writes a short, warm reminder for each family that is behind, in that
// family's own language, with an English line so the treasurer can check it.
import { structured } from "./client.ts";
import { LANGUAGE_NAMES, type LanguageCode } from "../types.ts";

export interface NudgeRequest {
  familyId: string;
  guardianFirstName: string;
  surname: string;
  language: LanguageCode;
  playerNames: string[];
  chargeTitle: string;
  amount: string;
  dueDate: string | null;
  daysLate: number;
  remindersSoFar: number;
}

export interface Nudge {
  familyId: string;
  language: LanguageCode;
  subject: string;
  message: string;
  english: string;
}

const STYLE: Partial<Record<LanguageCode, string>> = {
  es: "Write like a friendly Mexican-American or Central American team mom texting another parent: warm and casual (\"mándame un mensajito y vemos cómo le hacemos\"), use \"cuota\" not \"cargo\", keep accents (Sofía, Lucía), never sound like a bank.",
  vi: "Write like a friendly fellow parent, polite and warm (use \"anh/chị\" naturally), never like a bank notice.",
  zh: "Write in simplified Chinese like a friendly fellow parent in a WeChat group, warm and polite, never like a bank notice.",
  tl: "Write in natural Taglish-friendly Tagalog like a friendly fellow parent, warm and polite.",
  hmn: "Write in White Hmong (Hmoob Dawb) like a friendly fellow parent, simple and warm.",
  pa: "Write in Punjabi (Gurmukhi script) like a friendly fellow parent, warm and respectful.",
  en: "Write like a friendly fellow parent texting, warm and casual.",
};

async function draftOne(r: NudgeRequest, ctx: { team: string; treasurer: string; today: string }): Promise<Nudge> {
  const lang = `${LANGUAGE_NAMES[r.language]} (${r.language})`;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: { subject: { type: "string" }, message: { type: "string" }, english: { type: "string" } },
    required: ["subject", "message", "english"],
  };
  const system = `You write one payment reminder for ${ctx.treasurer}, the volunteer treasurer of ${ctx.team}. Today is ${ctx.today}.
Write the subject AND the message entirely in ${lang}. Translate the charge name into ${lang} too. ${STYLE[r.language] ?? ""}
The message must:
- greet the parent by first name and mention their player(s) by first name, spelled exactly as given,
- state the charge and the amount exactly as given (write whole-dollar amounts without cents, e.g. "$30"; never change a number),
- sound like a friendly teammate, never a collections notice: no guilt, no threats, no "final notice", no fees,
- offer help if money is tight,
- say "the PayPal link in this message" (in ${lang}) has the details; never write a URL,
- be 2 to 4 short sentences, plain text, signed "${ctx.treasurer.split(" ")[0]}".
A first reminder is lighter; a second or third can be a little more direct but stays kind.
"english" is a faithful English translation of the message, for the treasurer to check.`;
  const amount = r.amount.endsWith(".00") ? r.amount.slice(0, -3) : r.amount;
  const user = JSON.stringify({
    parent_first_name: r.guardianFirstName,
    players: r.playerNames,
    charge: r.chargeTitle,
    amount,
    due_date: r.dueDate,
    days_late: r.daysLate,
    reminders_already_sent: r.remindersSoFar,
  });
  const out = await structured<{ subject: string; message: string; english: string }>({ name: "nudge", system, user, schema, effort: "low", maxOutputTokens: 3000 });
  return { familyId: r.familyId, language: r.language, subject: out.subject.slice(0, 120), message: out.message.slice(0, 1200), english: out.english.slice(0, 1200) };
}

/** One model call per family, a few at a time, so one family's language never bleeds into another's. */
export async function draftNudges(reqs: NudgeRequest[], ctx: { team: string; treasurer: string; today: string }): Promise<Nudge[]> {
  const out: Nudge[] = [];
  const LIMIT = 5;
  for (let i = 0; i < reqs.length; i += LIMIT) {
    out.push(...(await Promise.all(reqs.slice(i, i + LIMIT).map((r) => draftOne(r, ctx)))));
  }
  return out;
}
