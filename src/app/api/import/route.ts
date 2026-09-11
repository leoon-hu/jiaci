import { z } from "zod";
import { withUser, ok, readJson, ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getConfigInt } from "@/lib/config";
import { isValidWord, normalizeWord } from "@/lib/words";
import { lookupDictFields } from "@/lib/dict-db";
import { wordCreateData } from "@/lib/dict";

/** 导入单词本（3.3.3）：前端已解析去重，只提交单词数组；新词带词典字段入库，不触发 AI */
export const POST = withUser(async (req, _ctx, user) => {
  // 数组长度与单行长度都要有上限：否则 5 MB 的请求体会先被完整反序列化再规范化（审计 F132）
  const body = z.object({ name: z.string().trim().min(1).max(30), words: z.array(z.string().max(200)).min(1).max(20_000) }).parse(await readJson(req));
  const max = await getConfigInt("import.max_words");
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of body.words) { const w = normalizeWord(raw); if (isValidWord(w) && !seen.has(w)) { seen.add(w); words.push(w); } }
  if (!words.length) throw new ApiError(400, "没有可导入的单词");
  if (words.length > max) throw new ApiError(400, `超过单次 ${max} 词上限，请拆分文件后再导入`);

  // 建词是全局表、可以先做；词库与成员放进一个事务，中途失败不会留下「有数无词」的半状态词库（审计 F016）
  for (let i = 0; i < words.length; i += 500) {
    const part = words.slice(i, i + 500);
    const dict = await lookupDictFields(part);
    await prisma.word.createMany({ data: part.map((spelling) => wordCreateData(spelling, dict.get(spelling))), skipDuplicates: true });
  }
  const rows = await prisma.word.findMany({ where: { spelling: { in: words } }, select: { id: true, spelling: true } });
  const idOf = new Map(rows.map((r) => [r.spelling, r.id]));
  const members = words.filter((s) => idOf.has(s)).map((s, k) => ({ wordId: idOf.get(s)!, sortOrder: k }));
  const book = await prisma.$transaction(async (tx) => {
    const b = await tx.wordbook.create({ data: { name: body.name, type: "import", ownerId: user.id, wordCount: members.length } });
    for (let i = 0; i < members.length; i += 1000) {
      await tx.wordbookWord.createMany({ data: members.slice(i, i + 1000).map((m) => ({ wordbookId: b.id, ...m })), skipDuplicates: true });
    }
    return b;
  }, { timeout: 120_000, maxWait: 10_000 });
  return ok({ wordbookId: book.id, imported: members.length, skipped: body.words.length - members.length }, { status: 201 });
});
