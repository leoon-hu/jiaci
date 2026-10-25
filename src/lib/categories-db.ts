import { prisma } from "./db";
import { AI_CORE_SELECT, pickAi, type AiPreference } from "./ai/providers";
import { wordCore } from "./word-view";
import { shortGloss, type WordCategory } from "./categories";

/**
 * 某个词所属的全部类别，以及每个类别里本词之外的其它成员（都按词表顺序）。
 * 成员带一句释义：词表里按类别指定了的（judge=法官）用那个；否则取所选来源的核心义（与单词列表、点词小框同一口径），没有就词典第一条，只取第一个分句。
 * 不在任何类别里返回空数组；id 为空（词典兜底出来、还没进 word 表的词）也直接空
 */
export async function wordCategories(wordId: string, pref: AiPreference = "auto"): Promise<WordCategory[]> {
  if (!wordId) return [];
  const mine = await prisma.wordCategoryMember.findMany({ where: { wordId }, select: { categoryId: true, category: { select: { name: true, sortOrder: true } } } });
  if (!mine.length) return [];
  mine.sort((a, b) => a.category.sortOrder - b.category.sortOrder || a.category.name.localeCompare(b.category.name));
  const rows = await prisma.wordCategoryMember.findMany({
    where: { categoryId: { in: mine.map((m) => m.categoryId) }, wordId: { not: wordId } },
    orderBy: [{ sortOrder: "asc" }],
    select: { categoryId: true, gloss: true, word: { select: { spelling: true, display: true, translation: true, ...AI_CORE_SELECT } } },
  });
  const byCat = new Map<string, WordCategory>(mine.map((m) => [m.categoryId, { name: m.category.name, words: [] }]));
  for (const r of rows) {
    const picked = pickAi(r.word, pref);
    byCat.get(r.categoryId)?.words.push({ spelling: r.word.spelling, display: r.word.display, def: r.gloss ?? shortGloss(wordCore(r.word, picked?.row).def) });
  }
  // 别的成员都不在 word 表里（本机没同步全）时这一类只剩本词，不显示
  return mine.map((m) => byCat.get(m.categoryId)!).filter((c) => c.words.length > 0);
}
