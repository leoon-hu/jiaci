import { withUser, ok } from "@/lib/api";
import { buildRunList } from "@/lib/study";
import { resolveToday } from "@/lib/dates";

/** 跑步模式（需求 3.2.6）：今天要循环朗读的词——今日队列 + 今天已完成的词，每个词带释义与第一条例句 */
export const GET = withUser(async (req, _ctx, user) => {
  const today = resolveToday(new URL(req.url).searchParams.get("date"));
  return ok(await buildRunList(user.id, today));
});
