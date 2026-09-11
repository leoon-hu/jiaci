import { Prisma } from "@prisma/client";
import { BRITISH_TO_AMERICAN } from "../spelling-variants";
import { parseExchange } from "../dict";
import { candidateLemmas, tokenize } from "../lemma";
import type { AiProvider } from "./providers";
import {
  AiAntonymsSchema, AiCognatesSchema, AiCollocationsSchema, AiConfusablesSchema, AiEtymologySchema, AiExamplesSchema, AiFamilySchema, AiMeaningsSchema,
  AiMistakesSchema, AiPatternsSchema, AiPhrasesSchema, AiSynonymsSchema, parseAi, type AiExamples, type AiMeanings,
} from "./schema";

/**
 * 词条 AI 字段填充（运营脚本 scripts/ai-fill.ts 用，应用运行时不调用）：
 * 一次调用一个词，模型输出一个 JSON，按 lib/ai/schema.ts 契约校验后写入对应厂商的 word_ai_* 表。
 * 各厂商都走 OpenAI 兼容的 chat/completions 接口，密钥只从环境变量读。
 */
export const PROMPT_VERSION = 4;

export type ProviderApi = {
  baseUrl: string; envKey: string; defaultModel: string;
  /** 美元 / 百万 token，只用于估算 */
  price: { input: number; cachedInput: number; output: number };
  /** 推理模型（GPT-5 系列）不接受 temperature */
  supportsTemperature: boolean;
  /** 请求体里附加的字段、附加的请求头（OpenRouter：推理强度、返回实际计费） */
  extraBody?: Record<string, unknown>; extraHeaders?: Record<string, string>;
};
export const PROVIDER_API: Record<AiProvider, ProviderApi> = {
  // 价格：美元 / 百万 token，只用于估算，以账单为准。下面都是高峰时段价（周一至周五 UTC 01:00–04:00、06:00–10:00，即北京时间 9–12 点、14–18 点），离峰时段一律半价
  // DeepSeek：2026-09-10 12:00 起的新价，官方按人民币计价（高峰：缓存命中 0.04、未命中 2、输出 8 元 / 百万 token），这里按 7.2 换算成美元，脚本再乘回 7.2 显示人民币
  // 模型名：旧别名 deepseek-chat 已不在官方 /models 列表里（虽然还能调通），显式用 deepseek-v4-flash；
  // 但它默认开思考模式（同样的输入 prompt_tokens 从 5 涨到 84，还多出按输出价计费的 reasoning token），
  // 填词条字段不需要推理，所以用 extraBody 显式关掉——关掉后与原来的 deepseek-chat 完全等价
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1", envKey: "DEEPSEEK_API_KEY", defaultModel: "deepseek-v4-flash",
    price: { input: 0.278, cachedInput: 0.00556, output: 1.111 }, supportsTemperature: true,
    extraBody: { thinking: { type: "disabled" } },
  },
  // OpenAI 的模型经 openrouter.ai 调用（OpenAI 兼容接口，模型名带 openai/ 前缀，价格与官方一致，返回的 usage.cost 是实际计费）；写 word_ai_openai 表。
  // 直连 OpenAI 的话改 baseUrl 为 https://api.openai.com/v1、envKey 为 OPENAI_API_KEY、模型名去掉前缀，并去掉 extraBody。
  openai: {
    baseUrl: "https://openrouter.ai/api/v1", envKey: "OPENROUTER_API_KEY", defaultModel: "openai/gpt-5.4-mini", price: { input: 0.75, cachedInput: 0.075, output: 4.5 }, supportsTemperature: false,
    extraBody: { reasoning: { effort: "low" }, usage: { include: true } }, extraHeaders: { "X-Title": "AI Word" },
  },
};

