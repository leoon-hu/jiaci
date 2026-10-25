import { parseTranslation } from "./dict";
import { isValidWord, normalizeWord } from "./words";

/**
 * 单词搜索（需求 3.9）的纯逻辑，浏览器与服务端共用：输入怎么理解、结果怎么排、本设备的搜索记录怎么增删。
 * 查库在 lib/search-db.ts，接口 GET /api/search，面板 components/WordSearch.tsx。
 */

/** 一次最多返回几条（输入变形对应的原形也算在里面） */
export const SEARCH_LIMIT = 10;
/** 前缀一个都没有时，按拼写相似度给几个「你要找的是不是」；输入至少这么多个字母才给 */
export const SEARCH_FUZZY_LIMIT = 5;
export const SEARCH_FUZZY_MIN_LEN = 3;
/** 输入只取前这么多个字符 */
export const SEARCH_MAX_LEN = 40;
/** 本设备最多记多少条搜索记录 */
export const SEARCH_HISTORY_MAX = 20;

export type SearchQuery = { kind: "en" | "zh"; text: string };

/** 一条结果：词头、核心义（与单词列表同一口径）；note 是原形那一条的小字（「went 是它的过去式」） */
export type SearchHit = { spelling: string; display: string | null; pos: string; def: string | null; note?: string };
/** fuzzy = 前缀一个都没搜到，hits 是按拼写相似度给的「你要找的是不是」 */
export type SearchResult = { hits: SearchHit[]; fuzzy: boolean };

const HAN = /\p{Script=Han}/u;

/**
 * 输入 → 怎么搜：有汉字按中文释义搜（去掉空白与标点），否则按英文拼写搜（与导入同一套规范化：小写、合并空白、去掉首尾的非字母）；
 * 什么都不剩返回 null，不发请求
 */
export function parseSearchQuery(raw: string): SearchQuery | null {
  const s = (raw ?? "").slice(0, SEARCH_MAX_LEN * 2);
  if (HAN.test(s)) {
    const text = s.replace(/[\s\p{P}\p{S}]+/gu, "").slice(0, SEARCH_MAX_LEN);
    return HAN.test(text) ? { kind: "zh", text } : null;
  }
  const text = normalizeWord(s).slice(0, SEARCH_MAX_LEN).trim();
  return /^[a-z][a-z' -]*$/.test(text) ? { kind: "en", text } : null;
}

/** 几组结果按顺序拼起来（完全相同的 → 输入对应的原形 → 前缀按词频），同一个词只出一次 */
export function mergeHits<T extends { spelling: string }>(groups: T[][], limit = SEARCH_LIMIT): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const g of groups) for (const h of g) {
    if (out.length >= limit) return out;
    if (seen.has(h.spelling)) continue;
    seen.add(h.spelling);
    out.push(h);
  }
  return out;
}

/** 原形那一条的小字：知道是哪种变形就「went 是它的过去式」，不知道就「went 的原形」 */
export const lemmaNote = (form: string, label: string | null | undefined) => (label ? `${form} 是它的${label}` : `${form} 的原形`);

/** 释义按分句切开，去掉开头的「（口语）」「[网络]」这类括号说明 */
const clauses = (s: string | null | undefined): string[] =>
  (s ?? "").split(/[；;，,、/]/).map((x) => x.trim().replace(/^[(（[【][^)）\]】]*[)）\]】]\s*/, "").trim()).filter(Boolean);

/**
 * 中文搜索的档位（越小越靠前）：0 核心义的第一个分句就是它（放弃 → abandon、give up），1 核心义的别的分句是它（drop「滴；落下；…；放弃」），
 * 2 词典释义的某个分句是它，3 某个分句以它开头，4 核心义里有，5 只在词典释义里有。同一档里保持查询给的词频顺序
 */
export function zhRank(q: string, core: string | null | undefined, translation: string | null | undefined): number {
  const c = clauses(core);
  const t = parseTranslation(translation).flatMap((m) => m.defs).flatMap((d) => clauses(d));
  if (c[0] === q) return 0;
  if (c.includes(q)) return 1;
  if (t.includes(q)) return 2;
  if (c.some((x) => x.startsWith(q)) || t.some((x) => x.startsWith(q))) return 3;
  if (core?.includes(q)) return 4;
  return 5;
}

/** 按 zhRank 稳定排序（Array.prototype.sort 是稳定的，同一档保持原来的词频顺序） */
export function sortZh<T extends { core: string | null; translation: string | null }>(q: string, rows: T[]): T[] {
  return rows.map((r) => ({ r, k: zhRank(q, r.core, r.translation) })).sort((a, b) => a.k - b.k).map((x) => x.r);
}

/** 编辑距离，相邻两个字母对调算一步（recieve → receive 是 1；三元组相似度对这种拼错不敏感，所以候选出来后按它重排） */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** 拼错时最多差几步还算「你要找的是不是」：短词只容一处，长一点的两三处 */
export const fuzzyMaxDistance = (len: number) => (len <= 4 ? 1 : len <= 8 ? 2 : 3);

/** 「你要找的是不是」：只留差得不远的，按编辑距离从小到大，同样近的常用词在前（rank = 词频排名，越小越常用，没有的排最后） */
export function rankFuzzy<T extends { spelling: string; rank: number | null }>(q: string, rows: T[], limit = SEARCH_FUZZY_LIMIT): T[] {
  const max = fuzzyMaxDistance(q.length);
  return rows
    .map((r) => ({ r, d: editDistance(q, r.spelling) }))
    .filter((x) => x.d <= max)
    .sort((a, b) => a.d - b.d || (a.r.rank ?? Infinity) - (b.r.rank ?? Infinity))
    .slice(0, limit)
    .map((x) => x.r);
}

/** 搜索记录一条：打开过的词，带当时的核心义，点了直接打开不用再查 */
export type SearchHistoryItem = { spelling: string; display: string | null; def: string | null };

/** 打开了一个词：挪到最前（同一个词只留一条），超出上限的丢掉最旧的 */
export function pushSearchHistory(list: SearchHistoryItem[], item: SearchHistoryItem, max = SEARCH_HISTORY_MAX): SearchHistoryItem[] {
  return [item, ...list.filter((h) => h.spelling !== item.spelling)].slice(0, max);
}

export const dropSearchHistory = (list: SearchHistoryItem[], spelling: string) => list.filter((h) => h.spelling !== spelling);

/** 从本地存储读回来的东西过一遍：不是数组、拼写不合法、重复的都丢掉，文本截短 */
export function normalizeSearchHistory(raw: unknown): SearchHistoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SearchHistoryItem[] = [];
  const seen = new Set<string>();
  const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  for (const x of raw) {
    if (out.length >= SEARCH_HISTORY_MAX) break;
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const spelling = typeof o.spelling === "string" ? normalizeWord(o.spelling) : "";
    if (!isValidWord(spelling) || seen.has(spelling)) continue;
    seen.add(spelling);
    out.push({ spelling, display: str(o.display, 60), def: str(o.def, 80) });
  }
  return out;
}
