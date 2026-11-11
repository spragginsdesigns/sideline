// Server half of the AG Studio LLM adapter. Studio's agent loop runs in the browser and sends each
// turn here; this calls the OpenAI Responses API with the server's key, so the key never ships to
// the page. The request and response shapes are Studio's (AgLlmRequest / AgLlmResponse).
import type OpenAI from "openai";
import { openai } from "../ai/client.ts";
import { AI_MODEL } from "../config.ts";

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

/** Studio conversation items -> Responses API input items. Reasoning items are dropped (nothing is stored). */
export function toResponsesInput(items: Json[]): OpenAI.Responses.ResponseInputItem[] {
  const out: OpenAI.Responses.ResponseInputItem[] = [];
  for (const it of items.slice(-MAX_ITEMS)) {
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
  const tools = (req.tools ?? []).slice(0, MAX_TOOLS).filter((t) => t.kind !== "provided");
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
      instructions: (req.instructions ?? "").slice(0, 60_000) || undefined,
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

// A public demo should not be a free LLM endpoint: a small in-memory budget per process.
const g = globalThis as unknown as { __sidelineLlmHits?: number[] };
const PER_MINUTE = Number(process.env.SIDELINE_AI_TURNS_PER_MINUTE || 90);
const PER_DAY = Number(process.env.SIDELINE_AI_TURNS_PER_DAY || 4000);

export function takeTurnBudget(now = Date.now()): void {
  const hits = (g.__sidelineLlmHits ??= []);
  while (hits.length && now - hits[0] > 86_400_000) hits.shift();
  const lastMinute = hits.filter((t) => now - t < 60_000).length;
  if (lastMinute >= PER_MINUTE || hits.length >= PER_DAY) throw new Error("The AI treasurer is busy right now. Try again in a minute.");
  hits.push(now);
}
