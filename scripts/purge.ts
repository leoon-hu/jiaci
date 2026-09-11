/**
 * 运营脚本：清理任务（注销 30 天后物理删除、过期会话与验证码）。
 * 用法：npx tsx scripts/purge.ts
 * 线上不用这个脚本——产物里没有它，改由 cron 调 /api/internal/purge。
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { purgeExpired } from "../src/lib/purge";

const prisma = new PrismaClient();

purgeExpired(prisma)
  .then((r) => console.log(`已删除注销账号 ${r.users}，过期会话 ${r.sessions}，过期验证码 ${r.otps}`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
