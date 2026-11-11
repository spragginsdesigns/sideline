// Browser half of the AG Studio LLM adapter (AgLlmAdapter). Studio's agent loop asks it for one
// turn at a time; it posts the turn to /api/studio/llm (where the model key lives) and replays the
// answer to Studio as AG-UI content events.
import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";

const CHUNK = 28;

function failed(message: string): AgLlmResponse {
  return { id: `err-${Date.now()}`, createdAt: Date.now(), status: "failed", output: [], error: { code: "turn_failed", message } };
}

export function sidelineAdapter(endpoint = "/api/studio/llm"): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options) {
      const complete: Promise<AgLlmResponse> = (async () => {
        try {
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              input: request.input,
              instructions: request.instructions,
              tools: request.tools,
              toolChoice: request.toolChoice,
              responseFormat: request.responseFormat,
            }),
            signal: options?.signal,
          });
          const json = (await res.json().catch(() => ({}))) as AgLlmResponse & { error?: string | { code: string; message: string } };
          if (!res.ok) return failed(typeof json.error === "string" ? json.error : `The AI treasurer could not answer (${res.status}).`);
          return json as AgLlmResponse;
        } catch (e) {
          if (options?.signal?.aborted) return { id: `cancel-${Date.now()}`, createdAt: Date.now(), status: "cancelled", output: [] };
          return failed((e as Error).message);
        }
      })();

      async function* stream(): AsyncGenerator<AgAiEvent> {
        const response = await complete;
        for (const item of response.output as AgAiOutputItem[]) {
          if (item.type === "message") {
            const body = item.content.map((c) => (c.type === "text" ? c.text : "")).join("");
            yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
            for (let i = 0; i < body.length; i += CHUNK) {
              yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: body.slice(i, i + CHUNK) };
              await new Promise((r) => setTimeout(r, 12)); // let the panel paint the words as they land
            }
            yield { type: "TEXT_MESSAGE_END", messageId: item.id };
          } else if (item.type === "function_call") {
            yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name };
            yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
            yield { type: "TOOL_CALL_END", toolCallId: item.callId };
          }
        }
      }

      return { stream: stream(), complete };
    },
  };
}