export type FillWordInput = { spelling: string; display?: string | null; kind: "word" | "phrase"; translation?: string | null; definition?: string | null; exchange?: string | null };
export type Usage = { input: number; cachedInput: number; output: number; /** 接口返回的实际计费（美元；OpenRouter 有，其它厂商没有） */ cost?: number };
/** 写入厂商表的一行（Prisma 字段名） */
export type AiRowData = {
  phoneticUs: string | null; phoneticUk: string | null; core: string;
  /** 核心义的词性：取 meanings 第一组的 pos，单词列表行显示用 */
  corePos: string | null;
  meanings: AiMeanings; examples: AiExamples;
  collocations: unknown; phrases: unknown; patterns: unknown; usage: string | null; synonyms: unknown; antonyms: unknown; confusables: unknown; mistakes: unknown;
  family: unknown; cognates: unknown; mnemonic: string | null; etymology: unknown;
};

const EXAMPLE_JSON = `{
  "phonetic_us": "/əˈbændən/",
  "phonetic_uk": "/əˈbændən/",
  "core": "放弃；抛弃（人、物或计划）",
  "meanings": [
    { "pos": "v.", "senses": [
      { "zh": "放弃，中止（计划、努力、活动）", "en": "to stop doing something before it is finished", "ex": { "en": "They abandoned the search when it got dark.", "zh": "天黑后他们中止了搜寻。" } },
      { "zh": "遗弃，抛弃（人、动物、地方）", "en": "to leave someone or something and never come back", "ex": { "en": "The puppy had been abandoned by the road.", "zh": "这只小狗被丢弃在路边。" } },
      { "zh": "沉溺于，放纵（abandon oneself to）", "en": "to let a feeling completely control you", "ex": { "en": "She abandoned herself to grief.", "zh": "她沉浸在悲痛之中。" } }
    ] },
    { "pos": "n.", "senses": [ { "zh": "放任，尽情（with abandon）", "en": "a way of behaving without care or control", "ex": { "en": "The kids danced with wild abandon.", "zh": "孩子们尽情狂舞。" } } ] }
  ],
  "examples": [
    { "en": "They had to abandon the car in the snow.", "zh": "他们不得不把车丢在雪地里。", "level": 1 },
    { "en": "The project was abandoned because it cost too much.", "zh": "这个项目因为花费太高被放弃了。", "level": 2 },
    { "en": "He abandoned his family and moved abroad.", "zh": "他抛弃了家人，搬到了国外。", "level": 2 },
    { "en": "After three failed launches, the company finally abandoned the rocket program.", "zh": "三次发射失败后，公司最终放弃了火箭项目。", "level": 3 }
  ],
  "collocations": [ { "en": "abandon a plan / a project", "zh": "放弃计划 / 项目" }, { "en": "abandon an attempt", "zh": "放弃尝试" }, { "en": "abandon hope", "zh": "放弃希望" }, { "en": "abandon a child / a pet", "zh": "遗弃孩子 / 宠物" }, { "en": "be abandoned by", "zh": "被…遗弃" }, { "en": "an abandoned building", "zh": "废弃的建筑" } ],
  "phrases": [ { "en": "abandon ship", "zh": "弃船；（引申）在事情失败前撤离" }, { "en": "with abandon", "zh": "尽情地，无拘无束地" }, { "en": "abandon all hope", "zh": "彻底放弃希望" } ],
  "patterns": [
    { "en": "abandon sb / sth to sth", "zh": "把某人 / 某物丢给（某种境地）", "ex": { "en": "They abandoned the town to the invaders.", "zh": "他们把城镇丢给了入侵者。" } },
    { "en": "abandon oneself to sth", "zh": "沉溺于，尽情…", "ex": { "en": "He abandoned himself to despair.", "zh": "他陷入了绝望。" } }
  ],
  "usage": "中性偏书面，新闻、学术和正式文书里常见；口语里表示「放弃努力」更常说 give up，「丢下人」常说 leave 或 walk out on。英美用法无差别。",
  "synonyms": [ { "w": "give up", "m": "口语最常用，多指放弃努力、习惯或权利" }, { "w": "desert", "m": "偏重丢下人或岗位不管，带责备意味" }, { "w": "forsake", "m": "书面语，抛弃亲近的人、信仰或原则" }, { "w": "quit", "m": "口语，多指退出工作、学业或戒掉习惯" } ],
  "antonyms": [ { "w": "keep", "m": "保留、不放手，最直接的反义" }, { "w": "retain", "m": "正式用语，保有权利、财产或记忆" }, { "w": "continue", "m": "对应「中止」义：把事情继续做下去" } ],
  "confusables": [ { "w": "abundant", "m": "adj. 丰富的；只是拼写相近，词义无关" }, { "w": "abound", "m": "v. 大量存在（abound in / with），别和 abandon 混" } ],
  "mistakes": [
    { "wrong": "abandon to do sth", "right": "give up doing sth / abandon the attempt", "note": "abandon 后接名词或代词，不接不定式" },
    { "wrong": "He was abandoned his plan.", "right": "He abandoned his plan.", "note": "主动放弃用主动语态，被遗弃才用 be abandoned" }
  ],
  "family": [ { "w": "abandoned", "pos": "adj.", "zh": "被遗弃的；放纵的" }, { "w": "abandonment", "pos": "n.", "zh": "放弃；遗弃" } ],
  "cognates": [ { "w": "band", "pos": "n.", "zh": "带子；乐队（同源于「捆绑、约束」）" }, { "w": "bond", "pos": "n.", "zh": "纽带；约束" } ],
  "mnemonic": "a + band（乐队）+ on：乐队还在台上，人却一个个走了——放弃、遗弃。",
  "etymology": { "origin": "来自古法语 abandoner「交出、置于他人支配之下」，à bandon 意为「听凭处置」，后引申为放弃。", "parts": [ { "part": "a-", "meaning": "至，向" }, { "part": "bandon", "meaning": "控制权，支配" } ] }
}`;

