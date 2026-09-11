import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params, safeDecode } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getOrCreateWord } from "@/lib/dict-db";
import { isValidWord, normalizeWord } from "@/lib/words";

/** 加入我的词库（3.3.4） */
export const POST = withUser(async (req, ctx: Params<{ spelling: string }>, user) => {
  const spelling = normalizeWord(safeDecode((await ctx.params).spelling));
  if (!isValidWord(spelling)) throw new ApiError(400, "不是合法的英文单词或短语");
  const { wordbookId } = z.object({ wordbookId: z.string() }).parse(await readJson(req));
  const book = await prisma.wordbook.findFirst({ where: { id: wordbookId, ownerId: user.id, type: "custom" } });
  if (!book) throw new ApiError(404, "只能加入自己创建的词库");
  const word = await getOrCreateWord(spelling);
  const last = await prisma.wordbookWord.aggregate({ where: { wordbookId }, _max: { sortOrder: true } });
  // 先查后插并发下会撞唯一键并让 word_count 漂移：改成 skipDuplicates + 按实际插入条数累加（审计 F015）
  const inserted = await prisma.$transaction(async (tx) => {
    const r = await tx.wordbookWord.createMany({ data: [{ wordbookId, wordId: word.id, sortOrder: (last._max.sortOrder ?? -1) + 1 }], skipDuplicates: true });
    if (r.count) await tx.wordbook.update({ where: { id: wordbookId }, data: { wordCount: { increment: r.count } } });
    return r.count;
  });
  return ok({ added: inserted > 0, name: book.name });
});
