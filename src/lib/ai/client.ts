import OpenAI from "openai";
import { AI_MODEL } from "../config.ts";

let client: OpenAI | null = null;
export function openai(): OpenAI {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set, so the AI treasurer is offline.");
  client ??= new OpenAI({ timeout: 60_000, maxRetries: 1 });
  return client;
}

export async function structured<T>(opts: {
  name: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort?: "low" | "medium";
  maxOutputTokens?: number;
}): Promise<T> {
  const r = await openai().responses.create({
    model: AI_MODEL,
    reasoning: { effort: opts.effort ?? "low" },
    max_output_tokens: opts.maxOutputTokens ?? 6000,
    input: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    text: { format: { type: "json_schema", name: opts.name, strict: true, schema: opts.schema } },
  });
  if (r.status !== "completed" || !r.output_text) {
    throw new Error(`The model did not finish (${r.status}${r.incomplete_details ? `: ${JSON.stringify(r.incomplete_details)}` : ""}).`);
  }
  return JSON.parse(r.output_text) as T;
}
