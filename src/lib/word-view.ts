import { firstDef, firstDefParts, formatPhonetic, normalizePos, parseExchange, parseTranslation } from "./dict";
import {
  AiAntonymsSchema, AiCognatesSchema, AiCollocationsSchema, AiConfusablesSchema, AiEtymologySchema, AiExamplesSchema, AiFamilySchema, AiMeaningsSchema,
  AiMistakesSchema, AiPatternsSchema, AiPhrasesSchema, AiSynonymsSchema, parseAi,
  type AiAntonyms, type AiCognates, type AiConfusables, type AiEtymology, type AiExamples, type AiFamily, type AiMeanings, type AiMistakes, type AiPairs, type AiPatterns, type AiSynonyms,
} from "./ai/schema";
import type { AiProvider } from "./ai/providers";

/** word 表里展示要用的词典字段 */
export type DictPart = { phonetic?: string | null; translation?: string | null; exchange?: string | null };
/** 某一家厂商表（word_ai_*）的一行；JSONB 列按契约解析 */
export type AiInput = {
  phoneticUs?: string | null; phoneticUk?: string | null; core?: string | null;
  meanings?: unknown; examples?: unknown; collocations?: unknown; phrases?: unknown; patterns?: unknown;
  usage?: string | null; synonyms?: unknown; antonyms?: unknown; confusables?: unknown; mistakes?: unknown;
  family?: unknown; cognates?: unknown; mnemonic?: string | null; etymology?: unknown;
};

/**
 * 词条展示视图（需求 3.2.5）：把词典字段与所选厂商的 AI 字段合成前端要的对象，AI 字段为空时用词典兜底：
 * 音标 phonetic_us / uk → 词典音标；主释义 core → 词典第一条；释义块 meanings → 词典释义（只有中文）；
 * 其余内容块没有就是空数组 / null，界面整块不显示。
 */
export type WordView = {
  /** 数据来自哪家厂商；null = 只有词典 */
  provider: AiProvider | null;
  phonetic: { us: string; uk: string } | null;
  core: string | null;
  /** 主释义是否来自 AI（否则是词典第一条） */
  coreFromAi: boolean;
  meanings: AiMeanings;
  /** 释义块来源：ai 有英文解释与小例句；dict 只有中文；none 没有释义 */
  meaningsSource: "ai" | "dict" | "none";
  examples: AiExamples;
  collocations: AiPairs; phrases: AiPairs; patterns: AiPatterns;
  usage: string | null; synonyms: AiSynonyms; antonyms: AiAntonyms; confusables: AiConfusables; mistakes: AiMistakes;
  family: AiFamily; cognates: AiCognates; mnemonic: string | null; etymology: AiEtymology | null;
  /** 词形变化（词典 exchange）：过去式、分词、复数、比较级等；原形词条列变形，变形词条列原形 */
  inflections: Array<{ w: string; label: string }>;
  /** 是否有任何 AI 字段 */
  hasAi: boolean;
};

const EXCHANGE_LABEL: Record<string, string> = { "0": "原形", p: "过去式", d: "过去分词", i: "现在分词", "3": "第三人称单数", s: "复数", r: "比较级", t: "最高级" };
/** 词典 exchange → 展示用的变形列表，同一形式合并标签（abandoned：过去式 / 过去分词） */
export function inflectionsOf(spelling: string, exchange: string | null | undefined): Array<{ w: string; label: string }> {
  const ex = parseExchange(exchange);
  const byForm = new Map<string, string[]>();
  for (const k of ["0", "p", "d", "i", "s", "3", "r", "t"]) {
    const w = ex[k]?.trim().toLowerCase();
    if (!w || w === spelling) continue;
    (byForm.get(w) ?? byForm.set(w, []).get(w)!).push(EXCHANGE_LABEL[k]);
  }
  return Array.from(byForm, ([w, labels]) => ({ w, label: labels.join(" / ") }));
}

const text = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function wordView(dict: DictPart & { spelling?: string }, ai: AiInput | null | undefined, provider: AiProvider | null = null): WordView {
  const a = ai ?? {};
  const aiUs = text(a.phoneticUs), aiUk = text(a.phoneticUk);
  const dictPh = formatPhonetic(dict.phonetic);
  const phonetic = aiUs || aiUk ? { us: aiUs ?? aiUk!, uk: aiUk ?? aiUs! } : dictPh ? { us: dictPh, uk: dictPh } : null;
  const aiMeanings = parseAi(AiMeaningsSchema, a.meanings);
  const dictMeanings = aiMeanings ? [] : parseTranslation(dict.translation).map((m) => ({ pos: normalizePos(m.pos), senses: m.defs.map((zh) => ({ zh })) }));
  const view: WordView = {
    provider: null,
    phonetic,
    core: text(a.core) ?? firstDef(dict.translation),
    coreFromAi: Boolean(text(a.core)),
    meanings: aiMeanings ?? dictMeanings, meaningsSource: aiMeanings ? "ai" : dictMeanings.length ? "dict" : "none",
    examples: parseAi(AiExamplesSchema, a.examples) ?? [],
    collocations: parseAi(AiCollocationsSchema, a.collocations) ?? [],
    phrases: parseAi(AiPhrasesSchema, a.phrases) ?? [],
    patterns: parseAi(AiPatternsSchema, a.patterns) ?? [],
    usage: text(a.usage),
    synonyms: parseAi(AiSynonymsSchema, a.synonyms) ?? [],
    antonyms: parseAi(AiAntonymsSchema, a.antonyms) ?? [],
    confusables: parseAi(AiConfusablesSchema, a.confusables) ?? [],
    mistakes: parseAi(AiMistakesSchema, a.mistakes) ?? [],
    family: parseAi(AiFamilySchema, a.family) ?? [],
    cognates: parseAi(AiCognatesSchema, a.cognates) ?? [],
    mnemonic: text(a.mnemonic),
    etymology: parseAi(AiEtymologySchema, a.etymology),
    inflections: inflectionsOf(dict.spelling ?? "", dict.exchange),
    hasAi: false,
  };
  view.hasAi = Boolean(aiUs || aiUk || view.coreFromAi || aiMeanings || view.examples.length || view.collocations.length || view.phrases.length || view.patterns.length ||
    view.usage || view.synonyms.length || view.antonyms.length || view.confusables.length || view.mistakes.length || view.family.length || view.cognates.length || view.mnemonic || view.etymology);
  view.provider = view.hasAi ? provider : null;
  return view;
}

/**
 * 单词列表用的主释义：词性与释义文本分开，前端把词性单独排版。
 * 所选厂商有资料就用 core + core_pos（核心义所属词性），没有就用词典第一条（词性写法已归一）。
 */
export function wordCore(dict: DictPart, ai?: { core?: string | null; corePos?: string | null } | null): { def: string | null; pos: string } {
  const core = text(ai?.core);
  if (core) return { def: core, pos: normalizePos(ai?.corePos) };
  const d = firstDefParts(dict.translation);
  return { def: d?.def ?? null, pos: d?.pos ?? "" };
}
