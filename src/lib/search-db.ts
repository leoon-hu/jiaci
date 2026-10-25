import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { AI_CORE_SELECT, pickAi, type AiPreference } from "./ai/providers";
import { candidateLemmas, lemmaBase } from "./lemma";
import { pickLemma } from "./dict";
import { dictLemmas } from "./dict-db";
import { inflectionsOf, lemmaHint, wordCore } from "./word-view";
import { isValidWord } from "./words";
import { lemmaNote, mergeHits, rankFuzzy, sortZh, SEARCH_FUZZY_MIN_LEN, SEARCH_LIMIT, type SearchHit, type SearchQuery, type SearchResult } from "./search";

/**
 * 单词搜索（需求 3.9）的查库部分：只查 word 表（与公开词条页的收录范围一致）、只读不建。
 * 先用 SQL 挑出排好序的 id，再按 id 取词头与核心义——核心义要连两张 AI 表，只为最后这十来个词连，
 * 不在几千个前缀命中上做 JOIN（单词列表的搜索踩过：整张 AI 表拉进哈希，一次 100 ms）。
 */

const HIT_SELECT = { id: true, spelling: true, display: true, translation: true, exchange: true, ...AI_CORE_SELECT } as const;
type HitRow = Prisma.WordGetPayload<{ select: typeof HIT_SELECT }>;

/** 中文搜索先按词频取这么多个候选，再在内存里按 zhRank 排档 */
const ZH_POOL = 200;
/** 拼错时先按三元组相似度取这么多个候选，再按编辑距离与词频重排 */
const FUZZY_POOL = 50;

/** LIKE 的通配符用 ! 转义，与单词列表的搜索同一写法 */
const escLike = (s: string) => s.replace(/[!%_]/g, (c) => `!${c}`);

/** 核心义与单词列表同一口径：所选来源有资料用 core，没有用词典第一条释义 */
function toHit(w: HitRow, pref: AiPreference, note?: string): SearchHit {
  const core = wordCore(w, pickAi(w, pref)?.row);
  return { spelling: w.spelling, display: w.display, pos: core.pos, def: core.def, ...(note ? { note } : {}) };
}

/** 按 id 取一批词条，保持给定的顺序 */
async function rowsById(ids: string[]): Promise<HitRow[]> {
  if (!ids.length) return [];
  const rows = await prisma.word.findMany({ where: { id: { in: ids } }, select: HIT_SELECT });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is HitRow => !!r);
}

export async function searchWords(q: SearchQuery, pref: AiPreference): Promise<SearchResult> {
  return q.kind === "zh" ? searchZh(q.text, pref) : searchEn(q.text, pref);
}

/**
 * 英文：拼写与显示词头按前缀（China 输 chin 能搜到），完全相同的排第一，其余按词频（当代语料，没有的按 BNC）；
 * 输入是变形时原形排在完全相同的后面、前缀前面；前缀一个都没有、输入又够长时按拼写相似度给「你要找的是不是」
 */
