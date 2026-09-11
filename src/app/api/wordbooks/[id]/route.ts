import { withUser, ok, ApiError, type Params } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getCurrentWordbookId, wordbookProgress } from "@/lib/study";

async function ownedOrBuiltin(userId: string, id: string) {
  const book = await prisma.wordbook.findFirst({ where: { id, OR: [{ type: "builtin" }, { ownerId: userId }] } });
  if (!book) throw new ApiError(404, "词库不存在");
  return book;
}

export const GET = withUser(async (_req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  const book = await ownedOrBuiltin(user.id, id);
  const [p, currentId] = await Promise.all([wordbookProgress(user.id, id), getCurrentWordbookId(user.id)]);
  return ok({ id: book.id, name: book.name, type: book.type, wordCount: book.wordCount, learned: p.learned, mastered: p.mastered, isCurrent: currentId === id });
});

/** 删除导入 / 自建词库：该词库独有单词的学习记录一并删除（需求 3.3.1） */
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
    prisma.userWordProgress.deleteMany({ where: { userId: user.id, wordId: { in: onlyHere } } }),
    prisma.userWordNote.deleteMany({ where: { userId: user.id, wordId: { in: onlyHere } } }),
    prisma.studyLog.deleteMany({ where: { userId: user.id, wordId: { in: onlyHere } } }),
    prisma.userCurrentWordbook.deleteMany({ where: { userId: user.id, wordbookId: id } }),
    prisma.wordbook.delete({ where: { id } }),
  ]);
  return ok({ deleted: true, clearedWords: onlyHere.length });
});
