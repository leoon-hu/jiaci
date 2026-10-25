import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AI_PROVIDERS, aiDetailSelect, aiRelationOf, aiRowOf, isFullAiRow, type AiProvider } from "./ai/providers";
import { wordCore, wordView, type WordView } from "./word-view";
import { ipaBody, pickLemma, wordFreq, type WordFreq } from "./dict";
import { dictLemmas } from "./dict-db";
import { isValidWord, normalizeWord, wordKind, type WordKind } from "./words";
import { candidateLemmas, lemmaBase, tokenize } from "./lemma";
import { bookByName, type PublicBook } from "./public-books";
import { wordCategories } from "./categories-db";
import type { WordCategory } from "./categories";
import { getConfigInt } from "./config";
import { siteUrl } from "./site";
import { brandExample, pickBrandWords, type BrandMark } from "./brand";
import { lockedOf, withoutLocked, type LockedBlocks } from "./locked";

/**
 * 公开词条页 / 词库页（/dict/…，匿名可看，供搜索引擎收录）的取数。
 * 只公开 word 表（AI 资料几乎全覆盖），不查 dict_entry——77 万行词典原文页面薄、量大，只会拖累收录；
 * 资料固定取 AI_PROVIDERS[0]（用户设置里的「来源」是登录后的事），没有的词用词典字段兜底。
 * 助记 / 词源与构词 / 易混词 / 常见错误四块登录后才看（需求 3.7 P13），取数时就去掉，只留各有几条。
 * 这里的函数都不碰 cookies / headers，页面才能走 ISR（每天再生成一次）。
 */
export const PUBLIC_AI: AiProvider = AI_PROVIDERS[0];
/** 词库页每页词数 */
export const BOOK_PAGE_SIZE = 100;
/** sitemap 每片词条数 */
export const SITEMAP_SHARD = 5000;

export { spellingToPath, dictUrl, pathToSpelling, bookPageUrl } from "./dict-url";

export type PublicWord = {
  id: string; spelling: string; display: string | null; kind: WordKind;
  view: WordView; freq: WordFreq;
  /** 收录本词的内置词库（按展示顺序） */
  books: PublicBook[];
  /** 同类词（需求 3.4 I7）：本词所属的类别及各类别里的其它词；成员都在 word 表里，页面上每个都是内链 */
  categories: WordCategory[];
  /** 正文里可以链到别的词条的 token（小写）→ 目标拼写；只链 word 表里有的词 */
  links: Record<string, string>;
  /** AI 资料生成时间（sitemap 的 lastmod） */
  updatedAt: Date | null;
  /** 来源标注（需求 3.7 P12）：名单里的词在一条例句的译文后面带一处，不在名单里是 null */
  brand: BrandMark | null;
  /** 登录后才看的四块各有几条（需求 3.7 P13）；内容本身不在 view 里，页面只拿它画「登录后可看」卡片 */
  locked: LockedBlocks;
};

/**
 * 带来源标注的词（需求 3.7 P12）：名单要拿全部拼写排一次序，每个进程一天算一次；`public.brand_words` 改了马上重算。
 * 查库失败这次就不标、下次请求再算，不让词条页因为它出错
 */
const BRAND_TTL_MS = 86_400_000;
let brandCache: { at: number; max: number; words: Promise<Set<string>> } | null = null;
async function brandWords(): Promise<Set<string>> {
  const max = await getConfigInt("public.brand_words", 0);
  if (brandCache && brandCache.max === max && Date.now() - brandCache.at < BRAND_TTL_MS) return brandCache.words;
  const words: Promise<Set<string>> = (max > 0
    ? prisma.word.findMany({ select: { spelling: true } }).then((rows) => pickBrandWords(rows.map((r) => r.spelling), max))
    : Promise.resolve(new Set<string>())
  ).catch((e) => {
    console.warn("[public] 来源标注的名单没算出来，这次不标:", (e as Error).message);
    if (brandCache?.words === words) brandCache = null;
    return new Set<string>();
  });
  brandCache = { at: Date.now(), max, words };
  return words;
}