async function searchEn(q: string, pref: AiPreference): Promise<SearchResult> {
  const esc = escLike(q);
  const [prefixIds, lemma] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM word
      WHERE spelling LIKE ${`${esc}%`} ESCAPE '!' OR lower(display) LIKE ${`${esc}%`} ESCAPE '!'
      ORDER BY (spelling = ${q} OR COALESCE(lower(display), '') = ${q}) DESC, COALESCE(frq, bnc) NULLS LAST, length(spelling), spelling
      LIMIT ${SEARCH_LIMIT}`,
    q.includes(" ") ? null : lemmaOf(q),
  ]);
  const prefix = await rowsById(prefixIds.map((r) => r.id));
  const exact = prefix.filter((r) => r.spelling === q || r.display?.toLowerCase() === q);
  const hits = mergeHits([exact.map((r) => toHit(r, pref)), lemma ? [toHit(lemma.row, pref, lemma.note)] : [], prefix.map((r) => toHit(r, pref))]);
  if (hits.length || q.replace(/[^a-z]/g, "").length < SEARCH_FUZZY_MIN_LEN) return { hits, fuzzy: false };
  // 拼错了（recieve）：pg_trgm 的相似度取候选（2.8 万行顺序扫一遍约 20 ms，只在前缀落空时才做），
  // 但它对字母对调不敏感（relieve 比 receive 更「像」recieve），所以再按编辑距离与词频重排；
  // 短词的三元组太少（teh 与 the 的相似度只有 0.14），5 个字母以内另取长度差 1 以内、开头字母相同（或头两个字母对调）的词
  const short = q.length <= 5
    ? Prisma.sql` UNION SELECT id, spelling, COALESCE(frq, bnc) AS rank FROM word
        WHERE length(spelling) BETWEEN ${q.length - 1} AND ${q.length + 1} AND left(spelling, 1) IN (${q.slice(0, 1)}, ${q.slice(1, 2)})`
    : Prisma.empty;
  const pool = await prisma.$queryRaw<Array<{ id: string; spelling: string; rank: number | null }>>`
    (SELECT id, spelling, COALESCE(frq, bnc) AS rank FROM word WHERE similarity(spelling, ${q}) >= 0.2
     ORDER BY similarity(spelling, ${q}) DESC, spelling LIMIT ${FUZZY_POOL})${short}`;
  const near = rankFuzzy(q, pool);
  return { hits: (await rowsById(near.map((r) => r.id))).map((r) => toHit(r, pref)), fuzzy: near.length > 0 };
}

/**
 * 输入是变形时对应的原形（went → go、studies → study、easier → easy），挑法与点词小框相同（pickLemma）；
 * 输入本身是词条、又是别的词的变形时（found、better）给它的原形（find、good）。没有返回 null
 */
async function lemmaOf(q: string): Promise<{ row: HitRow; note: string } | null> {
  const cands = candidateLemmas(q).filter(isValidWord);
  if (!cands.length) return null;
  const base = lemmaBase(q);
  const [rows, lemmas] = await Promise.all([
    prisma.word.findMany({ where: { spelling: { in: cands } }, select: HIT_SELECT }),
    dictLemmas([base]),
  ]);
  const bySpelling = new Map(rows.map((r) => [r.spelling, r]));
  const dictLemma = lemmas.get(base);
  // 词典写的原形不在去后缀的候选里（easier → easy、men → man）就补查一次
  if (dictLemma && !bySpelling.has(base) && !cands.includes(dictLemma) && isValidWord(dictLemma)) {
    for (const r of await prisma.word.findMany({ where: { spelling: dictLemma }, select: HIT_SELECT })) bySpelling.set(r.spelling, r);
  }
  const pick = pickLemma(q, cands, (s) => bySpelling.has(s), { dictLemma, exchangeOf: (s) => bySpelling.get(s)?.exchange });
  if (!pick) return null;
  if (pick !== base) {
    const row = bySpelling.get(pick)!;
    return { row, note: lemmaNote(base, inflectionsOf(pick, row.exchange).find((f) => f.w === base)?.label) };
  }
  const hint = lemmaHint(base, bySpelling.get(base)?.exchange, null);
  if (!hint || !isValidWord(hint.base)) return null;
  const row = bySpelling.get(hint.base) ?? await prisma.word.findUnique({ where: { spelling: hint.base }, select: HIT_SELECT });
  return row ? { row, note: lemmaNote(base, hint.label === "变形" ? null : hint.label) } : null;
}

/**
 * 中文：按包含匹配词典释义整段与所选来源的核心义（与单词列表的中文搜索同一范围），
 * 先按词频取一批候选，再按「核心义正好是它 → 词典释义正好是它 → 以它开头 → 核心义里有 → 只在词典释义里有」排档
 */
async function searchZh(q: string, pref: AiPreference): Promise<SearchResult> {
  const like = `%${escLike(q)}%`;
  // 核心义命中哪家与 pickAi 一致（单词列表 listQuery 的 ai_hit 同一写法）：指定厂商只看那一家；auto 是 DeepSeek 优先
  const aiHit = pref === "deepseek"
    ? Prisma.sql`SELECT word_id FROM word_ai_deepseek WHERE core ILIKE ${like} ESCAPE '!'`
    : pref === "openai"
      ? Prisma.sql`SELECT word_id FROM word_ai_openai WHERE core ILIKE ${like} ESCAPE '!'`
      : Prisma.sql`SELECT word_id FROM word_ai_deepseek WHERE core ILIKE ${like} ESCAPE '!'
          UNION
          SELECT o.word_id FROM word_ai_openai o WHERE o.core ILIKE ${like} ESCAPE '!'
            AND NOT EXISTS (SELECT 1 FROM word_ai_deepseek d2 WHERE d2.word_id = o.word_id)`;
  const ids = await prisma.$queryRaw<Array<{ id: string }>>`
    WITH ai_hit AS MATERIALIZED (${aiHit})
    SELECT id FROM word
    WHERE translation ILIKE ${like} ESCAPE '!' OR id IN (SELECT word_id FROM ai_hit)
    ORDER BY COALESCE(frq, bnc) NULLS LAST, length(spelling), spelling
    LIMIT ${ZH_POOL}`;
  const rows = await rowsById(ids.map((r) => r.id));
  const ranked = sortZh(q, rows.map((r) => ({ r, core: pickAi(r, pref)?.row.core ?? null, translation: r.translation })));
  return { hits: ranked.slice(0, SEARCH_LIMIT).map((x) => toHit(x.r, pref)), fuzzy: false };
}