export const SYSTEM_PROMPT = `你是一位面向中国英语学习者的学习词典编辑。给定一个英文单词或短语，以及开放词典（ECDICT）里的参考释义，你要编写这个词条的学习资料，帮助学习者更快弄懂、学会、用对这个词。

只输出一个 JSON 对象（不要 Markdown、不要代码块、不要解释），键名与结构必须与下面完全一致，中文一律用简体：

${EXAMPLE_JSON}

各字段要求：
- phonetic_us / phonetic_uk：美式、英式 IPA 音标，用 / / 包裹；短语可为 null。
- core：一句话核心义，不超过 30 个字，写最常用的意思。
- meanings：按词性分组，最多 6 组，每组最多 6 个义项（多义词只保留最常用的几个），最常用的在前，义项要与词典参考一致、不要编造；pos 用缩写（v. n. adj. adv. prep. conj. pron. phrase. 等）。每个义项：zh 中文释义（不超过 40 字），en 用常见词写的简单英文解释（不超过 120 字符，学习者词典风格），ex 一条 6–18 个词的小例句（含本词或其变形）及中文翻译，不合适时 ex 为 null。
- examples：3–5 条例句，由易到难，level 1 基础 / 2 自然 / 3 场景；英文 6–22 个词，必须包含本词或其变形，句子自然常见，中文翻译准确。
- collocations：4–8 条常见搭配（动词、名词、形容词、介词搭配），en 英文，zh 中文；短语可少于 4 条。
- phrases：含本词的短语动词、固定搭配和习语（如 give → give up、give in、give sb a hand），单词一般给 2–6 条，实在没有才给 []。
- patterns：0–4 条句型（如 prevent sb from doing sth），各带一条例句；名词、形容词多为 []。
- usage：语域与场景，不超过 150 字：正式 / 中性 / 口语、常见场合（新闻、学术、日常）、英美差异、语气。
- synonyms：0–6 条近义词，m 是它和本词的一句区别（不超过 50 字），不是释义。
- antonyms：0–5 条反义词，w 英文，m 一句说明它与本词的反义关系或用法差异（不超过 50 字），格式与 synonyms 相同。
- confusables：0–4 条形近、音近或义近的易混词，m 说明怎么区分（不超过 60 字）。
- mistakes：0–4 条中国学习者真会犯的错误（介词、时态、搭配、中式直译等），wrong 是错误说法，right 是对应的正确说法，两者必须不同，note 一句说明（不超过 50 字）；没有把握就给 []，不要凑数。
- family：0–8 条派生词（词、词性、中文），不含 -s / -ed / -ing 这类规则变形。
- cognates：0–6 条同词根的常见词（family 之外的，如 hypothesis → thesis、synthesis；spect → inspect、respect），词、词性、中文，优先给学习者常见的词；词根不透明时才给 []。
- mnemonic：一条助记，不超过 120 字：优先词根词缀或语义联想，其次画面，谐音只在前两者都不合适时用。
- etymology：词源与构词，origin 一句话来源（不超过 80 字），parts 0–4 个词根词缀及含义（part 不超过 15 字，meaning 不超过 20 字）；构词不透明的词只给 origin、parts 给 []。
- 短语（kind = phrase）：family、cognates 给 []，etymology 给 null，其余字段照常。
- 所有英文内容使用美式拼写；例句不要用本词的中文音译；不确定的内容宁可少写，不要编造。`;

