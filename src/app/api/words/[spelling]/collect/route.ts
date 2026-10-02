import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params, safeDecode } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getOrCreateWord } from "@/lib/dict-db";
import { isValidWord, normalizeWord } from "@/lib/words";
import { appendToWordbook, ownBookQuota } from "@/lib/study";

async function spellingOf(ctx: Params<{ spelling: string }>) {
  const spelling = normalizeWord(safeDecode((await ctx.params).spelling));
  if (!isValidWord(spelling)) throw new ApiError(400, "不是合法的英文单词或短语");
  return spelling;
}

/**
 * 「加入我的词库」的选择框（3.3.4）：自己的自建词库，按创建时间倒序（与词库列表「我的词库」一致），
 * 每本标出是不是已经有这个词。只查不建：词表里还没有这个词就是哪本都没有。
 * `quota`：「我的词库」满了（3.3.1）选择框就不显示「新建并加入」那一行
 */
export const GET = withUser(async (_req, ctx: Params<{ spelling: string }>, user) => {
  const spelling = await spellingOf(ctx);
  const [books, word, quota] = await Promise.all([
    prisma.wordbook.findMany({ where: { ownerId: user.id, type: "custom" }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, wordCount: true } }),
    prisma.word.findUnique({ where: { spelling }, select: { id: true } }),
    ownBookQuota(user.id),
  ]);
  const has = new Set(word && books.length
    ? (await prisma.wordbookWord.findMany({ where: { wordId: word.id, wordbookId: { in: books.map((b) => b.id) } }, select: { wordbookId: true } })).map((m) => m.wordbookId)
    : []);
  return ok({ spelling, wordbooks: books.map((b) => ({ ...b, has: has.has(b.id) })), quota });
});

/** 加入我的词库（3.3.4） */
export const POST = withUser(async (req, ctx: Params<{ spelling: string }>, user) => {
  const spelling = await spellingOf(ctx);
  const { wordbookId } = z.object({ wordbookId: z.string() }).parse(await readJson(req));
  const book = await prisma.wordbook.findFirst({ where: { id: wordbookId, ownerId: user.id, type: "custom" } });
  if (!book) throw new ApiError(404, "只能加入自己创建的词库");
  const word = await getOrCreateWord(spelling);
  const r = await appendToWordbook(wordbookId, [word.id]);
  return ok({ added: r.added.length > 0, name: book.name });
});
