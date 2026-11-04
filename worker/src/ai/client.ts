// Claude 呼び出しの境界（architecture 6.1、ADR-0005）。Structured Outputs（output_config.format）だけを使う。
// 入力「system + user + JSON Schema」→ 出力「パース済み JSON か失敗理由」。再試行はしない。
import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../env";

export type Effort = "low" | "medium" | "high";

export type AiRequest = {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  effort: Effort;
};

export type AiResult =
  | { ok: true; json: unknown; model: string; input_tokens: number; output_tokens: number }
  | { ok: false; error: string; model: string; input_tokens?: number; output_tokens?: number };

export type AiCaller = (env: Pick<Env, "ANTHROPIC_API_KEY" | "ANTHROPIC_MODEL">, req: AiRequest) => Promise<AiResult>;

export const TIMEOUT_MS = 20_000;
export const MAX_TOKENS = 4096;

export const callClaude: AiCaller = async (env, req) => {
  const model = env.ANTHROPIC_MODEL;
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: "not_configured: ANTHROPIC_API_KEY", model };
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: TIMEOUT_MS });
  try {
    const res = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: req.user }],
      output_config: { effort: req.effort, format: { type: "json_schema", schema: req.schema } },
    });
    const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
    if (res.stop_reason === "refusal") {
      const category = res.stop_details && "category" in res.stop_details ? (res.stop_details as { category?: string | null }).category : null;
      return { ok: false, error: `refusal:${category ?? "unknown"}`, model, ...usage };
    }
    if (res.stop_reason === "max_tokens") return { ok: false, error: "max_tokens", model, ...usage };
    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { ok: false, error: "no_text_block", model, ...usage };
    try {
      return { ok: true, json: JSON.parse(text.text) as unknown, model, ...usage };
    } catch {
      return { ok: false, error: `json_parse: ${text.text.slice(0, 200)}`, model, ...usage };
    }
  } catch (e) {
    if (e instanceof Anthropic.APIError) return { ok: false, error: `api_${e.status ?? "error"}: ${e.message.slice(0, 300)}`, model };
    return { ok: false, error: `error: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`, model };
  }
};
