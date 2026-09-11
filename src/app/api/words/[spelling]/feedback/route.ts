import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params, safeDecode } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getOrCreateKnownWord } from "@/lib/dict-db";
import { isValidWord, normalizeWord } from "@/lib/words";

/** 提交对某个词条的问题反馈（需求 3.2.5「其他操作」）：只写入 word_feedback 表，运营方用 SQL 查看处理 */
export const POST = withUser(async (req, ctx: Params<{ spelling: string }>, user) => {
  const spelling = normalizeWord(safeDecode((await ctx.params).spelling));
  if (!isValidWord(spelling)) throw new ApiError(400, "不是合法的英文单词或短语");
  const { content } = z.object({ content: z.string().trim().min(1, "请填写反馈内容").max(500, "反馈最多 500 字") }).parse(await readJson(req));
  // 先查限速再建词：原来顺序反了，刷反馈接口即使被限速也已经先往全局 word 表写了行（审计 F181）
  const recent = await prisma.wordFeedback.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent >= 20) throw new ApiError(429, "反馈太频繁，请稍后再试");
  const word = await getOrCreateKnownWord(spelling);
  if (!word) throw new ApiError(404, "词典里没有收录这个词");
  const fb = await prisma.wordFeedback.create({ data: { userId: user.id, wordId: word.id, content } });
  return ok({ id: fb.id, createdAt: fb.createdAt });
});
