import type { WordAiOpenai } from "@prisma/client";

/**
 * 词条 AI 字段按模型厂商分表存放（word_ai_openai / word_ai_deepseek，结构相同，需求 3.4）。
 * 用户在设置里选择看哪家的数据（3.5「词条资料来源」）：auto = 按 AI_PROVIDERS 顺序取第一家有资料的；指定厂商时没有资料就用词典兜底。
 * 新增厂商：加一张同结构的表 + Word 上的关系字段，再把名字加进 AI_PROVIDERS / REL / AI_INCLUDE / AI_CARD_SELECT。
 */
/** 顺序即「自动」模式的优先级：DeepSeek 优先，其次 OpenAI */
export const AI_PROVIDERS = ["deepseek", "openai"] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export type AiPreference = "auto" | AiProvider;
export const AI_PROVIDER_LABEL: Record<AiProvider, string> = { openai: "OpenAI", deepseek: "DeepSeek" };

/** 两张厂商表结构相同，用 OpenAI 表的行类型代表 */
export type WordAiRow = WordAiOpenai;
export type WordAiRelations<T = WordAiRow> = { aiOpenai?: T | null; aiDeepseek?: T | null };
const REL: Record<AiProvider, keyof WordAiRelations> = { openai: "aiOpenai", deepseek: "aiDeepseek" };

/** Prisma include：两家整行（运营脚本、需要全部字段的地方用；单行平均 3.3 KB，页面接口别用） */
export const AI_INCLUDE = { aiOpenai: true, aiDeepseek: true } as const;
/** 点词弹框只用音标、核心义与义项：整行 include 会把例句 / 搭配 / 词源等 JSONB 全拉出来，而返回体只有几百字节 */
export const AI_PEEK_SELECT = {
  aiOpenai: { select: { phoneticUs: true, phoneticUk: true, core: true, corePos: true, meanings: true } },
  aiDeepseek: { select: { phoneticUs: true, phoneticUk: true, core: true, corePos: true, meanings: true } },
} as const;
/**
 * 详情页的 select：只有 primary 那一家取整行，其余厂商只取主键——它们只用来标注「有没有资料」
 * （顶部来源下拉的「无资料」）。原来两家整行都取，一半的数据取回来就扔了。
 */
export function aiDetailSelect(primary: AiProvider) {
  const stub = { select: { wordId: true } } as const;
  return { aiOpenai: primary === "openai" ? true : stub, aiDeepseek: primary === "deepseek" ? true : stub };
}
/** `aiDetailSelect` 取回来的形状：选中那家是整行，其余是主键存根 */
export type AiRowOrStub = WordAiRow | { wordId: string };
export type AiDetailRow = WordAiRelations<AiRowOrStub>;
/** 有本词资料的厂商（按 AI_PROVIDERS 顺序） */
export const aiProvidersWithData = (w: AiDetailRow): AiProvider[] => AI_PROVIDERS.filter((p) => w[REL[p]]);
/** 取某一家的行（可能是存根） */
export const aiRowOf = (w: AiDetailRow, p: AiProvider): AiRowOrStub | null | undefined => w[REL[p]];
/** 是不是整行（存根只有 word_id） */
export const isFullAiRow = (row: AiRowOrStub | null | undefined): row is WordAiRow => !!row && "core" in row;
/** 学习卡正面只要音标与例句：整行 include 会把义项 / 搭配 / 词源等 JSONB 一起拉出来，一次队列可达数 MB（审计 F019） */
export const AI_CARD_SELECT = {
  aiOpenai: { select: { phoneticUs: true, phoneticUk: true, examples: true } },
  aiDeepseek: { select: { phoneticUs: true, phoneticUk: true, examples: true } },
} as const;

/** 按用户偏好挑一家的数据；没有就 null */
export function pickAi<T>(w: WordAiRelations<T>, pref: AiPreference): { provider: AiProvider; row: T } | null {
  const order: AiProvider[] = pref === "auto" ? [...AI_PROVIDERS] : [pref];
  for (const p of order) { const row = w[REL[p]]; if (row) return { provider: p, row }; }
  return null;
}
