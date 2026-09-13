import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getCurrentWordbookId, ownProgressOf, wordbookProgress } from "@/lib/study";

async function ownedOrBuiltin(userId: string, id: string) {
  const book = await prisma.wordbook.findFirst({ where: { id, OR: [{ type: "builtin" }, { ownerId: userId }] } });
  if (!book) throw new ApiError(404, "词库不存在");
  return book;
}

export const GET = withUser(async (_req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  const book = await ownedOrBuiltin(user.id, id);
  const [p, currentId, ownProgress] = await Promise.all([wordbookProgress(user.id, id), getCurrentWordbookId(user.id), ownProgressOf(user.id, id)]);
  return ok({ id: book.id, name: book.name, type: book.type, wordCount: book.wordCount, learned: p.learned, mastered: p.mastered, isCurrent: currentId === id, ownProgress });
});

/**
 * 词库的个人设置（需求 3.3.6）：目前只有「独立进度」开关。只改「读写哪一套进度」，
 * 两套记录都保留——开了独立进度这本从零开始，关掉又回到全局那套，来回切换互不影响
 */
export const PATCH = withUser(async (req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  await ownedOrBuiltin(user.id, id);
  const { ownProgress } = z.object({ ownProgress: z.boolean() }).parse(await readJson(req));
  await prisma.userWordbookSetting.upsert({
    where: { userId_wordbookId: { userId: user.id, wordbookId: id } },
    create: { userId: user.id, wordbookId: id, ownProgress },
    update: { ownProgress },
  });
  return ok({ ownProgress });
});

/** 删除导入 / 自建词库：该词库独有单词的学习记录，以及这本的独立进度（scope = 词库 id）一并删除（需求 3.3.1） */
export const DELETE = withUser(async (_req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  const book = await prisma.wordbook.findFirst({ where: { id, ownerId: user.id } });
  if (!book) throw new ApiError(404, "词库不存在或不可删除");
  const members = await prisma.wordbookWord.findMany({ where: { wordbookId: id }, select: { wordId: true } });
  const ids = members.map((m) => m.wordId);
  // 只在本词库出现（用户其它词库与内置词库都不含）的词，清理其个人记录
  const elsewhere = await prisma.wordbookWord.findMany({ where: { wordId: { in: ids }, wordbookId: { not: id }, wordbook: { OR: [{ type: "builtin" }, { ownerId: user.id }] } }, select: { wordId: true } });
  const keep = new Set(elsewhere.map((e) => e.wordId));
  const onlyHere = ids.filter((w) => !keep.has(w));
  await prisma.$transaction([
    prisma.userWordProgress.deleteMany({ where: { userId: user.id, OR: [{ wordId: { in: onlyHere } }, { scope: id }] } }),
    prisma.userWordNote.deleteMany({ where: { userId: user.id, wordId: { in: onlyHere } } }),
    // 独立进度的作用域列没有外键，不会随词库级联删除，这里显式清掉
    prisma.studyLog.deleteMany({ where: { userId: user.id, OR: [{ wordId: { in: onlyHere } }, { scope: id }] } }),
    prisma.userCurrentWordbook.deleteMany({ where: { userId: user.id, wordbookId: id } }),
    prisma.wordbook.delete({ where: { id } }),
  ]);
  return ok({ deleted: true, clearedWords: onlyHere.length });
});
