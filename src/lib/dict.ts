/**
 * 外部词典数据（ECDICT）的解析、合并与筛选规则：纯函数。
 * scripts/dict.ts 用它把 dict_entry 筛入 word 表；运行时用它把词典字段兜底成展示用的释义。
 */
import { wordKind } from "./words";

/** 考试标签（ECDICT tag 列），按由易到难排序 */
export const EXAM_TAGS = ["zk", "gk", "cet4", "cet6", "ky", "toefl", "ielts", "gre"] as const;
export const TAG_LABEL: Record<string, string> = { zk: "中考", gk: "高考", cet4: "四级", cet6: "六级", ky: "考研", toefl: "托福", ielts: "雅思", gre: "GRE" };

/** 详情页「词频」Tab 用到的词典字段（word 表） */
export type WordFreq = { frq: number | null; bnc: number | null; collins: number | null; oxford: boolean; tags: string[] };
export const wordFreq = (w: { frq?: number | null; bnc?: number | null; collins?: number | null; oxford?: boolean | null; tags?: string[] | null }): WordFreq =>
  ({ frq: w.frq ?? null, bnc: w.bnc ?? null, collins: w.collins ?? null, oxford: w.oxford ?? false, tags: w.tags ?? [] });
/** 词频排名分档（排名越小越常用）；无数据返回 null */
export function rankBand(rank: number | null | undefined): string | null {
  if (rank == null || rank <= 0) return null;
  if (rank <= 1000) return "最常用";
  if (rank <= 3000) return "常用";
  if (rank <= 8000) return "较常用";
  if (rank <= 20000) return "较少见";
  return "少见";
}

/** dict_entry 一行（与 ecdict.csv 字段一致，空值为 null） */
export type DictRow = {
  word: string; spelling: string;
  phonetic: string | null; definition: string | null; translation: string | null;
  collins: number | null; oxford: boolean; tag: string | null; bnc: number | null; frq: number | null; exchange: string | null;
};

/** 写入 word 表的词典字段 */
export type DictFields = {
  phonetic: string | null; translation: string | null; definition: string | null;
  collins: number | null; oxford: boolean; tags: string[]; bnc: number | null; frq: number | null; exchange: string | null;
  /** 只有大写词头时的显示形式（Monday / China），否则为空 */
  display: string | null;
};

export const splitTags = (tag: string | null | undefined): string[] => Array.from(new Set((tag ?? "").split(/\s+/).filter(Boolean)));

/** 解析词形变化「p:took/d:taken/0:take/1:p」→ { p: "took", d: "taken", "0": "take", "1": "p" } */
export function parseExchange(exchange: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (exchange ?? "").split("/")) {
    const i = part.indexOf(":");
    if (i > 0) out[part.slice(0, i)] = part.slice(i + 1);
  }
  return out;
}

/** 该行是否只是别的词的变形（exchange 含 0:原形，且原形不是自己） */
export function inflectionOf(row: Pick<DictRow, "word" | "exchange">): string | null {
  const base = parseExchange(row.exchange)["0"];
  return base && base.toLowerCase() !== row.word.toLowerCase() ? base : null;
}

/** 是否带有「值得收录」的信号：考试标签 / 牛津 3000 / 柯林斯星级 */
export const hasSignal = (row: Pick<DictRow, "tag" | "oxford" | "collins">) => Boolean(splitTags(row.tag).length || row.oxford || (row.collins ?? 0) > 0);

/** 词频排名是否在阈值内（只认当代语料排名 frq；BNC 排名里专名和英式拼写太多，不单独作为入选依据） */
export const inRank = (row: Pick<DictRow, "bnc" | "frq">, maxRank: number) => maxRank > 0 && (row.frq ?? 0) > 0 && row.frq! <= maxRank;

export type SelectOptions = { maxRank: number; includeForms: boolean };
/** 筛选只需要的几列 */
export type DictSignals = Pick<DictRow, "word" | "spelling" | "translation" | "tag" | "oxford" | "collins" | "bnc" | "frq" | "exchange">;

/**
 * 单行是否入选 word 表：有信号的词直接收；仅靠词频入选的行还要求
 * 词头本身是小写（排除 Aaron / Aachen 这类专名）、中文释义带真正的词性（排除「[计] 绝对地址」「abbr. …」这类缩写 / 术语），
 * 且不是纯变形（went / abandoned 这类），除非 includeForms。短语没有词频数据，只能靠信号入选。
 */
