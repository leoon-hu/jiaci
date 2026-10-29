/**
 * 用户点「生成 AI 资料」（需求 3.4 I8）的纯规则：放不放行、要不要封、回给用户的状态码与文案、轮询时的状态判断。
 * 不碰数据库，查库与调模型在 lib/ai/generate.ts；单测 tests/ai-generate.test.ts
 */
/** 每日上限按最近 24 小时滑动算（与详情四块的上限同一口径），每分钟上限按最近 60 秒 */
export const GENERATE_WINDOW_MS = 86_400_000;
export const GENERATE_MINUTE_MS = 60_000;
/** 轮询时只认这么久以内的生成结果：更早的失败记录不再当成「这次」的结果 */
export const GENERATE_RECENT_MS = 600_000;

/** 没放行的原因（写进 word_ai_request.reason） */
export type RefuseReason = "limit_daily" | "limit_minute" | "limit_ip" | "busy" | "exists" | "unknown";
/**
 * 这些原因算「用户的问题」（超限还在发、对已有资料 / 查无此词的拼写还在发——页面上根本没有这样的按钮，多半是脚本），
 * 24 小时内累计到 banAfter 次就封账号与 IP；busy 是服务器自己在忙，不算
 */
export const BAN_COUNTED: readonly RefuseReason[] = ["limit_daily", "limit_minute", "limit_ip", "exists", "unknown"];

export type GenerateLimits = {
  /** 每个账号 24 小时内最多发起几次（0 = 功能关掉） */
  dailyPerUser: number;
  /** 每个账号每分钟最多发起几次 */
  perMinute: number;
  /** 每个 IP 24 小时内最多发起几次（多个账号合计） */
  dailyPerIp: number;
  /** 服务器同时最多跑几个生成 */
  concurrency: number;
  /** 24 小时内被拒几次就封（0 = 不封） */
  banAfter: number;
  /** 封几小时 */
  banHours: number;
};
/** 已经用掉的：放行过（pending / ok / failed）的次数，不含被拒的 */
export type GenerateCounts = { userDay: number; userMinute: number; ipDay: number; running: number };

/** 功能开没开：有密钥且每日上限 > 0 */
export const generateEnabled = (limits: Pick<GenerateLimits, "dailyPerUser">, hasKey: boolean): boolean => hasKey && limits.dailyPerUser > 0;

/** 按已用次数判断放不放行；顺序：每日 → 每分钟 → IP → 服务器并发。放行返回 null */
export function refuseReason(c: GenerateCounts, l: GenerateLimits): RefuseReason | null {
  if (c.userDay >= l.dailyPerUser) return "limit_daily";
  if (c.userMinute >= l.perMinute) return "limit_minute";
  if (c.ipDay >= l.dailyPerIp) return "limit_ip";
  if (c.running >= l.concurrency) return "busy";
  return null;
}

/** 24 小时内被拒的次数（只数 BAN_COUNTED 里的原因）达到 banAfter 就封 */
export const shouldBan = (refusedInWindow: number, l: Pick<GenerateLimits, "banAfter">): boolean => l.banAfter > 0 && refusedInWindow >= l.banAfter;

/** 这次放行之后 24 小时内还剩几次 */
export const remainingAfter = (userDay: number, l: Pick<GenerateLimits, "dailyPerUser">): number => Math.max(0, l.dailyPerUser - userDay - 1);

/** 被拒时回给页面的状态码与文案；retryAfter 是 Retry-After 响应头（秒） */
export function refusalResponse(reason: RefuseReason, l: GenerateLimits): { status: number; message: string; retryAfter?: number } {
  switch (reason) {
    case "limit_daily": return { status: 429, message: `24 小时内最多生成 ${l.dailyPerUser} 次，已经用完，过一天再来` };
    case "limit_minute": return { status: 429, message: "生成太频繁，稍等一分钟再试", retryAfter: 60 };
    case "limit_ip": return { status: 429, message: "这个网络 24 小时内生成的次数太多，过一天再来" };
    case "busy": return { status: 503, message: "正在生成的词太多，稍等一会儿再试", retryAfter: 30 };
    case "exists": return { status: 409, message: "这个词已经有 AI 资料了" };
    case "unknown": return { status: 404, message: "词典里没有收录这个词" };
  }
}

/** 封禁中的文案：还有几小时恢复（不足一小时按一小时说） */
export function bannedMessage(until: Date, now = Date.now()): string {
  const hours = Math.max(1, Math.ceil((until.getTime() - now) / 3_600_000));
  return `生成功能已暂停使用，${hours} 小时后恢复`;
}

export type GenerateStatus = "running" | "done" | "failed" | "idle";
export type LatestRequest = { status: "pending" | "ok" | "failed" | "refused"; reason: string | null; createdAt: Date };
/**
 * 轮询接口的判断：内存里在跑 → running；已有资料 → done（justDone = 最近 10 分钟内刚写入，接口据此刷新公开页）；
 * 最近 10 分钟内放行的那次出错 → failed；放行的那次还是 pending 却没在跑（服务重启把任务丢了）→ 也算 failed；其余 idle
 */
export function generateStatus(running: boolean, hasRow: boolean, latest: LatestRequest | null, now = Date.now()): { status: GenerateStatus; error?: string; justDone?: boolean } {
  if (running) return { status: "running" };
  const recent = !!latest && now - latest.createdAt.getTime() < GENERATE_RECENT_MS;
  if (hasRow) return { status: "done", justDone: recent && latest!.status === "ok" };
  if (recent && latest!.status === "failed") return { status: "failed", error: latest!.reason ?? undefined };
  if (recent && latest!.status === "pending") return { status: "failed", error: "生成被打断了，请再试一次" };
  return { status: "idle" };
}
