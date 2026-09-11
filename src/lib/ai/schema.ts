import { z } from "zod";

/**
 * AI 词条字段的结构契约（需求 3.4）：word_ai_<厂商> 表每个 JSONB 列对应一个 schema。
 * 读出时按契约解析（parseAi），不合规的整块当作空；填充脚本（lib/ai/fill.ts）写入前用同一套校验。
 * 条数与字数上限就以本文件的 schema 为准。
 */
const pair = z.object({ en: z.string().min(1).max(80), zh: z.string().min(1).max(60) });
const example = z.object({ en: z.string().min(1).max(220), zh: z.string().min(1).max(120) });

/** 按词性分组的义项：每个义项带中文、简单英文解释和一条小例句 */
export const AiMeaningsSchema = z.array(z.object({
  pos: z.string().max(12),
  senses: z.array(z.object({ zh: z.string().min(1).max(40), en: z.string().max(160).nullable().optional(), ex: example.nullable().optional() })).min(1).max(6),
})).min(1).max(6);
/** 分级例句：level 1 基础 / 2 自然 / 3 场景 */
export const AiExamplesSchema = z.array(example.extend({ level: z.number().int().min(1).max(3).optional() })).min(1).max(5);
export const AiCollocationsSchema = z.array(pair).max(8);
export const AiPhrasesSchema = z.array(pair).max(6);
export const AiPatternsSchema = z.array(pair.extend({ ex: example.nullable().optional() })).max(4);
export const AiSynonymsSchema = z.array(z.object({ w: z.string().min(1).max(40), m: z.string().min(1).max(50) })).max(6);
/** 反义词与近义词同样式：词 + 一句反义关系 / 用法说明 */
export const AiAntonymsSchema = z.array(z.object({ w: z.string().min(1).max(40), m: z.string().min(1).max(50) })).max(5);
export const AiConfusablesSchema = z.array(z.object({ w: z.string().min(1).max(40), m: z.string().min(1).max(60) })).max(4);
export const AiMistakesSchema = z.array(z.object({ wrong: z.string().min(1).max(80), right: z.string().min(1).max(80), note: z.string().max(50).optional().default("") })).max(4);
const familyItem = z.object({ w: z.string().min(1).max(40), pos: z.string().max(12).optional().default(""), zh: z.string().min(1).max(40) });
export const AiFamilySchema = z.array(familyItem).max(8);
export const AiCognatesSchema = z.array(familyItem).max(6);
export const AiEtymologySchema = z.object({
  origin: z.string().max(300).nullable().optional(),
  parts: z.array(z.object({ part: z.string().min(1).max(30), meaning: z.string().min(1).max(60) })).max(4).optional().default([]),
});

export type AiMeanings = z.infer<typeof AiMeaningsSchema>;
export type AiSense = AiMeanings[number]["senses"][number];
export type AiExamples = z.infer<typeof AiExamplesSchema>;
export type AiPairs = z.infer<typeof AiCollocationsSchema>;
export type AiPatterns = z.infer<typeof AiPatternsSchema>;
export type AiSynonyms = z.infer<typeof AiSynonymsSchema>;
export type AiAntonyms = z.infer<typeof AiAntonymsSchema>;
export type AiConfusables = z.infer<typeof AiConfusablesSchema>;
export type AiMistakes = z.infer<typeof AiMistakesSchema>;
export type AiFamily = z.infer<typeof AiFamilySchema>;
export type AiCognates = z.infer<typeof AiCognatesSchema>;
export type AiEtymology = z.infer<typeof AiEtymologySchema>;

/** 按契约解析一个 JSONB 列的值；空或不合规返回 null */
export function parseAi<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> | null {
  if (value == null) return null;
  const r = schema.safeParse(value);
  return r.success ? r.data : null;
}
