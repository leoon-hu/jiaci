import { prisma } from "./db";

/**
 * 系统配置（需求 3.6）：所有运行参数从 system_config 表读取，
 * 代码内提供默认值，表缺失时使用默认值并记录警告；读取带 60 秒缓存。
 */
export const CONFIG_DEFAULTS: Record<string, string> = {
  "site.name": "AI加词",
  "site.domain": "localhost:3000",
  "mail.from_address": "noreply@example.com",
  "mail.from_name": "AI加词",
  "otp.expire_minutes": "10",
  "otp.daily_limit": "10",
  "otp.resend_seconds": "60",
  "otp.max_attempts": "5",
  "session.days": "90",
  "ai.provider": "deepseek",
  "ai.model": "deepseek-v4-flash",
  "ai.max_tokens": "6000",
  "study.default_new_words": "20",
  "study.default_review_limit": "200",
  "study.extra_new_words": "10",
  // FSRS（需求 3.2.4）：目标记忆保持率、已掌握阈值（安排的间隔达到即已掌握）、个性化权重（JSON 数组，空 = 算法默认）
  "study.retention": "0.9",
  "study.master_interval": "60",
  "study.fsrs_params": "",
  "import.max_words": "5000",
  // 发音音频：合成引擎、四种声音的音色名、语速、并发、批量预生成例句用的声音
  "tts.provider": "edge",
  "tts.voice_us_female": "en-US-AriaNeural",
  "tts.voice_us_male": "en-US-GuyNeural",
  "tts.voice_uk_female": "en-GB-SoniaNeural",
  "tts.voice_uk_male": "en-GB-RyanNeural",
  "tts.voice_zh": "zh-CN-XiaoxiaoNeural",
  "tts.word_rate": "-10%",
  "tts.sentence_rate": "+0%",
  "tts.def_rate": "+0%",
  // Edge 同时开几路合成：6 路实测 150 词 × 3 条例句的译文（372 段）40 秒备好，3 路要 79 秒；再多怕被 Edge 限流
  "tts.concurrency": "6",
  "tts.kokoro_voice_us_female": "af_heart",
  "tts.kokoro_voice_us_male": "am_michael",
  "tts.kokoro_voice_uk_female": "bf_emma",
  "tts.kokoro_voice_uk_male": "bm_george",
  "tts.kokoro_voice_zh": "zf_xiaobei",
  "tts.batch_voices": "us_female",
  // 按需合成的三道闸门：磁盘至少留多少 MB 才继续合成、每个用户每分钟 / 每天最多合成多少段（审计 NO01）。
  // 跑步模式准备一轮要现合成的例句译文可达几百段（150 词 × 3 条 = 450，换成非批量音色的例句再翻倍），
  // 2026-09-17 之前每分钟 60 / 每天 500 的上限会让准备卡一分钟、后半段直接被跳过。每分钟上限只防失控的客户端，
  // 一次准备要多少段都不该被它卡住，真正的吞吐由合成并发（tts.concurrency）决定
  "tts.min_free_mb": "2048",
  "tts.synth_per_minute": "1000",
  "tts.daily_synth_per_user": "5000",
  // 条款版本：正文有实质修改时 +1，用户的 terms_version 与它不一致会在应用内提示重新确认（审计 F171）
  "legal.version": "1",
  "legal.privacy_policy": "",
  "legal.terms": "",
};

const CACHE_MS = 60_000;
let cache: { at: number; values: Record<string, string> } | null = null;
let warnedMissing = new Set<string>();

async function loadAll(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache.values;
  try {
    const rows = await prisma.systemConfig.findMany();
    const values: Record<string, string> = {};
    for (const r of rows) values[r.key] = r.value;
    cache = { at: now, values };
    return values;
  } catch (e) {
    // 读库失败不要把空表缓存 60 秒：那会让发件地址、法律正文等静默回落到代码默认值一分钟（审计 F114）
    console.warn("[config] 读取 system_config 失败，沿用上次结果 / 默认值:", (e as Error).message);
    return cache?.values ?? {};
  }
}

export async function getConfig(key: string): Promise<string> {
  const values = await loadAll();
  if (key in values) return values[key];
  if (!(key in CONFIG_DEFAULTS)) throw new Error(`未知配置项: ${key}`);
  if (!warnedMissing.has(key)) {
    warnedMissing.add(key);
    console.warn(`[config] system_config 缺少 ${key}，使用默认值 "${CONFIG_DEFAULTS[key]}"`);
  }
  return CONFIG_DEFAULTS[key];
}

/** 整数配置：不是 ≥ min 的整数就退回代码默认值——0 / 负数会让上限、天数之类的参数把功能整个关掉（审计 F112） */
export async function getConfigInt(key: string, min = 1): Promise<number> {
  const raw = await getConfig(key);
  const v = parseInt(raw, 10);
  if (Number.isFinite(v) && v >= min) return v;
  console.warn(`[config] ${key} = "${raw}" 不是不小于 ${min} 的整数，改用默认值 ${CONFIG_DEFAULTS[key]}`);
  return parseInt(CONFIG_DEFAULTS[key], 10);
}

/** 测试或运营脚本改库后可主动清缓存 */
export function clearConfigCache() {
  cache = null;
  warnedMissing = new Set();
}
