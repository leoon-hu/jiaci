import { PrismaClient } from "@prisma/client";

/**
 * 种子数据：只写 system_config 初始值（需求文档 3.6 / 第 6 节）。
 * 运行：npm run db:seed（可重复执行；已有 key 只更新说明，不覆盖值）
 * 词条与内置词库不在这里生成：词典数据用 scripts/dict.ts 导入，内置词库由 scripts/wordbooks.ts 构建。
 */
const prisma = new PrismaClient();

const CONFIG: Array<[string, string, string]> = [
  ["site.name", "AI加词", "站点名称"],
  ["site.domain", "localhost:3000", "站点域名，用于生成链接"],
  ["mail.from_address", "noreply@example.com", "发件邮箱"],
  ["mail.from_name", "AI加词", "发件人名称"],
  ["otp.expire_minutes", "10", "验证码有效期（分钟）"],
  ["otp.daily_limit", "10", "单邮箱每日发送上限"],
  ["otp.resend_seconds", "60", "同一邮箱重发间隔（秒）"],
  ["otp.max_attempts", "5", "验证码连续错误次数上限"],
  ["session.days", "90", "登录凭证有效天数，活跃自动续期"],
  ["ai.provider", "deepseek", "填充脚本默认厂商：deepseek / openai（也可用 --provider 指定）"],
  ["ai.model", "deepseek-v4-flash", "填充脚本默认模型名（也可用 --model 指定）；旧别名 deepseek-chat 已不在官方模型列表里"],
  ["ai.max_tokens", "6000", "AI 填充词条字段时的最大输出 tokens（填充脚本用；填小了会触发「输出被 max_tokens 截断」）"],
  ["study.default_new_words", "20", "新用户默认每日新词量"],
  ["study.default_review_limit", "200", "新用户默认每日复习上限"],
  ["study.extra_new_words", "10", "「再学一组」的新词数"],
  ["study.retention", "0.9", "FSRS 目标记忆保持率（0–1）：调低复习更少、调高记得更牢"],
  ["study.master_interval", "60", "安排的复习间隔达到多少天即自动转为已掌握"],
  ["study.fsrs_params", "", "FSRS 个性化权重（JSON 数组，官方优化器拟合后填入）；空 = 用算法默认参数"],
  ["import.max_words", "5000", "单次导入词数上限"],
  ["tts.provider", "edge", "发音合成引擎：edge（Edge-TTS，免费）/ kokoro（自托管，需环境变量 KOKORO_BASE_URL）"],
  ["tts.voice_us_female", "en-US-AriaNeural", "美音女声音色（Edge）"],
  ["tts.voice_us_male", "en-US-GuyNeural", "美音男声音色（Edge）"],
  ["tts.voice_uk_female", "en-GB-SoniaNeural", "英音女声音色（Edge）"],
  ["tts.voice_uk_male", "en-GB-RyanNeural", "英音男声音色（Edge）"],
  ["tts.voice_zh", "zh-CN-XiaoxiaoNeural", "中文音色（Edge）：列表点词时朗读中文释义用"],
  ["tts.word_rate", "-10%", "单词语速（SSML 相对值，略慢便于听清）"],
  ["tts.sentence_rate", "+0%", "例句语速（SSML 相对值）"],
  ["tts.def_rate", "+0%", "中文释义语速（SSML 相对值）"],
  ["tts.concurrency", "3", "合成并发上限（批量脚本与按需合成共用）"],
  ["tts.kokoro_voice_us_female", "af_heart", "备选引擎 Kokoro 的美音女声"],
  ["tts.kokoro_voice_us_male", "am_michael", "备选引擎 Kokoro 的美音男声"],
  ["tts.kokoro_voice_uk_female", "bf_emma", "备选引擎 Kokoro 的英音女声"],
  ["tts.kokoro_voice_uk_male", "bm_george", "备选引擎 Kokoro 的英音男声"],
  ["tts.kokoro_voice_zh", "zf_xiaobei", "备选引擎 Kokoro 的中文音色"],
  ["tts.batch_voices", "us_female", "批量预生成例句的声音（逗号分隔：us_female / us_male / uk_female / uk_male）；单词四种都生成，其余声音的例句按需合成"],
  ["tts.min_free_mb", "2048", "按需合成前要求的磁盘剩余空间（MB），低于它就不再合成，前端退到 Web Speech"],
  ["tts.daily_synth_per_user", "500", "每个用户每天按需合成的段数上限"],
  ["legal.version", "1", "条款版本；正文有实质修改时 +1，用户会在应用内被提示重新确认"],
  ["legal.privacy_policy", "", "隐私政策正文（Markdown）"],
  ["legal.terms", "", "服务条款正文（Markdown）"],
];

async function main() {
  for (const [key, value, description] of CONFIG) {
    await prisma.systemConfig.upsert({ where: { key }, update: { description }, create: { key, value, description } });
  }
  console.log(`system_config: ${CONFIG.length} 项`);
}

main().finally(() => prisma.$disconnect());