/** 用户消息：词条 + 词典参考 */
export function buildUserMessage(w: FillWordInput, feedback?: string): string {
  const lines = [
    `词条：${w.display ?? w.spelling}`,
    `类型：${w.kind === "phrase" ? "短语（phrase）" : "单词（word）"}`,
    "词典参考（ECDICT，义项以此为准，可补充但不要编造）：",
    `- 中文释义：${w.translation?.replace(/\n/g, "；") || "（无）"}`,
    `- 英文释义：${w.definition?.replace(/\n/g, "；").slice(0, 600) || "（无）"}`,
    `- 词形变化：${w.exchange || "（无）"}`,
    "请严格按系统提示的 JSON 结构输出 json。",
  ];
  if (feedback) lines.push("", `上一次输出不符合要求：${feedback}`, "请修正后重新输出完整 JSON。");
  return lines.join("\n");
}

/** 接口调用出错但已经产生用量（截断 / 空内容）：把用量带出来，truncated 供调用方决定要不要加大 max_tokens 重试 */
export class ApiCallError extends Error {
  constructor(message: string, public usage: Usage, public truncated = false) { super(message); }
}

/** 调 OpenAI 兼容接口，返回文本与用量 */
export async function chatJson(provider: AiProvider, model: string, system: string, user: string, opts: { maxTokens: number; temperature?: number; apiKey?: string }): Promise<{ text: string; usage: Usage }> {
  const api = PROVIDER_API[provider];
  const key = opts.apiKey ?? process.env[api.envKey];
  if (!key) throw new Error(`缺少环境变量 ${api.envKey}`);
  const res = await fetch(`${api.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...api.extraHeaders },
    body: JSON.stringify({
      model, messages: [{ role: "system", content: system }, { role: "user", content: user }],
      ...(api.supportsTemperature ? { temperature: opts.temperature ?? 0.3 } : {}),
      max_tokens: opts.maxTokens, response_format: { type: "json_object" }, stream: false, ...api.extraBody,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`${provider} 接口 ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json() as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }>; usage?: Record<string, unknown> };
  const text = data.choices?.[0]?.message?.content ?? "";
  const u = data.usage ?? {};
  const num = (x: unknown) => (typeof x === "number" ? x : 0);
  // 缓存命中：DeepSeek 是 prompt_cache_hit_tokens，OpenAI / OpenRouter 是 prompt_tokens_details.cached_tokens
  const cached = num(u.prompt_cache_hit_tokens) || num((u.prompt_tokens_details as { cached_tokens?: unknown } | undefined)?.cached_tokens);
  const usage: Usage = { input: num(u.prompt_tokens) - cached, cachedInput: cached, output: num(u.completion_tokens) };
  if (typeof u.cost === "number") usage.cost = u.cost;
  // 截断与空返回同样已经计费：把用量挂在错误上，调用方才能算进统计（审计 F097）
  if (!text) throw new ApiCallError("接口没有返回内容", usage, false);
  if (data.choices?.[0]?.finish_reason === "length") throw new ApiCallError("输出被 max_tokens 截断", usage, true);
  return { text, usage };
}

