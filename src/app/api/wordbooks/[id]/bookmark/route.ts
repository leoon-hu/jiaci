import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getBookmark, setBookmark, clearBookmark } from "@/lib/study";
import { MAX_WORD_LEN } from "@/lib/words";

/**
 * 词库书签（需求 3.3.5）：一个用户在一本词库里只有一个书签，新的覆盖旧的。
 * 内置词库大家共用，书签按用户分开存，互不影响。
 */
const Body = z.object({
  wordId: z.string().min(1).max(64),
  filter: z.enum(["all", "new", "learning", "mastered", "none"]).default("all"),
  q: z.string().max(MAX_WORD_LEN).default(""),
  // 随机排序把种子编码在值里（random:<种子>），书签存下它才能还原当时的顺序
  sort: z.string().regex(/^((order|alpha|freq|due)(-desc)?|random:[a-z0-9]{1,12})$/).default("order"),
  mode: z.enum(["both", "en", "zh"]).default("both"),
});

/** 能看到这本词库才谈得上书签：内置的谁都能看，自建 / 导入的只有自己能看 */
async function assertVisible(id: string, userId: string) {
  const book = await prisma.wordbook.findFirst({ where: { id, OR: [{ type: "builtin" }, { ownerId: userId }] }, select: { id: true } });
  if (!book) throw new ApiError(404, "词库不存在");
}

export const GET = withUser(async (_req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  await assertVisible(id, user.id);
  return ok({ bookmark: await getBookmark(user.id, id) });
});

export const PUT = withUser(async (req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  await assertVisible(id, user.id);
  const b = Body.parse(await readJson(req));
  return ok({ bookmark: await setBookmark(user.id, id, b.wordId, { filter: b.filter, q: b.q, sort: b.sort, mode: b.mode }) });
});

export const DELETE = withUser(async (_req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  await assertVisible(id, user.id);
  await clearBookmark(user.id, id);
  return ok({ bookmark: null });
});
