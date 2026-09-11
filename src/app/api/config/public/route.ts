import { handle, ok } from "@/lib/api";
import { getConfig, getConfigInt } from "@/lib/config";
import { ttsConfig } from "@/lib/tts";

export const GET = handle(async () => {
  const tts = await ttsConfig();
  return ok({
    siteName: await getConfig("site.name"),
    importMaxWords: await getConfigInt("import.max_words"),
    extraNewWords: await getConfigInt("study.extra_new_words"),
    otpResendSeconds: await getConfigInt("otp.resend_seconds"),
    otpExpireMinutes: await getConfigInt("otp.expire_minutes"),
    sessionDays: await getConfigInt("session.days"),
    masterInterval: await getConfigInt("study.master_interval"),
    /** 逻辑声音键（us_female 等）→ 当前引擎的音色名，前端据此拼音频 URL */
    ttsVoices: tts.voices,
    /** 中文音色：列表点词时朗读中文释义用，与四种英文音色分开 */
    ttsDefVoice: tts.defVoice,
  });
});
