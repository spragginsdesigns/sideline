// Server half of the AG Studio LLM adapter. Studio's agent loop runs in the browser and sends each
// turn here; this calls the OpenAI Responses API with the server's key, so the key never ships to
// the page. The request and response shapes are Studio's (AgLlmRequest / AgLlmResponse).
import type OpenAI from "openai";
import { openai } from "../ai/client.ts";
import { AI_MODEL } from "../config.ts";
import { DemoLimitError } from "../demoGuard.ts";

type Json = Record<string, unknown>;

export interface StudioTurnRequest {
  input: Json[];
  instructions?: string;
  tools?: { name: string; description: string; parameters: Json; kind?: string; provider?: unknown }[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  responseFormat?: { type: "text" } | { type: "json"; name: string; description?: string; schema: Json };
}

export interface StudioTurnResponse {
  id: string;
  createdAt: number;
  status: "completed" | "failed" | "incomplete";
  output: Json[];
  error?: { code: string; message: string };
  incompleteDetails?: { reason?: string };
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; reasoningTokens?: number; cachedInputTokens?: number };
  model?: string;
}

const MAX_ITEMS = 400;
const MAX_TOOLS = 40;

function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => (c && typeof c === "object" ? ((c as Json).text ?? (c as Json).refusal ?? "") : ""))
    .filter((s) => typeof s === "string")
    .join("");
}

/**
 * Studio conversation items -> Responses API input items. Reasoning items are dropped (nothing is
 * stored). A tool call without its result, or a result without its call (a run cancelled mid-tool,
 * or the window cutting between the two), is dropped too: the API rejects the whole turn otherwise.
 */
export function toResponsesInput(items: Json[]): OpenAI.Responses.ResponseInputItem[] {
  const out: OpenAI.Responses.ResponseInputItem[] = [];
  const window = items.slice(-MAX_ITEMS);
  const called = new Set(window.filter((i) => i.type === "function_call").map((i) => String(i.callId)));
  const answered = new Set(window.filter((i) => i.type === "function_call_output").map((i) => String(i.callId)));
  for (const it of window) {
    if (it.type === "function_call" && !answered.has(String(it.callId))) continue;
    if (it.type === "function_call_output" && !called.has(String(it.callId))) continue;
    if (it.type === "message") {
      const role = it.role === "assistant" ? "assistant" : it.role === "system" ? "developer" : "user";
      const body = text(it.content);
      if (body) out.push({ role, content: body } as OpenAI.Responses.ResponseInputItem);
    } else if (it.type === "function_call") {
      out.push({ type: "function_call", call_id: String(it.callId), name: String(it.name), arguments: String(it.arguments ?? "{}") });
    } else if (it.type === "function_call_output") {
      out.push({ type: "function_call_output", call_id: String(it.callId), output: String(it.output ?? "") });
    }
  }
  return out;
}

