import { z } from "zod";
import { withUser, ok, readJson } from "@/lib/api";
import { rateWordsBatch } from "@/lib/study";
import { prisma } from "@/lib/db";
import { resolveToday } from "@/lib/dates";

/**
 * 单词列表的批量状态操作（需求 3.3.5）：重新记 / 已掌握 / 移出，整批一个事务，每词写一条 study_log。
 * 列表页的滑动与多选操作先在本地生效、5 秒后才调用这里，所以撤销不需要服务端参与。
 */
export const POST = withUser(async (req, _ctx, user) => {
  const body = z.object({
    wordIds: z.array(z.string()).min(1).max(500),
    result: z.enum(["master", "reset", "remove"]),
    date: z.string().optional(),
  }).parse(await readJson(req));
  const today = resolveToday(body.date);
  // 先过滤掉不存在的 wordId，剩下的整批一个事务：撞外键会让整批回滚，只报错不留半生效状态（审计 F014）
  const ids = Array.from(new Set(body.wordIds));
  const known = (await prisma.word.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((w) => w.id);
  // 来源标成 list：这些操作不该算进首页的「今日已完成」（审计 F024）
  const { done } = await rateWordsBatch(user.id, known, body.result, today);
  return ok({ done, skipped: ids.length - done });
});
