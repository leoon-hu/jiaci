/**
 * 公开词条页的来源标注（需求 3.7 P12）：一部分词条在一条例句的中文译文末尾注明本站来源，
 * 公开页被整站抓走、照搬到别处时副本也带着出处。所有访客看到同一份；纯函数，取数在 lib/public-dict.ts。
 *
 * - 哪些词：全部拼写按 brandHash 排序取前 max 个——与输入顺序无关，词表加一个词最多换掉名单里的一个。
 *   哈希与前缀别改：改了被标注的词整批换掉，搜索引擎那边就是几千页的正文一起变了
 * - 放在哪：一条例句的中文译文末尾，有两条以上时不放第一条（第一条最显眼）；放哪条、用哪种写法都按词固定。
 *   页面上和译文连成同一段文字、不单独包标签——抓取时常只取元素里直接的文字（Scrapy 的 ::text、XPath 的 text()），
 *   单独一层会被漏掉。不放核心义（页面描述、结构化数据、分享卡片都取它）、英文（学习内容与朗读）、
 *   语域（会被切词做内链，app 在词表里）
 */

/** 带标注的词最多这么多个（`public.brand_words` 只能调小或设 0 关掉） */
export const BRAND_WORDS_MAX = 2000;

/** 几种写法按词轮着用，一条替换去不干净；都带站点域名，看到的人能找过来 */
const TAGS: Array<(host: string) => string> = [
  (h) => `（例句来自 AI加词 ${h}）`,
  (h) => `——AI加词 ${h}`,
  (h) => `（AI加词 ${h} 例句）`,
  (h) => `（来源：${h}）`,
];
export const BRAND_TAG_COUNT = TAGS.length;

/**
 * FNV-1a 32 位 + murmur3 的收尾混合（光 FNV-1a 的低位太弱：h % 2 只取决于各字符低位的奇偶，取模挑例句 / 写法会偏）。
 * 调用处加不同前缀，「哪些词」「放哪条」「哪种写法」各是一套互不相关的顺序
 */
export function brandHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** 带标注的词：全部拼写里哈希最小的 max 个（超过上限按上限，≤ 0 一个不选） */
export function pickBrandWords(spellings: Iterable<string>, max: number): Set<string> {
  const n = Math.min(Math.floor(max), BRAND_WORDS_MAX);
  if (!(n > 0)) return new Set();
  const ranked = Array.from(new Set(spellings), (s) => ({ s, h: brandHash(`brand:${s}`) }));
  ranked.sort((a, b) => a.h - b.h || (a.s < b.s ? -1 : a.s > b.s ? 1 : 0));
  return new Set(ranked.slice(0, n).map((r) => r.s));
}

/** 第 index 条例句的译文后面加 text */
export type BrandMark = { index: number; text: string };

/** 选中的词标在哪条例句、用哪种写法；没有带译文的例句返回 null。host 是站点域名（jiaci.app） */
export function brandExample(spelling: string, examples: ReadonlyArray<{ zh: string }>, host: string): BrandMark | null {
  const withZh = examples.flatMap((e, i) => (e.zh.trim() ? [i] : []));
  const pool = withZh.length > 1 ? withZh.filter((i) => i > 0) : withZh;
  if (!pool.length) return null;
  return {
    index: pool[brandHash(`at:${spelling}`) % pool.length],
    text: TAGS[brandHash(`tag:${spelling}`) % TAGS.length](host),
  };
}
