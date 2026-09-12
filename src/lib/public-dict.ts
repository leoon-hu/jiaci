import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AI_PROVIDERS, aiDetailSelect, aiRelationOf, aiRowOf, isFullAiRow, type AiProvider } from "./ai/providers";
import { wordCore, wordView, type WordView } from "./word-view";
import { formatPhonetic, wordFreq, type WordFreq } from "./dict";
import { isValidWord, normalizeWord, wordKind, type WordKind } from "./words";
import { candidateLemmas, tokenize } from "./lemma";
import { bookByName, type PublicBook } from "./public-books";

/**
 * 公开词条页 / 词库页（/dict/…，匿名可看，供搜索引擎收录）的取数。
 * 只公开 word 表（AI 资料几乎全覆盖），不查 dict_entry——77 万行词典原文页面薄、量大，只会拖累收录；
 * 资料固定取 AI_PROVIDERS[0]（用户设置里的「来源」是登录后的事），没有的词用词典字段兜底。
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
  /** 正文里可以链到别的词条的 token（小写）→ 目标拼写；只链 word 表里有的词 */
  links: Record<string, string>;
  /** AI 资料生成时间（sitemap 的 lastmod） */
  updatedAt: Date | null;
};

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
 * token 本身不在表里就试它的原形候选（abandoned → abandon），都没有就不链；本词自己也不链。
 */
async function linkTable(headword: string, texts: string[]): Promise<Record<string, string>> {
  const cands = new Map<string, string[]>();
  for (const text of texts) {
    const whole = normalizeWord(text);
    if (whole.includes(" ") && isValidWord(whole) && !cands.has(whole)) cands.set(whole, [whole]);
    for (const t of tokenize(text)) {
      if (!t.word) continue;
      const base = t.text.toLowerCase();
      if (!cands.has(base)) cands.set(base, Array.from(new Set([base, ...candidateLemmas(base)])).filter(isValidWord));
    }
  }
  cands.delete(headword);
  const all = Array.from(new Set(Array.from(cands.values()).flat())).filter((s) => s !== headword);
  if (!all.length) return {};
  const rows = await prisma.word.findMany({ where: { spelling: { in: all } }, select: { spelling: true } });
  const exists = new Set(rows.map((r) => r.spelling));
  const links: Record<string, string> = {};
  for (const [token, list] of cands) { const hit = list.find((s) => exists.has(s)); if (hit) links[token] = hit; }
  return links;
}

/** 公开词条：查不到（不在 word 表）返回 null。generateMetadata 与页面各调一次，用 React cache 合并成一次查询 */
export const loadPublicWord = cache(async (spelling: string): Promise<PublicWord | null> => {
  const word = await prisma.word.findUnique({ where: { spelling }, include: aiDetailSelect(PUBLIC_AI) });
  if (!word) return null;
  const row = aiRowOf(word, PUBLIC_AI);
  const ai = isFullAiRow(row) ? row : null;
  const view = wordView(word, ai, PUBLIC_AI);
  const [memberships, links] = await Promise.all([
    prisma.wordbookWord.findMany({ where: { wordId: word.id, wordbook: { type: "builtin" } }, select: { wordbook: { select: { name: true, sortOrder: true } } }, orderBy: { wordbook: { sortOrder: "asc" } } }),
    linkTable(spelling, englishTexts(view)),
  ]);
  const books = memberships.map((m) => bookByName(m.wordbook.name)).filter((b): b is PublicBook => !!b);
  return { id: word.id, spelling, display: word.display, kind: wordKind(spelling), view, freq: wordFreq(word), books, links, updatedAt: ai?.generatedAt ?? null };
});

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
      return { spelling: w.spelling, display: w.display, phonetic: ai?.phoneticUs?.trim() || formatPhonetic(w.phonetic), pos: core.pos, def: core.def };
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
