import { z } from "zod";
import { withUser, ok, readJson, ApiError, type Params } from "@/lib/api";
import { prisma } from "@/lib/db";
import { appendToWordbook, listWordbookWords, removeFromWordbook } from "@/lib/study";
import { splitManualInput, MAX_WORD_LEN } from "@/lib/words";
import { lookupDictFields } from "@/lib/dict-db";
import { wordCreateData } from "@/lib/dict";

/** 手动添加一次最多接受的词条数：再多请走「导入单词本」（审计 F013） */
const MAX_MANUAL_WORDS = 200;
/** 按词 id 批量加 / 删一次最多几个：与 rate-batch 一样 500，列表页多了会切片提交 */
const MAX_BATCH_WORDS = 500;
const WordIds = z.array(z.string().min(1).max(40)).min(1).max(MAX_BATCH_WORDS);

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
 * 向自建词库加词（3.3.4），两种请求体：
 * - `{ input }` 手动添加：单个或批量输入拼写；新词只带词典字段，不触发 AI；返回 added / existed / bad 三组拼写；
 * - `{ wordIds }` 单词列表多选「加入词库」：按列表顺序追加，已经在这本里的跳过（自动去重）；返回 added / existed 两组词 id。
 * 批量建词 + 批量加成员，词数在一个事务里按实际插入条数累加，中途失败不会让 word_count 漂移（审计 F013 / F015）。
 */
export const POST = withUser(async (req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  const book = await prisma.wordbook.findFirst({ where: { id, ownerId: user.id, type: "custom" } });
  if (!book) throw new ApiError(404, "只能向自己创建的词库添加单词");
  const body = z.union([z.object({ input: z.string().min(1).max(20_000) }), z.object({ wordIds: WordIds })]).parse(await readJson(req));
  if ("wordIds" in body) return ok(await appendToWordbook(id, body.wordIds));
  const { words, bad } = splitManualInput(body.input);
  if (!words.length) throw new ApiError(400, "请输入英文单词或短语");
  if (words.length > MAX_MANUAL_WORDS) throw new ApiError(400, `一次最多添加 ${MAX_MANUAL_WORDS} 个词条，更多请用「导入单词本」`);

  const dict = await lookupDictFields(words);
  await prisma.word.createMany({ data: words.map((s) => wordCreateData(s, dict.get(s))), skipDuplicates: true });
  const rows = await prisma.word.findMany({ where: { spelling: { in: words } }, select: { id: true, spelling: true } });
  const idOf = new Map(rows.map((r) => [r.spelling, r.id]));
  const r = await appendToWordbook(id, words.filter((s) => idOf.has(s)).map((s) => idOf.get(s)!));
  const added = new Set(r.added);
  const existed = new Set(r.existed);
  return ok({ added: words.filter((s) => added.has(idOf.get(s)!)), existed: words.filter((s) => existed.has(idOf.get(s)!)), bad });
});

/**
 * 从自建词库删除单词（需求 3.3.5）：单词列表的拖拽「删除」与多选「删除」，本地 5 秒撤销期过了才发到这里。
 * 只在这本里的词连个人记录一起删，规则与删除整本词库相同（见 removeFromWordbook）
 */
export const DELETE = withUser(async (req, ctx: Params<{ id: string }>, user) => {
  const { id } = await ctx.params;
  const book = await prisma.wordbook.findFirst({ where: { id, ownerId: user.id, type: "custom" } });
  if (!book) throw new ApiError(404, "只能从自己创建的词库删除单词");
  const { wordIds } = z.object({ wordIds: WordIds }).parse(await readJson(req));
  return ok(await removeFromWordbook(user.id, id, [...new Set(wordIds)]));
});
