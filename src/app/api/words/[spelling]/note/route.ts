import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params, safeDecode } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getOrCreateKnownWord } from "@/lib/dict-db";
import { isValidWord, normalizeWord } from "@/lib/words";

async function wordFor(ctx: Params<{ spelling: string }>) {
  const spelling = normalizeWord(safeDecode((await ctx.params).spelling));
  if (!isValidWord(spelling)) throw new ApiError(400, "不是合法的英文单词或短语");
  const word = await getOrCreateKnownWord(spelling);
  if (!word) throw new ApiError(404, "词典里没有收录这个词");
  return word;
}

export const PUT = withUser(async (req, ctx: Params<{ spelling: string }>, user) => {
  const { note } = z.object({ note: z.string().trim().max(200, "备注最多 200 字") }).parse(await readJson(req));
  const word = await wordFor(ctx);
  if (!note) {
    await prisma.userWordNote.deleteMany({ where: { userId: user.id, wordId: word.id } });
    return ok({ note: null });
  }
  await prisma.userWordNote.upsert({ where: { userId_wordId: { userId: user.id, wordId: word.id } }, update: { note }, create: { userId: user.id, wordId: word.id, note } });
  return ok({ note });
});

export const DELETE = withUser(async (_req, ctx: Params<{ spelling: string }>, user) => {
  const word = await wordFor(ctx);
  await prisma.userWordNote.deleteMany({ where: { userId: user.id, wordId: word.id } });
  return ok({ note: null });
});
