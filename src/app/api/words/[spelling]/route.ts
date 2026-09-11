import { withUser, ok, ApiError, type Params, safeDecode } from "@/lib/api";
import { findWordOrDict } from "@/lib/dict-db";
import { buildWordDetail } from "@/lib/study";
import { isValidWord, normalizeWord } from "@/lib/words";
import { resolveToday } from "@/lib/dates";

/** 单词详情（3.2.5）：词典字段 + 已填充的 AI 字段，没有的部分前端不显示；不触发任何生成 */
export const GET = withUser(async (req, ctx: Params<{ spelling: string }>, user) => {
  const spelling = normalizeWord(safeDecode((await ctx.params).spelling));
  if (!isValidWord(spelling)) throw new ApiError(400, "不是合法的英文单词或短语");
  const word = await findWordOrDict(spelling);
  if (!word) throw new ApiError(404, "词典里没有收录这个词");
  return ok(await buildWordDetail(user.id, word, resolveToday(new URL(req.url).searchParams.get("date"))));
});
