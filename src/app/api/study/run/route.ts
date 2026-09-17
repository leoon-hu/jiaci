import { withUser, ok } from "@/lib/api";
import { buildRunList, RUN_WORD_OPTIONS } from "@/lib/study";
import { resolveToday } from "@/lib/dates";

/** 跑步模式（需求 3.2.6）：今天要循环朗读的词——今日队列 + 今天已完成的词，每个词带释义与前几条例句（含译文）；limit 只认 30 / 50 / 100 / 150，不传按用户设置 */
export const GET = withUser(async (req, _ctx, user) => {
  const sp = new URL(req.url).searchParams;
  const today = resolveToday(sp.get("date"));
  const limit = (RUN_WORD_OPTIONS as readonly number[]).find((n) => n === Number(sp.get("limit")));
  return ok(await buildRunList(user.id, today, limit));
});
