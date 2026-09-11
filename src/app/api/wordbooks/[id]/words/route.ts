import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params } from "@/lib/api";
import { prisma } from "@/lib/db";
import { listWordbookWords } from "@/lib/study";
import { splitManualInput, MAX_WORD_LEN } from "@/lib/words";
import { lookupDictFields } from "@/lib/dict-db";
import { wordCreateData } from "@/lib/dict";

/** 手动添加一次最多接受的词条数：再多请走「导入单词本」（审计 F013） */
const MAX_MANUAL_WORDS = 200;

/** 分页参数：负数会让 slice 取到尾部、nextCursor 递减成负数翻不完（审计 F021） */
const Query = z.object({
  status: z.string().max(20).optional(),
  q: z.string().max(MAX_WORD_LEN).optional(),
  sort: z.string().max(20).optional(),
  cursor: z.coerce.number().int().min(0).max(1_000_000).default(0),
  limit: z.coerce.number().int().min(1).max(1000).default(100),
});

export const GET = withUser(async (req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  const book = await prisma.wordbook.findFirst({ where: { id, OR: [{ type: "builtin" }, { ownerId: user.id }] } });
  if (!book) throw new ApiError(404, "词库不存在");
  const u = new URL(req.url);
  const p = Query.parse({
    status: u.searchParams.get("status") ?? undefined,
    q: u.searchParams.get("q")?.trim() || undefined,
    sort: u.searchParams.get("sort") ?? undefined,
    cursor: u.searchParams.get("cursor") ?? undefined,
    limit: u.searchParams.get("limit") ?? undefined,
  });
  return ok(await listWordbookWords(user.id, id, { status: p.status, search: p.q, sort: p.sort, cursor: p.cursor, limit: p.limit }));
});

/**
 * 手动添加（3.3.4）：单个或批量；新词只带词典字段，不触发 AI。
 * 批量建词 + 批量加成员，词数在一个事务里按实际插入条数累加，中途失败不会让 word_count 漂移（审计 F013 / F015）。
 */
export const POST = withUser(async (req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  const book = await prisma.wordbook.findFirst({ where: { id, ownerId: user.id, type: "custom" } });
  if (!book) throw new ApiError(404, "只能向自己创建的词库添加单词");
  const { input } = z.object({ input: z.string().min(1).max(20_000) }).parse(await readJson(req));
  const { words, bad } = splitManualInput(input);
  if (!words.length) throw new ApiError(400, "请输入英文单词或短语");
  if (words.length > MAX_MANUAL_WORDS) throw new ApiError(400, `一次最多添加 ${MAX_MANUAL_WORDS} 个词条，更多请用「导入单词本」`);

  const dict = await lookupDictFields(words);
  await prisma.word.createMany({ data: words.map((s) => wordCreateData(s, dict.get(s))), skipDuplicates: true });
  const rows = await prisma.word.findMany({ where: { spelling: { in: words } }, select: { id: true, spelling: true } });
  const idOf = new Map(rows.map((r) => [r.spelling, r.id]));
  const members = new Set((await prisma.wordbookWord.findMany({ where: { wordbookId: id, wordId: { in: rows.map((r) => r.id) } }, select: { wordId: true } })).map((m) => m.wordId));
  const added = words.filter((s) => idOf.has(s) && !members.has(idOf.get(s)!));
  const existed = words.filter((s) => idOf.has(s) && members.has(idOf.get(s)!));
  if (added.length) {
    const last = await prisma.wordbookWord.aggregate({ where: { wordbookId: id }, _max: { sortOrder: true } });
    const base = (last._max.sortOrder ?? -1) + 1;
    await prisma.$transaction(async (tx) => {
      const r = await tx.wordbookWord.createMany({ data: added.map((s, k) => ({ wordbookId: id, wordId: idOf.get(s)!, sortOrder: base + k })), skipDuplicates: true });
      if (r.count) await tx.wordbook.update({ where: { id }, data: { wordCount: { increment: r.count } } });
    });
  }
  return ok({ added, existed, bad });
});
