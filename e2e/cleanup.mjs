/**
 * 测试账号清理：删除 e2e / 截图脚本创建的账号（e2e-*@example.com、shots-*@example.com），级联删除其词库、进度、记录、会话。
 * 两个测试脚本结束时会各自删掉本次创建的账号；单独执行 `npm run e2e:clean` 可清掉历史残留。
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

export async function deleteTestAccounts(email) {
  const prisma = new PrismaClient();
  try {
    const where = email ? { email } : { OR: [{ email: { startsWith: "e2e", endsWith: "@example.com" } }, { email: { startsWith: "shots-", endsWith: "@example.com" } }] };
    const r = await prisma.user.deleteMany({ where });
    // 验证码记录不挂在 user 上，级联删不掉，得按邮箱单独清（审计 F156）
    await prisma.otpCode.deleteMany({ where });
    return r.count;
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && process.argv[1].endsWith("cleanup.mjs")) {
  const n = await deleteTestAccounts();
  console.log(`清理测试账号 ${n} 个`);
}
