// Anthropic call with the user's own key (BYOK), straight from the browser. The key stays in memory unless the user
// ticks "remember on this device". Mail text is masked before it is sent (packages/engine/llm.ts buildUserMessage).
import Anthropic from "@anthropic-ai/sdk";
import { PROMPT_VERSION, SCHEMA, SYSTEM, type Shadow, buildUserMessage, validateAnswer } from "../../../../packages/engine/llm.ts";
import type { StoredMail } from "./local";
import { llmKey, llmModel } from "./llm-settings";

/** One mail -> validated shadow answer. Never throws for model output problems; they become validation errors. */
export async function askLlm(mail: StoredMail, people: string[]): Promise<Shadow> {
  const model = llmModel();
  const client = new Anthropic({ apiKey: llmKey(), dangerouslyAllowBrowser: true, maxRetries: 2 });
  const base = { at: new Date().toISOString().slice(0, 16), model, promptVersion: PROMPT_VERSION };
  const params = {
    model,
    max_tokens: 2048,
    system: SYSTEM,
    output_config: { effort: "low" as const, format: { type: "json_schema" as const, schema: SCHEMA as unknown as Record<string, unknown> } },
    messages: [{ role: "user" as const, content: buildUserMessage(mail, people) }],
  };
  // Opus / Sonnet: server-side fallback re-runs a policy-declined request on a fallback model in the same call.
  const res = model === "claude-haiku-5-5"
    ? await client.messages.create(params)
    : await client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
  if (res.stop_reason === "refusal") return { ...base, answer: null, valid: false, errors: ["모델이 응답을 거절했습니다"] };
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return { ...base, answer: null, valid: false, errors: ["JSON이 아닌 응답"] }; }
  const { answer, errors } = validateAnswer(parsed, mail);
  return { ...base, answer: answer ?? (parsed as Shadow["answer"]), valid: !errors.length, errors };
}

export function llmErrorMessage(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "API 키가 올바르지 않습니다.";
  if (e instanceof Anthropic.PermissionDeniedError) return "이 키로는 선택한 모델을 쓸 수 없습니다.";
  if (e instanceof Anthropic.RateLimitError) return "호출 한도에 걸렸습니다. 잠시 뒤 다시 시도하세요.";
  if (e instanceof Anthropic.BadRequestError) return "요청이 거부되었습니다: " + e.message;
  if (e instanceof Anthropic.APIConnectionError) return "Anthropic API에 연결할 수 없습니다(네트워크 확인).";
  if (e instanceof Anthropic.APIError) return `API 오류 ${e.status}: ${e.message}`;
  return (e as Error)?.message || String(e);
}