/**
 * 修复模型常犯的两种 JSON 错误（我们的输出里所有数组元素都是对象，不存在合法的裸字符串成员）：
 * 1) 对象里多出来一个没有键名的裸字符串（想补一条释义却漏了键，如 confusables 里的 "n. 风；v. 缠绕",）；
 * 2) 键名后用了全角冒号。
 */
export function repairJson(t: string): string {
  let s = t.replace(/^[ \t]*"(?:[^"\\\n]|\\.)*"[ \t]*,[ \t]*\r?\n/gm, "");
  s = s.replace(/,[ \t]*\r?\n[ \t]*"(?:[^"\\\n]|\\.)*"[ \t]*(?=\r?\n[ \t]*\})/g, "");
  s = s.replace(/"[ \t]*：[ \t]*(?=["\[{\d\-tfn])/g, "\": ");
  return s;
}

export function extractJson(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("没有找到 JSON 对象");
  const body = t.slice(a, b + 1);
  try { return JSON.parse(body); } catch (e) {
    try { return JSON.parse(repairJson(body)); } catch { throw e; }
  }
}

/**
 * 文本里是否出现本词或其变形：把文本切成 token，每个 token 取原形候选（lib/lemma.ts，含不规则动词与复数），
 * 再加上词典 exchange 里列出的形式；短语要求每个组成词都出现（各自允许变形）。
 */
const dehyphen = (w: string) => w.replace(/-/g, "");
let americanToBritish: Record<string, string> | null = null;
/** 英美拼写互认（colour / color） */
/**
 * 只用于例句比对的英美拼写变体补充表：模型写例句时挑两种拼写里更常见的那个，本词是另一个拼写
 * 就会被判「例句不含本词」而整词失败，失败的词下一批还会被重新选中，反复重试反复计费。
 * BRITISH_TO_AMERICAN 收的是主干词，这里补的是它漏掉的派生形式与 ae/oe 合字词。
 *
 * 不并进 BRITISH_TO_AMERICAN：那张表还被 wordbook-rules 用来「英美拼写只留美式」，
 * 加进去会改变内置词库的选词结果（例如剔掉更常用的 aesthetic、只留冷僻的 esthetic）。
 *
 * 逐条列出而不按 -our→-or / -ise→-ize / ll→l 之类的规则替换：规则会把 mourning→morning、
 * filling→filing、fourth→forth、timbre→timber、bellow→below、gravelly→gravely 这些
 * 完全不同的词认成同一个（这几例已在测试里锁定）。
 */
const EXTRA_VARIANTS: Record<string, string> = {
  // ae / oe 合字
  aesthetic: "esthetic", aesthetics: "esthetics", archaeology: "archeology", archaeologist: "archeologist",
  archaeological: "archeological", faeces: "feces", foetus: "fetus", oedema: "edema", oestrogen: "estrogen",
  gynaecology: "gynecology", haemoglobin: "hemoglobin", haemophilia: "hemophilia", orthopaedic: "orthopedic",
  paediatrician: "pediatrician", diarrhoea: "diarrhea", leukaemia: "leukemia",
  // -our → -or 的派生形式
  armoury: "armory", dishonour: "dishonor", glamour: "glamor", glamourous: "glamorous", humourous: "humorous",
  rigour: "rigor", rumoured: "rumored", savoury: "savory", unfavourable: "unfavorable", watercolour: "watercolor",
  // -ise → -ize / -isation → -ization 的派生形式
  centralise: "centralize", commercialise: "commercialize", computerise: "computerize", conceptualise: "conceptualize",
  contextualise: "contextualize", dramatise: "dramatize", exorcise: "exorcize", externalise: "externalize",
  globalise: "globalize", hypothesise: "hypothesize", institutionalise: "institutionalize", internalise: "internalize",
  itemise: "itemize", materialise: "materialize", penalise: "penalize", philosophise: "philosophize",
  revolutionise: "revolutionize", stylise: "stylize", urbanise: "urbanize",
  liberalisation: "liberalization", mechanisation: "mechanization", neutralisation: "neutralization",
  normalisation: "normalization", rationalisation: "rationalization", summarisation: "summarization",
  utilisation: "utilization", visualisation: "visualization",
  // 双写辅音的英美差异
  appall: "appal", distill: "distil", enroll: "enrol", enrollment: "enrolment", enthrall: "enthral",
  fulfill: "fulfil", fulfillment: "fulfilment", install: "instal", installment: "instalment", instill: "instil",
  skillful: "skilful", willful: "wilful", gruelling: "grueling", jeweller: "jeweler", medallist: "medalist",
  panelled: "paneled", panelling: "paneling", councillor: "councilor",
  // 其它
  chilli: "chili", fillet: "filet", lacklustre: "lackluster", melodie: "melody",
};
let extraReverse: Record<string, string> | null = null;
/**
 * 去掉变音符号：protégé → protege。外来词的词条一般写成无符号形式（attache / creche / soigne），
 * 模型例句却用原样的 é / è / ç，两边对不上就会被判「例句不含本词」。
 * 英语里几乎没有只靠变音符号区分的词对，所以这步不会把两个不同的词并成一个。
 */
