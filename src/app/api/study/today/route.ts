import { withUser, ok } from "@/lib/api";
import { buildTodayQueue, totals } from "@/lib/study";
import { resolveToday } from "@/lib/dates";

export const GET = withUser(async (req, _ctx, user) => {
  const today = resolveToday(new URL(req.url).searchParams.get("date"));
  const [q, t] = await Promise.all([buildTodayQueue(user.id, today), totals(user.id)]);
  return ok({ today, ...q, totals: t });
});
