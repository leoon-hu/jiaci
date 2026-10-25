/**
 * 登录后的详情里助记 / 词源与构词 / 易混词 / 常见错误四块的每账号上限（需求 3.2.5）的计数器：
 * 记每个账号最近 24 小时看过完整内容的词（词 id → 第一次看到的时刻），同一个词 24 小时内只算一次。
 * 进程内存，单实例部署够用、服务重启清零（与 lib/rate-limit.ts 同样的取舍）；读配置、改详情在 lib/study.ts 的 applyDetailQuota。
 */
export const QUOTA_WINDOW_MS = 86_400_000;

export function createDetailQuota(maxUsers = 5000) {
  const users = new Map<string, { last: number; seen: Map<string, number> }>();
  return {
    /** 记一次并判断能不能看完整内容：窗口里看过的词直接放行，新词没到 limit 个就记下放行 */
    take(userId: string, wordId: string, limit: number, now = Date.now()): boolean {
      let u = users.get(userId);
      if (!u) { u = { last: now, seen: new Map() }; users.set(userId, u); }
      u.last = now;
      // 插入顺序就是时间顺序：从头删掉滑出窗口的，碰到第一个还在窗口里的就停
      for (const [w, t] of u.seen) { if (now - t < QUOTA_WINDOW_MS) break; u.seen.delete(w); }
      if (u.seen.has(wordId)) return true;
      if (u.seen.size >= limit) return false;
      u.seen.set(wordId, now);
      // 账号多了淘汰 24 小时没来过的（它们的记录反正都已过期），免得只增不减
      if (users.size > maxUsers) for (const [id, x] of users) if (now - x.last >= QUOTA_WINDOW_MS) users.delete(id);
      return true;
    },
    /** 记着多少个账号（单测看淘汰用） */
    trackedUsers: () => users.size,
  };
}