const deaccent = (w: string) => w.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
function spellingVariants(w: string): string[] {
  americanToBritish ??= Object.fromEntries(Object.entries(BRITISH_TO_AMERICAN).map(([b, a]) => [a, b]));
  extraReverse ??= Object.fromEntries(Object.entries(EXTRA_VARIANTS).map(([b, a]) => [a, b]));
  const bare = deaccent(w);
  return [w, BRITISH_TO_AMERICAN[w], americanToBritish[w], EXTRA_VARIANTS[w], extraReverse[w], bare !== w ? bare : null]
    .filter((x): x is string => !!x);
}
/** 一组词形再加上「双写辅音去一个」的形式（distill / distil），只在比对时用 */
function withUndoubled(words: Iterable<string>): Set<string> {
  const out = new Set<string>();
  for (const w of words) { out.add(w); if (/([a-z])\1$/.test(w)) out.add(w.slice(0, -1)); }
  return out;
}

/**
 * 例句是否含本词：两边都取原形候选再比对（例句里的 overlap 算含 overlapping，keyword 算含 keywords），
 * 连字符词整体、去连字符、各部分都算（water-proof ↔ waterproof，multi ↔ multi-talented），英美拼写互认；短语按各词比对。
 */
export function containsHeadword(text: string, spelling: string, exchange?: string | null): boolean {
  // 先去变音符号再分词：分词按 ASCII 字母切，attaché 里的 é 会把词截断成 attach，
  // 光靠 spellingVariants 那一步救不回来
  const raw = tokenize(deaccent(text)).filter((t) => t.word).map((t) => t.text.toLowerCase());
  const tokens = raw.flatMap((w) => (w.includes("-") ? [w, dehyphen(w), ...w.split("-")] : [w]));
  // 每个位置一组候选：例句一侧可以放宽（overlap 算含 overlapping），位置信息留给短语按顺序比对
  const perToken = tokens.map((t) => withUndoubled([t, ...candidateLemmas(t)].flatMap(spellingVariants)));
  const lemmas = new Set<string>();
  for (const set of perToken) for (const l of set) lemmas.add(l);
  // 例句里相邻两个词连写也算一个候选：本词是 babyboom，例句常写成 baby boom
  for (let i = 0; i + 1 < raw.length; i++) lemmas.add(raw[i] + raw[i + 1]);
  const ex = parseExchange(exchange);
  // 本词一侧的规则化去后缀要限长：candidateLemmas("forest") 会给出 for、"news" 给出 new、"early" 给出 ear，
  // 例句里出现这些常见短词就被判成含本词（审计 F095）。只保留不短于本词六成、且至少 4 个字母的候选。
  const minLen = Math.max(4, Math.ceil(spelling.length * 0.6));
  const derived = candidateLemmas(spelling).filter((f) => f.length >= minLen);
  const formList = [spelling, ...derived, ...["p", "d", "i", "3", "s", "r", "t"].map((k) => ex[k]?.toLowerCase()).filter((x): x is string => !!x)];
  // 反过来，本词分写而例句连写也算：本词 head way，例句写 make headway
  if (spelling.includes("-")) formList.push(dehyphen(spelling));
  if (spelling.includes(" ")) formList.push(spelling.replace(/ /g, ""));
  const forms = withUndoubled(formList.flatMap(spellingVariants));
  for (const f of forms) if (lemmas.has(f)) return true;
  // 短语：各词必须按顺序出现且彼此靠近，不能是散落在句子两端的两个词（审计 F095）。
  // 连字符词同样走这条路：例句里 cell-phone 常写成 cell phone、dining-room 写成 dining room，
  // 整体与去连字符的形式都匹配不上，只能按各部分依次比对。
  const phraseParts = spelling.includes(" ") ? spelling.split(" ") : spelling.includes("-") ? spelling.split("-") : null;
  if (phraseParts) {
    const parts = phraseParts;
    let from = 0;
    for (const part of parts) {
      const variants = withUndoubled([part, ...candidateLemmas(part)].flatMap(spellingVariants));
      const at = perToken.findIndex((set, i) => i >= from && Array.from(variants).some((v) => set.has(v)));
      if (at < 0 || (from > 0 && at - from > 3)) return false;   // 允许中间夹最多 3 个词（give it up、look sth up）
      from = at + 1;
    }
    return true;
  }
  return false;
}

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const phon = (v: unknown): string | null => { const s = str(v, 40); return s && /^\/.+\/$/.test(s) ? s : null; };

