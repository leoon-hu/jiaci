import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth";
import { findWordOrDict } from "@/lib/dict-db";
import { buildWordDetail, type WordDetail } from "@/lib/study";
import { isValidWord, normalizeWord } from "@/lib/words";
import { DATE_COOKIE, resolveToday } from "@/lib/dates";

/**
 * 独立详情页与详情浮层（拦截路由 `@detail/(.)word/[spelling]`）共用的服务端取数，
 * 与 /api/words/[spelling] 同一套逻辑（性能优化 P1-1）。
 * 查不到的词不跳系统 404 页，仍旧把提示交给客户端组件显示。
 */
export async function loadWord(raw: string): Promise<{ spelling: string; initial: WordDetail | null; initialError: string }> {
  const user = await requireUser();
  let spelling: string;
  try { spelling = normalizeWord(decodeURIComponent(raw)); } catch { spelling = normalizeWord(raw); }
  if (!isValidWord(spelling)) return { spelling, initial: null, initialError: "不是合法的英文单词或短语" };
  const word = await findWordOrDict(spelling);
  if (!word) return { spelling, initial: null, initialError: "词典里没有收录这个词" };
  // 打分按钮上的天数按客户端本地日期算（审计 F026）；Cookie 里没有就用服务器日期
  const today = resolveToday((await cookies()).get(DATE_COOKIE)?.value);
  return { spelling, initial: await buildWordDetail(user.id, word, today), initialError: "" };
}