/** 正文里所有英文文本，用来找可内链的词 */
function englishTexts(v: WordView): string[] {
  const out: string[] = [];
  for (const m of v.meanings) for (const s of m.senses) if (s.ex) out.push(s.ex.en);
  for (const e of v.examples) out.push(e.en);
  for (const c of v.collocations) out.push(c.en);
  for (const c of v.phrases) out.push(c.en);
  for (const p of v.patterns) { out.push(p.en); if (p.ex) out.push(p.ex.en); }
  if (v.usage) out.push(v.usage);
  for (const f of v.family) out.push(f.w);
  for (const f of v.cognates) out.push(f.w);
  for (const s of v.synonyms) out.push(s.w);
  for (const a of v.antonyms) out.push(a.w);
  for (const c of v.confusables) out.push(c.w);
  for (const f of v.inflections) out.push(f.w);
  return out;
}

/**
 * 内链表：正文里每个英文 token（含整条短语，如词族里的 give up）→ word 表里存在的拼写。
 * token 本身不在表里就试它的原形（abandoned → abandon，挑法同点词小框的 pickLemma），都没有就不链；
 * 本词自己也不链——本词页上的变形（plume 页的 plumes）也不链，不能因为本词被排除就退到 plum 去。
 */
async function linkTable(headword: string, texts: string[]): Promise<Record<string, string>> {
  const phrases = new Set<string>();
  const cands = new Map<string, string[]>();
  for (const text of texts) {
    const whole = normalizeWord(text);
    if (whole.includes(" ") && isValidWord(whole)) phrases.add(whole);
    for (const t of tokenize(text)) {
      if (!t.word) continue;
      const base = t.text.toLowerCase();
      if (!cands.has(base)) cands.set(base, Array.from(new Set([base, ...candidateLemmas(base)])).filter(isValidWord));
    }
  }
  phrases.delete(headword);
  cands.delete(headword);
  if (!phrases.size && !cands.size) return {};
  const lemmas = await dictLemmas(Array.from(cands.keys(), lemmaBase));
  const all = new Set([...phrases, ...Array.from(cands.values()).flat(), ...Array.from(lemmas.values()).filter(isValidWord)]);
  const rows = await prisma.word.findMany({ where: { spelling: { in: Array.from(all) } }, select: { spelling: true, exchange: true } });
  const exchange = new Map(rows.map((r) => [r.spelling, r.exchange]));
  const has = (s: string) => exchange.has(s);
  const links: Record<string, string> = {};
  for (const p of phrases) if (has(p)) links[p] = p;
  for (const [token, list] of cands) {
    const hit = pickLemma(token, list, has, { dictLemma: lemmas.get(lemmaBase(token)), exchangeOf: (s) => exchange.get(s) });
    if (hit && hit !== headword) links[token] = hit;
  }
  return links;
}

/** 公开词条：查不到（不在 word 表）返回 null。generateMetadata 与页面各调一次，用 React cache 合并成一次查询 */
export const loadPublicWord = cache(async (spelling: string): Promise<PublicWord | null> => {
  const word = await prisma.word.findUnique({ where: { spelling }, include: aiDetailSelect(PUBLIC_AI) });
  if (!word) return null;
  const row = aiRowOf(word, PUBLIC_AI);
  const ai = isFullAiRow(row) ? row : null;
  const raw = wordView(word, ai, PUBLIC_AI);
  // 音标去掉斜杠（页面用 CSS 画）：公开页的数据里不出现「/ˈlæsi/」这种会被搜索引擎当路径去抓的字符串
  const full: WordView = raw.phonetic ? { ...raw, phonetic: { us: ipaBody(raw.phonetic.us), uk: ipaBody(raw.phonetic.uk) } } : raw;
  // 登录后才看的四块在这里就去掉（需求 3.7 P13）：页面的 HTML 与内嵌数据里都不能有，内链表也不必为它们查词
  const locked = lockedOf(full);
  const view = withoutLocked(full);
  const [memberships, links, categories, branded] = await Promise.all([
    prisma.wordbookWord.findMany({ where: { wordId: word.id, wordbook: { type: "builtin" } }, select: { wordbook: { select: { name: true, sortOrder: true } } }, orderBy: { wordbook: { sortOrder: "asc" } } }),
    linkTable(spelling, englishTexts(view)),
    wordCategories(word.id, PUBLIC_AI),
    brandWords(),
  ]);
  // 同类词的成员本来就都在 word 表里，直接进内链表，不用再查一遍
  for (const c of categories) for (const w of c.words) links[w.spelling] = w.spelling;
  const books = memberships.map((m) => bookByName(m.wordbook.name)).filter((b): b is PublicBook => !!b);
  const brand = branded.has(spelling) ? brandExample(spelling, view.examples, new URL(siteUrl()).host) : null;
  return { id: word.id, spelling, display: word.display, kind: wordKind(spelling), view, freq: wordFreq(word), books, categories, links, updatedAt: ai?.generatedAt ?? null, brand, locked };
});