/**
 * 校验并整理模型输出：core / meanings / examples 是核心字段，不合格整词失败（调用方带错误重试）；
 * 其余字段不合格置空并记为警告。返回可直接写表的一行。
 */
export function validateFill(raw: unknown, w: FillWordInput): { ok: true; data: AiRowData; warnings: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "不是 JSON 对象" };
  const o = raw as Record<string, unknown>;
  const warnings: string[] = [];
  const core = str(o.core, 40);
  if (!core) return { ok: false, error: "core 缺失" };
  const mr = AiMeaningsSchema.safeParse(o.meanings);
  if (!mr.success) return { ok: false, error: `meanings 不符合结构（最多 6 组词性，每组最多 6 个义项，zh ≤ 40 字，en ≤ 160 字符）：${mr.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("；")}` };
  const meanings = mr.data;
  for (const m of meanings) for (const s of m.senses) if (s.ex && !containsHeadword(s.ex.en, w.spelling, w.exchange)) { warnings.push(`义项例句不含本词，已去掉：${s.ex.en}`); s.ex = null; }
  const exAll = parseAi(AiExamplesSchema, o.examples);
  if (!exAll) return { ok: false, error: "examples 不符合结构（3–5 条 {en, zh, level}）" };
  const examples = exAll.filter((e) => { const ok = containsHeadword(e.en, w.spelling, w.exchange); if (!ok) warnings.push(`例句不含本词，已去掉：${e.en}`); return ok; });
  if (examples.length < 2) return { ok: false, error: "包含本词的例句不足 2 条" };
  const opt = <T,>(name: string, schema: Parameters<typeof parseAi>[0], v: unknown, empty: T): T => {
    if (v == null) return empty;
    const r = parseAi(schema, v) as T | null;
    if (r == null) warnings.push(`${name} 不符合结构，已置空`);
    return r ?? empty;
  };
  const phrase = w.kind === "phrase";
  /** 词源：整体不合规时尽量保留 origin（模型常把词根词缀写得太长），只有 origin 也不能用才置空 */
  const etymologyOf = (v: unknown) => {
    if (v == null) return null;
    const r = parseAi(AiEtymologySchema, v);
    if (r) return r;
    const origin = typeof (v as { origin?: unknown }).origin === "string" ? ((v as { origin: string }).origin.trim().slice(0, 300) || null) : null;
    warnings.push(origin ? "etymology 的词根词缀不符合结构，只保留了来源" : "etymology 不符合结构，已置空");
    return origin ? { origin, parts: [] } : null;
  };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z']+/g, " ").trim();
  const mistakesRaw = opt<Array<{ wrong: string; right: string; note: string }>>("mistakes", AiMistakesSchema, o.mistakes, []);
  const mistakes = mistakesRaw.filter((m) => { const same = norm(m.wrong) === norm(m.right); if (same) warnings.push(`常见错误的错误与正确写法相同，已去掉：${m.wrong}`); return !same; });
  const data: AiRowData = {
    phoneticUs: phon(o.phonetic_us), phoneticUk: phon(o.phonetic_uk), core, corePos: meanings[0].pos.trim() || null, meanings, examples,
    collocations: opt("collocations", AiCollocationsSchema, o.collocations, []),
    phrases: opt("phrases", AiPhrasesSchema, o.phrases, []),
    // 句型自带的例句同样要含本词，与 examples / 义项小例句一致（审计 F096）
    patterns: opt<Array<{ en: string; zh: string; ex: { en: string; zh: string } }>>("patterns", AiPatternsSchema, o.patterns, [])
      .filter((pt) => { const ok = containsHeadword(pt.ex.en, w.spelling, w.exchange); if (!ok) warnings.push(`句型例句不含本词，已去掉：${pt.ex.en}`); return ok; }),
    usage: str(o.usage, 300),
    synonyms: opt("synonyms", AiSynonymsSchema, o.synonyms, []),
    antonyms: opt("antonyms", AiAntonymsSchema, o.antonyms, []),
    confusables: opt("confusables", AiConfusablesSchema, o.confusables, []),
    mistakes,
    family: phrase ? [] : opt("family", AiFamilySchema, o.family, []),
    cognates: phrase ? [] : opt("cognates", AiCognatesSchema, o.cognates, []),
    mnemonic: str(o.mnemonic, 240),
    etymology: phrase ? null : etymologyOf(o.etymology),
  };
  if (!phrase && !data.phoneticUs && !data.phoneticUk) warnings.push("音标缺失或格式不对（需 / / 包裹）");
  if (o.phonetic_us && !data.phoneticUs) warnings.push(`美式音标格式不对：${String(o.phonetic_us)}`);
  return { ok: true, data, warnings };
}

