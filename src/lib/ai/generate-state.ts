import { getConfigInt } from "../config";
import { PROVIDER_API } from "./fill";
import { AI_PROVIDERS, type AiProvider } from "./providers";
import { getResponsesConfig } from "./responses";

/**
 * 「生成 AI 资料」（需求 3.4 I8）的进程内状态与开关，单独一个小模块：详情取数（lib/study.ts）只需要这两样，
 * 不必把调模型、登记音频那一串（lib/ai/generate.ts → lib/tts）也拖进来。
 */
type GenerateJob = { requestId: string; provider: AiProvider };
// 进程内的在跑清单（拼写 → 任务）：同一个词同时只生成一次（别人点了就等这一次），服务器并发上限也按它数；
// 挂在 globalThis 上，开发模式热更新时不丢（同 lib/db.ts 的 Prisma 单例）
const holder = globalThis as unknown as { aiwordAiJobs?: Map<string, GenerateJob> };
export const generateJobs: Map<string, GenerateJob> = (holder.aiwordAiJobs ??= new Map());

export function isGenerateConfigured(provider: AiProvider): boolean {
  const responses = getResponsesConfig(provider);
  if (responses) return !!(responses.apiKey && responses.model);
  return !!process.env[PROVIDER_API[provider].envKey]?.trim();
}

export const initialGenerateProvider = (): AiProvider => AI_PROVIDERS.find(isGenerateConfigured) ?? AI_PROVIDERS[0];

/** 详情页要不要给「生成 AI 资料」按钮：有密钥且每日上限 > 0；返回每日上限给页面写文案 */
export async function generateAvailable(provider: AiProvider): Promise<number> {
  if (!isGenerateConfigured(provider)) return 0;
  return getConfigInt("ai.generate_daily_per_user", 0);
}
