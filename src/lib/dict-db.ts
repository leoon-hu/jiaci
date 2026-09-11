import { PrismaClient } from "@prisma/client";
import { prisma } from "./db";
import { mergeDictRows, wordCreateData, type DictFields, type DictRow } from "./dict";

/** 按小写拼写批量查 dict_entry，大小写变体合并后返回可写入 word 表的词典字段 */
export async function lookupDictFields(spellings: string[], db: PrismaClient = prisma): Promise<Map<string, DictFields>> {
  const out = new Map<string, DictFields>();
  if (!spellings.length) return out;
  const rows = await db.dictEntry.findMany({ where: { spelling: { in: spellings } }, select: { word: true, spelling: true, phonetic: true, definition: true, translation: true, collins: true, oxford: true, tag: true, bnc: true, frq: true, exchange: true } });
  const groups = new Map<string, DictRow[]>();
  for (const r of rows) (groups.get(r.spelling) ?? groups.set(r.spelling, []).get(r.spelling)!).push(r);
  for (const [spelling, g] of groups) out.set(spelling, mergeDictRows(g));
  return out;
}

/** 取词条，没有则新建；新建时从 dict_entry 带上词典字段（音标 / 中文释义 / 标签 / 词频），不调用 AI */
export async function getOrCreateWord(spelling: string) {
  const found = await prisma.word.findUnique({ where: { spelling } });
  if (found) return found;
  const dict = (await lookupDictFields([spelling])).get(spelling);
  try {
    return await prisma.word.create({ data: wordCreateData(spelling, dict) });
  } catch {
    // 并发下另一个请求刚插入了同一拼写：唯一键冲突时改读已存在的行，不要 500（审计 F179）
    const again = await prisma.word.findUnique({ where: { spelling } });
    if (again) return again;
    throw new Error(`建词失败：${spelling}`);
  }
}

/**
 * 详情页用：优先取 word 行；词表里没有就用 dict_entry 合成一个「虚拟词条」（id 为空，没有个人记录），
 * 读接口不再往全局共享的 word 表写行（审计 F011）。词典也没有收录时返回 null。
 */
export async function findWordOrDict(spelling: string) {
  const found = await prisma.word.findUnique({ where: { spelling } });
  if (found) return found;
  const dict = (await lookupDictFields([spelling])).get(spelling);
  return dict ? { id: "", ...wordCreateData(spelling, dict) } : null;
}

/** 备注 / 反馈用：只给词表或词典里有的词建行，挡住用任意合法拼写灌全局词表（审计 F011） */
export async function getOrCreateKnownWord(spelling: string) {
  const found = await prisma.word.findUnique({ where: { spelling } });
  if (found) return found;
  const dict = (await lookupDictFields([spelling])).get(spelling);
  return dict ? getOrCreateWord(spelling) : null;
}
