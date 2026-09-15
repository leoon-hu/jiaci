import { cache } from "react";
import { z } from "zod";
import { prisma } from "./db";
import { getConfigInt } from "./config";

/** 用户设置（需求 3.5），存 user_profile.settings（JSON） */
export const SettingsSchema = z.object({
  newWords: z.number().int().min(5).max(200),
  reviewLimit: z.number().int().min(20).max(1000),
  order: z.enum(["review-first", "mixed"]),
  newOrder: z.enum(["book", "random"]),
  accent: z.enum(["us", "uk"]),
  /** 声音：女声 / 男声，与口音组合成四种声音（发音方案 4.1） */
  voice: z.enum(["female", "male"]),
  exSpeaker: z.enum(["right", "left"]),
  autoPlay: z.boolean(),
  autoReadDetail: z.boolean(),
  theme: z.enum(["system", "light", "dark"]),
  listMode: z.enum(["both", "en", "zh"]),
  /** 词条资料来源：auto 按厂商顺序取第一家有资料的；指定厂商没有资料时用词典兜底 */
  aiProvider: z.enum(["auto", "openai", "deepseek"]),
  /** 跑步模式（需求 3.2.6）：每个单词读几遍、读不读释义 / 例句、词间间隔（秒）、语速；在跑步页改，设置页不显示 */
  runRepeat: z.number().int().min(1).max(3),
  runDef: z.boolean(),
  runSentence: z.boolean(),
  runGap: z.number().int().min(1).max(5),
  runSpeed: z.number().min(0.8).max(1.2),
});
export type UserSettings = z.infer<typeof SettingsSchema>;

export async function defaultSettings(): Promise<UserSettings> {
  return {
    newWords: await getConfigInt("study.default_new_words"),
    reviewLimit: await getConfigInt("study.default_review_limit"),
    order: "review-first", newOrder: "book", accent: "us", voice: "female", exSpeaker: "right",
    autoPlay: true, autoReadDetail: true, theme: "system", listMode: "both", aiProvider: "auto",
    runRepeat: 2, runDef: true, runSentence: true, runGap: 2, runSpeed: 1,
  };
}

/**
 * 请求级缓存：cache() 对同一个请求返回同一个对象（请求作用域外每次返回新对象，等于不缓存）。
 * 会话校验时已经把 user 整行读出来了，`primeSettings` 把设置存进来，`getSettings` 就不必再查库——
 * 一次 /api/study/today 原来要查两遍 user（会话一次、设置一次）。
 */
const settingsStore = cache((): { userId?: string; raw?: Record<string, unknown> } => ({}));

/** 会话校验后调用：把已经读到的用户设置放进本次请求的缓存 */
export function primeSettings(userId: string, raw: Record<string, unknown>) {
  const st = settingsStore();
  st.userId = userId;
  st.raw = raw;
}

export async function getSettings(userId: string): Promise<UserSettings> {
  const st = settingsStore();
  const raw = st.userId === userId && st.raw
    ? st.raw
    : (((await prisma.user.findUnique({ where: { id: userId }, select: { settings: true } }))?.settings ?? {}) as Record<string, unknown>);
  const base = await defaultSettings();
  // 逐字段解析：整份 safeParse 时一个字段不合法（例如配置默认值超出范围）就会把用户其它设置全丢掉（审计 F154）
  const out: Record<string, unknown> = { ...base };
  for (const [k, schema] of Object.entries(SettingsSchema.shape)) {
    if (!(k in raw)) continue;
    const r = schema.safeParse(raw[k]);
    if (r.success) out[k] = r.data;
  }
  return out as UserSettings;
}

export async function saveSettings(userId: string, patch: unknown): Promise<UserSettings> {
  const p = SettingsSchema.partial().parse(patch);
  // 在数据库里合并，不要读出整份再写回：两个控件几乎同时保存时后写的会把先写的字段覆盖回旧值（审计 F177）
  await prisma.$executeRaw`UPDATE user_profile SET settings = COALESCE(settings, '{}'::jsonb) || ${JSON.stringify(p)}::jsonb WHERE id = ${userId}`;
  // 本次请求缓存的是保存之前的设置，作废掉，下面这次 getSettings 要读库里合并后的结果
  const st = settingsStore();
  if (st.userId === userId) { st.userId = undefined; st.raw = undefined; }
  return getSettings(userId);
}
