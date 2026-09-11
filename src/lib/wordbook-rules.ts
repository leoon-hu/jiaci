/**
 * 内置词库的选词规则（纯函数），供 scripts/wordbooks.ts 使用。
 */
import { hasRealPos, parseTranslation } from "./dict";
import { BRITISH_TO_AMERICAN } from "./spelling-variants";

export type RuleCand = { spelling: string; kind: "word" | "phrase"; translation: string | null; display: string | null };

/** 允许保留的短缩写 */
const SHORT_KEEP = new Set(["tv", "pc", "dna", "dvd", "cd", "etc", "ok", "am", "pm", "id"]);

/** 单字母一律不要；2–3 个字母且释义没有正规词性的多半是缩写或单位（ac、cm、gp、ml） */
export function isJunkShort(c: RuleCand): boolean {
  const s = c.spelling;
  if (s.length === 1) return true;
  return s.length <= 3 && !SHORT_KEEP.has(s) && !hasRealPos(c.translation);
}

/** 带 sb / sth / one's 占位符的短语（put sth on），不适合当词条学 */
export const isPlaceholderPhrase = (spelling: string) => /(^| )(sb|sth|one's|oneself|somebody|something)( |$)/.test(spelling);

/** 只有大写词头、且带词性的释义只有一条短名词义（n. 伦敦 / n. 法国 / n. 基督）；星期、月份、节日、语言除外 */
export function isProperNounLike(c: RuleCand): boolean {
  if (!c.display) return false;
  const ms = parseTranslation(c.translation);
  if (!ms.length) return false;
  return ms.every((m) => m.pos === "n." && m.defs.length === 1 && m.defs[0].length <= 5 && !/星期|月$|节$|语$/.test(m.defs[0]));
}

/**
 * 以 -ise 结尾但本来就是英语词、不是英式变体的词：不能按后缀规则造出 rize / promize / surprize（审计 F093）。
 * 只列原形，带变形的词会先还原成原形再查。
 */
const ISE_NOT_BRITISH = new Set([
  "advise", "anise", "appraise", "apprise", "arise", "chastise", "chemise", "circumcise", "clockwise", "comprise",
  "compromise", "concise", "crosswise", "demise", "despise", "devise", "disguise", "enterprise", "excise", "exercise",
  "expertise", "franchise", "guise", "imprecise", "improvise", "incise", "lengthwise", "likewise", "malaise",
  "mayonnaise", "merchandise", "noise", "otherwise", "paradise", "poise", "porpoise", "praise", "precise", "premise",
  "promise", "raise", "reprise", "revise", "rise", "sunrise", "supervise", "surmise", "surprise", "tortoise",
  "treatise", "turquoise", "valise", "wise",
]);

/** 英式 -ise / -isation / -yse 后缀换成美式的候选拼写（generalisation → generalization）；不在对照表里的词按后缀试探 */
export function americanCandidate(spelling: string): string | null {
  const mapped = BRITISH_TO_AMERICAN[spelling];
  if (mapped) return mapped;
  const m = /(is(?:e|es|ed|ing)|isation|isations|ys(?:e|es|ed|ing))$/.exec(spelling);
  if (!m) return null;
  const stem = spelling.slice(0, m.index);
  // 词干太短的多半不是「词根 + -ise」（rise、wise），真正的英式变体都是 organ-ise、general-isation 这种
  if (stem.length < 4) return null;
  if (m[1].startsWith("is") && ISE_NOT_BRITISH.has(`${stem}ise`)) return null;
  return stem + m[1].replace(/^is/, "iz").replace(/^ys/, "yz");
}

/**
 * 英美拼写：同一本里两种都在只留美式；只有英式而美式在库里则换成美式（占英式原来的位置）。
 * available 是全库 spelling → 词条，用来找美式替身。对照表之外的 -ise / -isation 只在美式拼写排名不比英式差时替换，
 * 以免把 advertise、surprise 换成词典里偶然存在的 advertize 之类冷僻变体。
 */
export function preferAmerican<T extends { spelling: string; rank?: number | null }>(list: T[], available: Map<string, T>): T[] {
  const present = new Set(list.map((c) => c.spelling));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    const us = americanCandidate(c.spelling);
    let pick = c;
    if (us) {
      const alt = available.get(us);
      const mapped = Boolean(BRITISH_TO_AMERICAN[c.spelling]);
      const better = mapped || (alt != null && (alt.rank ?? Infinity) <= (c.rank ?? Infinity));
      if (better && present.has(us)) continue;
      if (better && alt) pick = alt;
    }
    if (seen.has(pick.spelling)) continue;
    seen.add(pick.spelling);
    out.push(pick);
  }
  return out;
}