export function selectReason(row: DictSignals, opts: SelectOptions): "tag" | "oxford" | "collins" | "rank" | null {
  if (splitTags(row.tag).length) return "tag";
  if (row.oxford) return "oxford";
  if ((row.collins ?? 0) > 0) return "collins";
  if (inRank(row, opts.maxRank) && row.word === row.spelling && hasRealPos(row.translation) && !looksLikeName(row.translation) && (opts.includeForms || !inflectionOf(row))) return "rank";
  return null;
}

/**
 * 中文释义看起来是人名 / 地名（ECDICT 里小写的 aaron、sheffield 之类）：直接标注，或括号里说明是某国城市 / 郡 / 岛 / 首都。
 * 几处否定是为了不误伤常用词（审计 F084）：surname「呼以姓氏」、anonymous「姓氏不详的」、gazetteer「地名辞典」；
 * 括号说明只在义项很少时才作数，hamburger 的「汉堡(德国港口)」后面还跟着四个普通义项。
 */
export const looksLikeName = (translation: string | null | undefined) => {
  const t = translation ?? "";
  if (/人名(?!单)|男子名|女子名|国名|城市名/.test(t)) return true;
  if (/(?<!呼以)姓氏(?!不[详明])/.test(t)) return true;
  if (/地名(?!辞典|词典|录|表|学)/.test(t)) return true;
  // 逗号也算分隔：parseTranslation 只按分号切，hamburger 的五个义项在同一条里
  const items = parseTranslation(t).reduce((n, m) => n + m.defs.reduce((k, d) => k + d.split(/[，,、]/).filter((x) => x.trim()).length, 0), 0);
  return items <= 3 && /[（(\[][^）)\]]*(城市|郡|首都|首府|港口|港市|州名|岛|小镇|自治市)[^）)\]]*[）)\]]/.test(t);
};

/** 不算「真正词性」的标记：缩写、前后缀、符号等 */
const NOT_REAL_POS = new Set(["abbr.", "pref.", "suf.", "symb.", "comb."]);
/** 中文释义里至少有一行以真正的词性开头（n. / v. / a. / adv. …） */
export const hasRealPos = (translation: string | null | undefined) => parseTranslation(translation).some((m) => m.pos && !NOT_REAL_POS.has(m.pos.split("&")[0]));

/** ECDICT 只有小写词头的专名：显示时首字母大写 */
const DISPLAY_CAPITAL = new Set(["sydney", "toronto", "vancouver", "dubai"]);
/** ECDICT 只收了大写形式、但其实是普通词的：不要把大写当显示形式 */
const DISPLAY_LOWER = new Set(["north", "states", "core", "pole", "fax", "creator", "conservative", "saint", "communion", "populist", "utopian", "utopia", "bourbon", "god", "creation", "demo", "maxim"]);

const signalScore = (r: DictRow) => splitTags(r.tag).length * 10 + (r.oxford ? 5 : 0) + (r.collins ?? 0) + (r.frq && r.frq > 0 ? 1 / r.frq : 0);

/**
 * 把同一小写拼写下的多行（如 china / China）合并成一组词典字段：
 * 以全小写的行为主，其余行的中文释义以「[China] …」形式追加，标签取并集，星级取最大，词频取最小。
 */
export function mergeDictRows(rows: DictRow[]): DictFields {
  if (!rows.length) throw new Error("mergeDictRows: 空");
  const primary = rows.find((r) => r.word === r.spelling) ?? [...rows].sort((a, b) => signalScore(b) - signalScore(a))[0];
  const others = rows.filter((r) => r !== primary);
  const first = <K extends keyof DictRow>(k: K) => (primary[k] ?? others.map((r) => r[k]).find((v) => v != null) ?? null) as DictRow[K] | null;
  const translation = [primary.translation, ...others.filter((r) => r.translation && r.translation !== primary.translation).map((r) => r.translation!.split("\n").map((l) => `[${r.word}] ${l}`).join("\n"))]
    .filter(Boolean).join("\n") || null;
  const tagSet = new Set(rows.flatMap((r) => splitTags(r.tag)));
  const tags = [...EXAM_TAGS.filter((t) => tagSet.has(t)), ...[...tagSet].filter((t) => !(EXAM_TAGS as readonly string[]).includes(t))];
  const minPos = (vals: Array<number | null>) => { const v = vals.filter((x): x is number => (x ?? 0) > 0); return v.length ? Math.min(...v) : null; };
  const maxPos = (vals: Array<number | null>) => { const v = vals.filter((x): x is number => (x ?? 0) > 0); return v.length ? Math.max(...v) : null; };
  return {
    phonetic: first("phonetic"), translation, definition: first("definition"),
    collins: maxPos(rows.map((r) => r.collins)), oxford: rows.some((r) => r.oxford), tags,
    bnc: minPos(rows.map((r) => r.bnc)), frq: minPos(rows.map((r) => r.frq)), exchange: first("exchange"),
    display: DISPLAY_CAPITAL.has(primary.spelling) ? primary.spelling[0].toUpperCase() + primary.spelling.slice(1) : rows.some((r) => r.word === r.spelling) || DISPLAY_LOWER.has(primary.spelling) ? null : primary.word,
  };
}