/** DeepSeek 高峰时段：周一至周五 UTC 01:00–04:00、06:00–10:00；其余时间离峰半价 */
export function deepseekPeak(at = new Date()): boolean {
  const day = at.getUTCDay(), h = at.getUTCHours();
  return day >= 1 && day <= 5 && ((h >= 1 && h < 4) || (h >= 6 && h < 10));
}
/** 费用（美元）：接口给了实际计费就用它（OpenRouter），否则按价目估算；DeepSeek 按调用时刻区分高峰 / 离峰 */
export function estimateCost(provider: AiProvider, u: Usage, at = new Date()): number {
  if (u.cost !== undefined) return u.cost;
  const p = PROVIDER_API[provider].price;
  const factor = provider === "deepseek" && !deepseekPeak(at) ? 0.5 : 1;
  return ((u.input * p.input + u.cachedInput * p.cachedInput + u.output * p.output) / 1e6) * factor;
}

/** 数据库连不上、连接被关闭之类的基础设施错误：不是模型的问题，再调一次接口只会白花钱，应等数据库恢复后重写 */
export function isDbError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError || e instanceof Prisma.PrismaClientRustPanicError) return true;
  if (e instanceof Prisma.PrismaClientKnownRequestError && ["P1001", "P1002", "P1008", "P1017", "P2024"].includes(e.code)) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /Can't reach database server|ECONNREFUSED|Connection refused|Server has closed the connection|Timed out fetching a new connection|Connection terminated/i.test(msg);
}
/** 密钥无效、余额不足、被拒绝：继续跑只会每个词都失败，应立即停止 */
export function isFatalApiError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /接口 (401|402|403)\b/.test(msg);
}
/** 限流或服务端错误：等一会再试 */
export function isTransientApiError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /接口 (429|5\d\d)\b|超时|timeout|fetch failed|ECONNRESET|ETIMEDOUT/i.test(msg);
}
