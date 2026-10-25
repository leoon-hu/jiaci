"use client";
import { api, ClientApiError } from "./api";

/**
 * 离线暂存的打分（学习卡与跑步模式共用）：请求失败且值得重试时存进 localStorage，下次进学习页 / 跑步页按存入顺序逐条补交。
 * 按用户分开存：同一设备换账号后，不把上一个账号的打分补交到新账号。
 */
const pendingKey = (userId: string) => `aiword.pendingRates.${userId}`;
export function readPendingRates(userId: string): unknown[] { try { return JSON.parse(localStorage.getItem(pendingKey(userId)) || "[]"); } catch { return []; } }
export function writePendingRates(userId: string, list: unknown[]) { try { localStorage.setItem(pendingKey(userId), JSON.stringify(list)); } catch { /* ignore */ } }

/** 只有网络不可用 / 服务端 5xx 才值得暂存重试；4xx 是永久错误（词已删、参数不对），暂存下来只会每次进页面反复重放（审计 F042） */
export function isRetriableRateError(e: unknown): boolean {
  const st = e instanceof ClientApiError ? e.status : 0;
  return !(st >= 400 && st < 500);
}
export function stashPendingRate(userId: string, body: unknown) { writePendingRates(userId, [...readPendingRates(userId), body]); }

/** 恢复后按存入顺序逐条补交（审计 F180 / F037）：4xx 丢掉；网络 / 5xx 停下，剩下的留到下次 */
export async function flushPendingRates(userId: string): Promise<void> {
  try { localStorage.removeItem("aiword.pendingRates"); } catch { /* ignore */ } // 旧版不分用户的 key，无法归属，直接清掉
  for (const item of readPendingRates(userId)) {
    try { await api("/api/study/rate", { method: "POST", json: item }); }
    catch (e) { if (isRetriableRateError(e)) break; }
    // 逐条从暂存里摘掉：整体覆盖会把补交期间新写入的打分一起丢掉
    writePendingRates(userId, readPendingRates(userId).filter((x) => (x as { clientTs?: string }).clientTs !== (item as { clientTs?: string }).clientTs));
  }
}