export type Meaning = { pos: string; defs: string[] };
const POS_RE = /^([a-z]{1,6}\.(?:\s*[&/]\s*[a-z]{1,6}\.)*)\s*(.+)$/;

/**
 * 把词典中文释义（多行「n. 罩；风帽」/「[网络] 胡德」）解析成与 AI 资料同形的 meanings。
 * 优先取带词性的行；没有时退回第一行（去掉「[网络]」之类的来源标记）。
 */
export function parseTranslation(translation: string | null | undefined): Meaning[] {
  const lines = (translation ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const out: Meaning[] = [];
  for (const line of lines) {
    const m = POS_RE.exec(line);
    if (!m) continue;
    const defs = m[2].split(/[；;]\s*/).map((d) => d.trim()).filter(Boolean);
    if (defs.length) out.push({ pos: m[1].replace(/\s+/g, ""), defs });
  }
  if (!out.length && lines.length) {
    const defs = lines[0].replace(/^\[[^\]]*\]\s*/, "").split(/[；;]\s*/).map((d) => d.trim()).filter(Boolean);
    if (defs.length) out.push({ pos: "", defs });
  }
  return out;
}

/** 词典（ECDICT）的老式词性写法 → 与 AI 资料一致的写法：a. → adj.、vt./vi. → v. 等 */
const POS_ALIAS: Record<string, string> = { "a.": "adj.", "ad.": "adv.", "vt.": "v.", "vi.": "v.", "int.": "interj.", "na.": "phrase.", "u.": "n.", "c.": "n." };
/** 词性写法归一，多词性（vt.&vi.、det./pron.）去重后用 / 连接；没有词性返回空串 */
export function normalizePos(pos: string | null | undefined): string {
  const parts = (pos ?? "").split(/[&/]/).map((p) => p.trim().toLowerCase()).filter(Boolean).map((p) => POS_ALIAS[p] ?? p);
  return Array.from(new Set(parts)).slice(0, 2).join("/");
}

/** 列表行用的一句话释义，词性与释义文本分开（「n.」+「瓷器」）；没有词典释义时返回 null */
export function firstDefParts(translation: string | null | undefined): { pos: string; def: string } | null {
  const m = parseTranslation(translation)[0];
  return m ? { pos: normalizePos(m.pos), def: m.defs[0] } : null;
}

/** 一句话释义（词性 + 释义）：「n. 瓷器」；没有词典释义时返回 null */
export function firstDef(translation: string | null | undefined): string | null {
  const d = firstDefParts(translation);
  return d ? `${d.pos} ${d.def}`.trim() : null;
}

/** 新建 word 行的数据：类型按是否含空格判断，有词典数据时一并写入 */
export function wordCreateData(spelling: string, dict?: DictFields) {
  return { spelling, kind: wordKind(spelling), ...(dict ? { ...dict, dictSource: "ecdict", dictUpdatedAt: new Date() } : {}) };
}


/** 词典音标统一加斜杠，与 AI 资料的写法一致 */
export function formatPhonetic(p: string | null | undefined): string | null {
  const s = (p ?? "").trim();
  if (!s) return null;
  return s.startsWith("/") ? s : `/${s}/`;
}

/** 去掉音标两头的斜杠（公开页用 CSS 画斜杠，见 components/public/Ipa.tsx） */
export function ipaBody(p: string): string {
  return p.trim().replace(/^\/+|\/+$/g, "").trim();
}