export async function runStudioTurn(req: StudioTurnRequest, signal?: AbortSignal): Promise<StudioTurnResponse> {
  if (!Array.isArray(req.input) || req.input.length === 0) throw new Error("Expected a conversation to answer.");
  // Provider-hosted tools (web search, code) are never passed on: a visitor must not run them on this key.
  const tools = (req.tools ?? []).filter((t) => t.kind !== "provided").slice(0, MAX_TOOLS);
  const tool_choice =
    typeof req.toolChoice === "object" && req.toolChoice
      ? ({ type: "function", name: req.toolChoice.name } as const)
      : (req.toolChoice ?? "auto");
  const format = req.responseFormat;
  const r = await openai().responses.create(
    {
      model: AI_MODEL,
      store: false,
      reasoning: { effort: "low" },
      max_output_tokens: 8000,
      instructions: (req.instructions ?? "").slice(0, 80_000) || undefined,
      input: toResponsesInput(req.input),
      tools: tools.map((t) => ({ type: "function" as const, name: t.name, description: t.description, parameters: t.parameters, strict: false })),
      tool_choice: tools.length ? tool_choice : undefined,
      parallel_tool_calls: true,
      text: format?.type === "json" ? { format: { type: "json_schema", name: format.name, description: format.description, schema: format.schema, strict: false } } : undefined,
    },
    { signal },
  );

  const output: Json[] = [];
  for (const o of r.output) {
    if (o.type === "message") {
      const body = o.content.map((c) => (c.type === "output_text" ? c.text : "")).join("");
      if (body) output.push({ id: o.id, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: body, annotations: [] }] });
    } else if (o.type === "function_call") {
      output.push({ id: o.id ?? o.call_id, kind: "output", type: "function_call", callId: o.call_id, name: o.name, arguments: o.arguments || "{}", status: "completed" });
    }
  }
  const status = r.status === "completed" ? "completed" : r.status === "incomplete" ? "incomplete" : "failed";
  return {
    id: r.id,
    createdAt: Date.now(),
    status,
    output,
    error: r.error ? { code: r.error.code ?? "provider_error", message: r.error.message } : undefined,
    incompleteDetails: r.incomplete_details ? { reason: r.incomplete_details.reason } : undefined,
    usage: r.usage
      ? {
          inputTokens: r.usage.input_tokens,
          outputTokens: r.usage.output_tokens,
          totalTokens: r.usage.total_tokens,
          reasoningTokens: r.usage.output_tokens_details?.reasoning_tokens,
          cachedInputTokens: r.usage.input_tokens_details?.cached_tokens,
        }
      : undefined,
    model: r.model,
  };
}

// A public demo should not be a free model endpoint, and one visitor should not be able to use up
// everyone's turns. Budgets are in memory, per process: per visitor per minute, everyone per minute,
// everyone per day, and tokens per day. One question to the Studio agents is roughly 10 to 25 turns.
interface Budget {
  all: number[];
  byVisitor: Map<string, number[]>;
  tokens: { day: string; used: number };
}
const g = globalThis as unknown as { __sidelineAiBudget?: Budget };
const limit = (name: string, fallback: number) => Number(process.env[name] || fallback);
const MINUTE = 60_000;
const DAY = 86_400_000;

function budget(): Budget {
  return (g.__sidelineAiBudget ??= { all: [], byVisitor: new Map(), tokens: { day: "", used: 0 } });
}

/** The address the nearest proxy saw. The last x-forwarded-for entry is the one a client cannot forge. */
export function visitor(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
  return forwarded?.at(-1) ?? req.headers.get("x-real-ip") ?? "local";
}

/** Take `cost` turns for this visitor, or throw. Call it only for a request that is otherwise valid. */
export function takeTurnBudget(who = "local", now = Date.now(), cost = 1): void {
  const b = budget();
  while (b.all.length && now - b.all[0] > DAY) b.all.shift();
  const mine = (b.byVisitor.get(who) ?? []).filter((t) => now - t < MINUTE);
  const today = new Date(now).toISOString().slice(0, 10);
  if (b.tokens.day !== today) b.tokens = { day: today, used: 0 };
  const busy = new DemoLimitError("The AI treasurer is busy right now. Try again in a minute.");
  if (mine.length + cost > limit("SIDELINE_AI_TURNS_PER_VISITOR_PER_MINUTE", 60)) throw busy;
  if (b.all.filter((t) => now - t < MINUTE).length + cost > limit("SIDELINE_AI_TURNS_PER_MINUTE", 240)) throw busy;
  if (b.all.length + cost > limit("SIDELINE_AI_TURNS_PER_DAY", 8000) || b.tokens.used >= limit("SIDELINE_AI_TOKENS_PER_DAY", 40_000_000)) {
    throw new DemoLimitError("The AI treasurer has answered all it can today. It is back tomorrow.");
  }
  for (let i = 0; i < cost; i++) {
    mine.push(now);
    b.all.push(now);
  }
  b.byVisitor.set(who, mine);
  if (b.byVisitor.size > 5000) for (const [k, v] of b.byVisitor) if (v.every((t) => now - t >= MINUTE)) b.byVisitor.delete(k);
}

export function recordTokens(tokens: number | undefined, now = Date.now()): void {
  const b = budget();
  const today = new Date(now).toISOString().slice(0, 10);
  if (b.tokens.day !== today) b.tokens = { day: today, used: 0 };
  b.tokens.used += tokens ?? 0;
}
