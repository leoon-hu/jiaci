import { withUser, ok } from "@/lib/api";
import { buildTodayQueue } from "@/lib/study";
import { resolveToday } from "@/lib/dates";
import { getConfigInt } from "@/lib/config";

/** 再学一组：额外 N 个新词（N 读配置） */
export const GET = withUser(async (req, _ctx, user) => {
  const today = resolveToday(new URL(req.url).searchParams.get("date"));
  const extra = await getConfigInt("study.extra_new_words");
  const q = await buildTodayQueue(user.id, today, { extra });
  return ok({ today, items: q.items.filter((i) => i.kind === "new"), stats: q.stats, settings: q.settings, hasBook: q.hasBook });
});
