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

export async function draftNudges(reqs: NudgeRequest[], ctx: { team: string; treasurer: string; today: string }): Promise<Nudge[]> {
  if (reqs.length === 0) return [];
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      nudges: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            family_id: { type: "string", enum: reqs.map((r) => r.familyId) },
            subject: { type: "string" },
            message: { type: "string" },
            english: { type: "string" },
          },
          required: ["family_id", "subject", "message", "english"],
        },
      },
    },
    required: ["nudges"],
  };
  const system = `You write payment reminders for a volunteer youth-sports treasurer, ${ctx.treasurer} of ${ctx.team}. Today is ${ctx.today}.
Write one reminder per family, in the family's language (the "language" field). Each must:
- greet the parent by first name and mention their player(s) by first name,
- state the charge and the exact amount given (do not change the number),
- sound like a friendly teammate, never a collections notice: no guilt, no threats, no "final notice", no fees,
- offer help if money is tight ("just message me and we'll work it out"),
- say the PayPal link below has the details (the link is added automatically, do not write a URL),
- be 2 to 4 short sentences, plain text, signed "${ctx.treasurer.split(" ")[0]}".
A first reminder is lighter; a second or third can be a little more direct but stays kind.
"subject" is a short subject line in the same language. "english" is a faithful English translation of the message for the treasurer.`;
  const user = JSON.stringify(
    reqs.map((r) => ({
      family_id: r.familyId,
      language: `${r.language} (${LANGUAGE_NAMES[r.language]})`,
      parent_first_name: r.guardianFirstName,
      players: r.playerNames,
      charge: r.chargeTitle,
      amount: r.amount,
      due_date: r.dueDate,
      days_late: r.daysLate,
      reminders_already_sent: r.remindersSoFar,
    })),
  );
  const out = await structured<{ nudges: { family_id: string; subject: string; message: string; english: string }[] }>({
    name: "nudges",
    system,
    user,
    schema,
    effort: "low",
    maxOutputTokens: 9000,
  });
  const byId = new Map(reqs.map((r) => [r.familyId, r]));
  return out.nudges
    .filter((n) => byId.has(n.family_id))
    .map((n) => ({ familyId: n.family_id, language: byId.get(n.family_id)!.language, subject: n.subject.slice(0, 120), message: n.message.slice(0, 1200), english: n.english.slice(0, 1200) }));
}
