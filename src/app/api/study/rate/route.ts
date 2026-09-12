import { z } from "zod";
import { withUser, ok, readJson } from "@/lib/api";
import { rateWord, schedulerOptions } from "@/lib/study";
import { resolveToday } from "@/lib/dates";
import { rateLabels } from "@/lib/scheduler";

export const POST = withUser(async (req, _ctx, user) => {
  const body = z.object({
    wordId: z.string(), result: z.enum(["know", "fuzzy", "master", "reset", "remove"]),
    clientTs: z.string().max(64).optional(), date: z.string().optional(),
    // 单词列表的「加进度」也走这里（要 know 的那几条守卫），但来源是 list：
    // 首页的「今日已完成」和当天新词配额只算学习卡上的打分（审计 F024）
    source: z.enum(["study", "list"]).optional(),
    // 只算不写：列表的「加进度」先拿结果本地显示、撤销期过后再真正提交（见 rateWord）
    preview: z.boolean().optional(),
  }).parse(await readJson(req));
  const today = resolveToday(body.date);
  const r = await rateWord(user.id, body.wordId, body.result, today, body.clientTs, body.source ?? "study", body.preview ?? false);
  return ok({ ...r, labels: rateLabels(r.progress, await schedulerOptions(), today) });
});