/** spelling 是否是 base 的规则变形：teams / worked / studying / stopped（不含 -er / -est，避免 number→numb 这类词典误标） */
export function isRegularInflectionOf(spelling: string, base: string): boolean {
  const b = base.toLowerCase();
  if (!b || b === spelling) return false;
  const stem = b.endsWith("e") ? b.slice(0, -1) : b;
  const forms = [b + "s", b + "es", b + "ed", b + "d", b + "ing", stem + "ed", stem + "ing", b + b[b.length - 1] + "ed", b + b[b.length - 1] + "ing"];
  if (b.endsWith("y")) forms.push(b.slice(0, -1) + "ies", b.slice(0, -1) + "ied");
  return forms.includes(spelling);
}

/** exchange 里 1: 的类型只由 s / p / d / i / 3 / r / t 组成：纯粹的复数、过去式、分词、比较级（feet、cheaper），没有别的身份 */
const isPureForm = (form: string | null | undefined) => Boolean(form && /^[spdi3rt]+$/.test(form));

export type InflectionCand = { spelling: string; base: string | null; oxford: boolean; collins: number | null; translation: string | null; form?: string | null; rank?: number | null; display?: string | null };

/**
 * 变形去重。同一本里原形已在、自己又只是变形、且没有牛津 / 柯林斯信号的词条不单独收。
 * 「只是变形」= 规则变形（teams、tickets、worked）、释义写着「复数 / 过去式」、或词典标成纯变形（exchange 1: 只有 s / p / d / i / 3 / r / t，如 feet、cheaper），
 * 并且词典没给它独立的词频排名——ECDICT 只给独立成词的形式排名（learning、spending、endangered、criteria 有，teams、feet、beginners 没有）。
 * - 原形在本里的去掉；原形不在本里但在全库（available）里的，换成原形（beginners → beginner、falcons → falcon）；
 * - keep 里的词一律保留（refreshments、arms 这类有独立词义、词典既没排名也没星级的形式）；大写词头的形式（AIDS）也保留。
 * means、terms、building 这类有自己释义和星级的仍然保留。
 */
export function dropInflections<T extends InflectionCand>(list: T[], opts: { available?: Map<string, T>; keep?: Set<string> } = {}): T[] {
  const present = new Set(list.map((c) => c.spelling));
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of list) {
    let pick: T | null = c;
    const base = c.base?.toLowerCase();
    if (base && base !== c.spelling && !opts.keep?.has(c.spelling) && !c.display && !c.oxford && !((c.collins ?? 0) > 0)) {
      const formLike = isRegularInflectionOf(c.spelling, base) || /复数|过去式|过去分词|现在分词|第三人称/.test(c.translation ?? "") || isPureForm(c.form);
      if (formLike && c.rank == null) pick = present.has(base) ? null : (opts.available?.get(base) ?? c);
    }
    if (!pick || seen.has(pick.spelling)) continue;
    seen.add(pick.spelling);
    out.push(pick);
  }
  return out;
}

/** 解析词表文件：一行一条，# 后为注释，标准化后去重、跳过不合法的行 */
export function parseListFile(text: string, normalize: (raw: string) => string, valid: (w: string) => boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const raw = line.replace(/#.*$/, "").trim();
    if (!raw) continue;
    const w = normalize(raw);
    if (!valid(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/** 解析补充词典（tsv：拼写、音标、释义，释义多行用 | 分隔） */
export function parseSupplement(text: string, normalize: (raw: string) => string): Map<string, { phonetic: string | null; translation: string }> {
  const out = new Map<string, { phonetic: string | null; translation: string }>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [sp, ph, tr] = line.split("\t");
    const w = normalize(sp ?? "");
    if (!w || !tr?.trim()) continue;
    out.set(w, { phonetic: ph?.trim() || null, translation: tr.trim().split("|").map((s) => s.trim()).filter(Boolean).join("\n") });
  }
  return out;
}
