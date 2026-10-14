import { isValidWord, normalizeWord } from "./words";

/**
 * 同类词（需求 3.4 I7）：同一语义类别里的词（mother → father / brother / sister，apple → banana / orange）。
 * 不是 AI 字段：数据是仓库里手工整理的分类词表 lists/同类词.tsv，一行一个类别「类别名<TAB>词, 词, 词」，
 * # 后是注释；类别与词的先后就是展示顺序。由 scripts/categories.ts 写进 word_category / word_category_member。
 * 这个文件只有纯函数（解析词表、摘要），浏览器与 Node 都能引；查库在 categories-db.ts。
 */

/** 词表里的一个成员：拼写 + 可选的「在这个类别里显示的释义」（多义词按类别指定义项：judge=法官） */
export type CategoryEntry = { w: string; gloss: string | null };
/** 词表里的一个类别 */
export type CategoryDef = { name: string; entries: CategoryEntry[] };
/** 类别里的一个成员（详情页 / 公开页用）：拼写、显示用词头、一句主释义 */
export type CategoryWord = { spelling: string; display: string | null; def: string | null };
/** 某个词所属的一个类别：words 是这一类里本词之外的其它成员，按词表顺序 */
export type WordCategory = { name: string; words: CategoryWord[] };

/** 类别名最长几个字（标题行要放得下） */
export const CATEGORY_NAME_MAX = 12;
/** 一个类别至少几个词才有意义（两个词互为「同类」没什么可看的） */
export const CATEGORY_MIN_WORDS = 3;
/** 「词=释义」里释义最长几个字（成员后面的小字） */
export const GLOSS_MAX = 20;

/**
 * 解析分类词表：返回合法的类别，以及发现的问题（重复的类别名、重复或不合法的词、不合规的释义、太短的类别）。
 * 一项是「词」或「词=释义」：多义词的主释义和类别对不上时（judge 的主释义是「判断」，在「法律职业」里要显示「法官」）用后者指定。
 * 有问题的条目跳过，其余照常返回——脚本把问题打印出来，不因为一处笔误整份不建。
 */
export function parseCategoryList(text: string): { categories: CategoryDef[]; problems: string[] } {
  const categories: CategoryDef[] = [];
  const problems: string[] = [];
  const names = new Set<string>();
  text.split(/\r?\n/).forEach((line, i) => {
    // 注释去掉后整行只剩空白就跳过；不先 trim 整行，否则行首的制表符（类别名为空）会被吃掉
    const raw = line.replace(/#.*$/, "");
    if (!raw.trim()) return;
    const n = i + 1;
    const tab = raw.indexOf("\t");
    if (tab < 0) { problems.push(`第 ${n} 行：没有制表符分隔类别名与词`); return; }
    const name = raw.slice(0, tab).trim();
    const body = raw.slice(tab + 1);
    if (!name) { problems.push(`第 ${n} 行：类别名为空`); return; }
    if (name.length > CATEGORY_NAME_MAX) { problems.push(`第 ${n} 行：类别名「${name}」超过 ${CATEGORY_NAME_MAX} 个字`); return; }
    if (names.has(name)) { problems.push(`第 ${n} 行：类别名「${name}」重复`); return; }
    const entries: CategoryEntry[] = [];
    const seen = new Set<string>();
    for (const part of body.split(/[,，]/)) {
      const item = part.trim();
      if (!item) continue;
      const eq = item.indexOf("=");
      const w = normalizeWord(eq < 0 ? item : item.slice(0, eq));
      const gloss = eq < 0 ? null : item.slice(eq + 1).trim();
      if (!isValidWord(w)) { problems.push(`第 ${n} 行「${name}」：「${item}」不是合法的单词或短语`); continue; }
      if (eq >= 0 && (!gloss || gloss.length > GLOSS_MAX)) { problems.push(`第 ${n} 行「${name}」：「${w}」的释义为空或超过 ${GLOSS_MAX} 个字`); continue; }
      if (seen.has(w)) { problems.push(`第 ${n} 行「${name}」：「${w}」重复`); continue; }
      seen.add(w);
      entries.push({ w, gloss });
    }
    if (entries.length < CATEGORY_MIN_WORDS) { problems.push(`第 ${n} 行「${name}」：只有 ${entries.length} 个词，至少 ${CATEGORY_MIN_WORDS} 个`); return; }
    names.add(name);
    categories.push({ name, entries });
  });
  return { categories, problems };
}

/**
 * 主释义只取第一个分句：「放弃；抛弃（人、物或计划）」→「放弃」，成员后面的小字放得下。
 * 开头的括号说明先去掉（「（餐馆等的）服务员，侍者」→「服务员」），否则第一段是空的
 */
export function shortGloss(def: string | null | undefined): string | null {
  const body = (def ?? "").replace(/^\s*[（(][^）)]*[）)]/, "");
  const s = body.split(/[；;，,（(、]/).map((x) => x.trim()).find(Boolean);
  return s || null;
}

/**
 * 折叠块标题行的一行摘要：「水果：banana · orange · pear…（20 个） · 颜色：red · yellow…（15 个）」。
 * 词用显示用词头（Monday），每类最多 `max` 个
 */
export function categorySummary(categories: WordCategory[], max = 3): string {
  return categories.map((c) => {
    const head = c.words.slice(0, max).map((w) => w.display ?? w.spelling).join(" · ");
    return `${c.name}：${head}${c.words.length > max ? "…" : ""}（${c.words.length} 个）`;
  }).join(" · ");
}
