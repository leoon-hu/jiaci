import { withUser, ok, ApiError, type Params, safeDecode } from "@/lib/api";
import { GET as peek } from "@/app/api/peek/route";
import { findWordOrDict } from "@/lib/dict-db";
import { applyDetailQuota, buildWordDetail } from "@/lib/study";
import { isValidWord, normalizeWord } from "@/lib/words";
import { resolveToday } from "@/lib/dates";

/**
 * 单词详情（3.2.5）：词典字段 + 已填充的 AI 字段，没有的部分前端不显示；不触发任何生成。
 * `book` = 从哪本词库点进来的，状态与学习记录按那本的进度作用域算（需求 3.3.6）；不带按当前学习词库。
 * 助记等四块每个账号 24 小时有上限（applyDetailQuota）
 */
const detail = withUser(async (req, ctx: Params<{ spelling: string }>, user) => {
  const spelling = normalizeWord(safeDecode((await ctx.params).spelling));
  if (!isValidWord(spelling)) throw new ApiError(400, "不是合法的英文单词或短语");
  const word = await findWordOrDict(spelling);
  if (!word) throw new ApiError(404, "词典里没有收录这个词");
  const u = new URL(req.url);
  return ok(await applyDetailQuota(user, await buildWordDetail(user.id, word, resolveToday(u.searchParams.get("date")), u.searchParams.get("book") || null)));
});

/**
 * 点词小框的接口原来是 /api/words/peek，静态段抢走了 peek 这个词自己的详情请求，2026-10-19 挪到 /api/peek。
 * 发布前打开、还没刷新的页面还会按旧地址请求小框（带 ?w=，详情请求从来不带），转给点词接口；过一阵没有旧页面了可以删掉这一段
 */
export async function GET(req: Request, ctx: Params<{ spelling: string }>) {
  if (new URL(req.url).searchParams.has("w") && safeDecode((await ctx.params).spelling) === "peek") return peek(req, ctx);
  return detail(req, ctx);
}
