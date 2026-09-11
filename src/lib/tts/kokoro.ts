/**
 * 备选合成引擎：自托管 Kokoro-82M（Kokoro-FastAPI Docker 镜像，OpenAI 兼容的 /v1/audio/speech）。
 * 环境变量 KOKORO_BASE_URL 指向服务地址；system_config.tts.provider = kokoro 时启用，音色名用 tts.kokoro_voice_*。
 */
export async function synthesizeKokoro(text: string, voice: string, rate: string): Promise<Buffer> {
  const base = process.env.KOKORO_BASE_URL;
  if (!base) throw new Error("tts.provider 是 kokoro，但没有配置环境变量 KOKORO_BASE_URL");
  // SSML 的相对语速（-10%）换算成倍速
  const pct = parseFloat(rate) || 0;
  const speed = Math.min(2, Math.max(0.5, 1 + pct / 100));
  const res = await fetch(`${base.replace(/\/$/, "")}/v1/audio/speech`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "kokoro", voice, input: text, response_format: "mp3", speed }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Kokoro ${res.status}：${(await res.text()).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}
