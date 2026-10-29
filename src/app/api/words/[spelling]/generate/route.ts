import { revalidatePath } from "next/cache";
import { withUser, ok, fail, ApiError, type Params, safeDecode } from "@/lib/api";
import { clientIp } from "@/lib/rate-limit";
import { isValidWord, normalizeWord } from "@/lib/words";
import { generateStatusOf, requestGenerate } from "@/lib/ai/generate";
import { dictUrl } from "@/lib/dict-url";

async function spellingOf(ctx: Params<{ spelling: string }>) {
  const spelling = normalizeWord(safeDecode((await ctx.params).spelling));
  if (!isValidWord(spelling)) throw new ApiError(400, "不是合法的英文单词或短语");
  return spelling;
}

/**
 * 「生成 AI 资料」（需求 3.4 I8）：给没有任何厂商资料的词现场生成一份 DeepSeek 资料，全站共用。
 * 立刻返回 202，生成在服务端后台跑（半分钟到一分钟），页面用下面的 GET 轮询；
 * 每人 24 小时 / 每分钟、每个 IP 24 小时都有上限，被拒太多次封账号与 IP（lib/ai/generate.ts）
 */
export const POST = withUser(async (req, ctx: Params<{ spelling: string }>, user) => {
  const spelling = await spellingOf(ctx);
  const r = await requestGenerate(user, clientIp(req), spelling);
  if (r.ok) return ok({ status: "running", started: r.started, remaining: r.remaining }, { status: 202 });
  const res = fail(r.status, r.message, r.code);
  if (r.retryAfter) res.headers.set("Retry-After", String(r.retryAfter));
  return res;
});

/** 轮询：running 在生成 / done 已有资料 / failed 这次没成（error 是原因）/ idle 没在生成也没有资料 */
export const GET = withUser(async (_req, ctx: Params<{ spelling: string }>) => {
  const spelling = await spellingOf(ctx);
  const r = await generateStatusOf(spelling);
  // 刚生成完：让公开词条页下次访问时重新渲染（ISR 一天一刷，不推一下要等一天才有这份资料）
  if (r.justDone) { try { revalidatePath(dictUrl(spelling)); } catch { /* 刷不了也不影响结果 */ } }
  return ok({ status: r.status, error: r.error ?? null });
});
