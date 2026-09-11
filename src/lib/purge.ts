/**
 * 清理任务（需求 4.3）：注销超过 30 天的账号物理删除、过期会话与过期验证码清理。
 * 抽成模块是为了让运营脚本与内部接口共用同一份逻辑（审计 F163）。
 */
import type { PrismaClient } from "@prisma/client";

/** 注销后保留多少天再物理删除 */
export const PURGE_AFTER_DAYS = 30;

export type PurgeResult = { users: number; sessions: number; otps: number };

export async function purgeExpired(db: PrismaClient, now = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000);
  const users = await db.user.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: now } } });
  // 验证码超过一天就没用了（有效期最长十分钟），保留一天只为排查问题
  const otps = await db.otpCode.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 86_400_000) } } });
  return { users: users.count, sessions: sessions.count, otps: otps.count };
}