/** phonetic 不带斜杠（见 loadPublicWord） */
export type PublicBookRow = { spelling: string; display: string | null; phonetic: string | null; pos: string; def: string | null };
export type PublicBookPage = { book: PublicBook; wordCount: number; page: number; pages: number; rows: PublicBookRow[] };

/** 词库页：某本内置词库的第 page 页（从 1 起）；词库不存在或页码越界返回 null */
export const loadPublicBook = cache(async (book: PublicBook, page: number): Promise<PublicBookPage | null> => {
  const wb = await prisma.wordbook.findFirst({ where: { type: "builtin", name: book.name }, select: { id: true, wordCount: true } });
  if (!wb) return null;
  const pages = Math.max(1, Math.ceil(wb.wordCount / BOOK_PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > pages) return null;
  const rel = aiRelationOf(PUBLIC_AI);
  // 关系字段名按厂商算出来，Prisma 的类型推不出结果形状，自己标
  type Row = { word: { spelling: string; display: string | null; phonetic: string | null; translation: string | null } & Record<string, { core: string | null; corePos: string | null; phoneticUs: string | null } | null> };
  const rows = (await prisma.wordbookWord.findMany({
    where: { wordbookId: wb.id }, orderBy: { sortOrder: "asc" }, skip: (page - 1) * BOOK_PAGE_SIZE, take: BOOK_PAGE_SIZE,
    select: { word: { select: { spelling: true, display: true, phonetic: true, translation: true, [rel]: { select: { core: true, corePos: true, phoneticUs: true } } } as Prisma.WordSelect } },
  })) as unknown as Row[];
  return {
    book, wordCount: wb.wordCount, page, pages,
    rows: rows.map(({ word: w }) => {
      const ai = w[rel];
      const core = wordCore(w, ai);
      const ph = ai?.phoneticUs?.trim() || w.phonetic?.trim() || null;
      return { spelling: w.spelling, display: w.display, phonetic: ph ? ipaBody(ph) : null, pos: core.pos, def: core.def };
    }),
  };
});

/** 目录页：内置词库及其词数（按展示顺序；库里没有的定义不列） */
export const loadPublicBooks = cache(async (): Promise<Array<PublicBook & { wordCount: number }>> => {
  const rows = await prisma.wordbook.findMany({ where: { type: "builtin" }, select: { name: true, wordCount: true }, orderBy: { sortOrder: "asc" } });
  return rows.map((r) => { const b = bookByName(r.name); return b ? { ...b, wordCount: r.wordCount } : null; }).filter((b): b is PublicBook & { wordCount: number } => !!b);
});

/** sitemap：词条总数与某一片的拼写 + 更新时间（按拼写排序，分片稳定） */
export const countPublicWords = () => prisma.word.count();
export async function listPublicWords(shard: number): Promise<Array<{ spelling: string; updatedAt: Date | null }>> {
  const rel = aiRelationOf(PUBLIC_AI);
  type Row = { spelling: string } & Record<string, { generatedAt: Date } | null>;
  const rows = (await prisma.word.findMany({ orderBy: { spelling: "asc" }, skip: shard * SITEMAP_SHARD, take: SITEMAP_SHARD, select: { spelling: true, [rel]: { select: { generatedAt: true } } } as Prisma.WordSelect })) as unknown as Row[];
  return rows.map((r) => ({ spelling: r.spelling, updatedAt: r[rel]?.generatedAt ?? null }));
}
