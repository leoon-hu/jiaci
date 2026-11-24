import { ApiCallError, type Usage } from "./fill";
import type { AiProvider } from "./providers";

type ResponsesConfig = { baseUrl: string; apiKey: string; model: string; reasoningEffort?: string };
type OutputPart = { type?: string; text?: string; refusal?: string };
type OutputItem = { type?: string; role?: string; status?: string; content?: Array<OutputPart | null> };
type ResponsesPayload = {
  status?: string | null;
  error?: { code?: string | null; param?: string | null; message?: string } | null;
  incomplete_details?: { reason?: string } | null;
  output?: Array<OutputItem | null>;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
    output_tokens_details?: { reasoning_tokens?: number };
    cost?: number;
  } | null;
};

export function getResponsesConfig(provider: AiProvider): ResponsesConfig | null {
  const baseUrl = provider === "openai" ? process.env.OPENAI_RESPONSES_BASE_URL?.trim() : undefined;
  if (!baseUrl) return null;
  const effort = process.env.OPENAI_RESPONSES_REASONING_EFFORT;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: process.env.OPENAI_API_KEY?.trim() ?? "",
    model: process.env.OPENAI_RESPONSES_MODEL?.trim() ?? "",
    ...(effort?.trim() ? { reasoningEffort: effort } : {}),
  };
}

function parseResponse(raw: string): ResponsesPayload | null {
  try {
    const data: unknown = JSON.parse(raw);
    return data && typeof data === "object" && !Array.isArray(data) ? data as ResponsesPayload : null;
  } catch {
    return null;
  }
}

const tokenCount = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

export async function responsesJson(config: ResponsesConfig, system: string, user: string, maxTokens: number): Promise<{ text: string; usage: Usage }> {
  const safeDetail = (value: unknown) =>
    typeof value === "string" ? (config.apiKey ? value.replaceAll(config.apiKey, "[redacted]") : value).slice(0, 300) : "";
  const body = {
    model: config.model,
    input: [{ role: "system", content: system }, { role: "user", content: user }],
    text: { format: { type: "json_object" } },
    max_output_tokens: maxTokens,
    reasoning: config.reasoningEffort ? { effort: config.reasoningEffort } : undefined,
    store: false,
    stream: false,
  };
  const signal = AbortSignal.timeout(180_000);
  let data: ResponsesPayload | null;
  for (;;) {
    const response = await fetch(`${config.baseUrl}/responses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const raw = await response.text();
    data = parseResponse(raw);
    if (response.ok) break;

    const error = data?.error;
    if (body.reasoning && response.status === 400
      && (error?.code === "unsupported_parameter" || error?.code === "unknown_parameter")
      && (error.param === "reasoning" || error.param === "reasoning.effort")) {
      console.warn(`[ai-responses] ${config.model} 拒绝推理参数，改用上游默认设置重试`);
      body.reasoning = undefined;
      continue;
    }
    throw new Error(`openai 接口 ${response.status}: ${safeDetail(error?.message) || safeDetail(raw)}`);
  }
  if (!data) throw new Error("Responses 接口返回了无效的 JSON 响应");

  const input = tokenCount(data.usage?.input_tokens) ?? 0;
  const cached = Math.min(input, tokenCount(data.usage?.input_tokens_details?.cached_tokens) ?? 0);
  const usage: Usage = { input: input - cached, cachedInput: cached, output: tokenCount(data.usage?.output_tokens) ?? 0 };
  const reasoning = tokenCount(data.usage?.output_tokens_details?.reasoning_tokens);
  if (reasoning !== undefined) usage.reasoning = reasoning;
  const cost = data.usage?.cost;
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) usage.cost = cost;

  const reason = data.incomplete_details?.reason;
  if (reason === "max_output_tokens" || reason === "length") {
    const detail = reasoning ? `（含 ${reasoning} 个推理 Token）` : "";
    throw new ApiCallError(`输出被 max_output_tokens 截断${detail}`, usage, true);
  }
  if (reason === "content_filter") {
    throw new ApiCallError("Responses 输出被上游内容过滤中断", usage);
  }
  if (data.error || reason || (data.status != null && data.status !== "completed")) {
    const code = data.error?.code;
    const detail = safeDetail(data.error?.message) || safeDetail(code) || safeDetail(reason) || safeDetail(data.status);
    const retryable = code === "server_error" || code === "rate_limit_exceeded";
    throw new ApiCallError(`Responses 接口未完成${detail ? `：${detail}` : ""}`, usage, false, retryable);
  }

  const output = Array.isArray(data.output) ? data.output : [];
  const messages = output.filter((item) => item?.type === "message" && (item.role == null || item.role === "assistant"));
  if (messages.some((item) => item?.status != null && item.status !== "completed")) {
    throw new ApiCallError("Responses 词条正文未完成", usage);
  }
  const parts = messages.flatMap((item) => Array.isArray(item?.content) ? item.content : []);
  const refusal = parts.find((part) => part?.type === "refusal");
  if (refusal) {
    const detail = safeDetail(refusal.refusal);
    throw new ApiCallError(`Responses 模型拒绝生成词条${detail ? `：${detail}` : ""}`, usage);
  }
  const text = parts.map((part) => part?.type === "output_text" && typeof part.text === "string" ? part.text : "").join("");
  if (!text.trim()) {
    const hasReasoning = (reasoning ?? 0) > 0 || output.some((item) => item?.type === "reasoning");
    throw new ApiCallError(hasReasoning ? "Responses 仅返回推理，缺少词条正文" : "Responses 接口缺少词条正文", usage);
  }
  return { text, usage };
}
