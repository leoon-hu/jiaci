/**
 * 发音音频的文本规则。浏览器与 Node 共用，不依赖 WebCrypto——
 * 手机经 http://<局域网 IP> 访问时不是安全上下文，crypto.subtle 不可用，所以 SHA-1 用纯 JS 实现。
 * 音频只按文本内容对应：单词按拼写、例句按规范化文本的哈希；访问 URL 与磁盘路径都由这里推出，接口不用下发。
 */
export const VOICE_KEYS = ["us_female", "us_male", "uk_female", "uk_male"] as const;
/** 逻辑声音键 = 口音 × 声音；实际音色名由 system_config 的 tts.voice_* 决定 */
export type VoiceKey = (typeof VOICE_KEYS)[number];
export const isVoiceKey = (s: string): s is VoiceKey => (VOICE_KEYS as readonly string[]).includes(s);
export const voiceKeyOf = (accent: "us" | "uk", voice: "female" | "male"): VoiceKey => `${accent}_${voice}`;
export const VOICE_KEY_LABEL: Record<VoiceKey, string> = { us_female: "美音女声", us_male: "美音男声", uk_female: "英音女声", uk_male: "英音男声" };

export type AudioKind = "word" | "sentence" | "definition";

/** 规范化：去首尾空白、合并连续空白；哈希与文件都以此为准 */
export const normalizeText = (s: string) => s.trim().replace(/\s+/g, " ");

/** 纯 JS SHA-1（十六进制小写），输入按 UTF-8 编码；与 Node 的 crypto.createHash("sha1") 结果一致（tests/tts.test.ts 锁定） */
export function sha1Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const ml = bytes.length;
  const total = Math.ceil((ml + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = ml * 8;
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** 文本哈希：规范化后的 SHA-1，audio_text 主键 */
export const textHash = (text: string) => sha1Hex(normalizeText(text));

/** 单词文件名：小写，短语空格换下划线（give_up） */
export const wordFile = (spelling: string) => normalizeText(spelling).toLowerCase().replace(/ /g, "_");
export const spellingOfFile = (file: string) => file.replace(/_/g, " ");

/** 路径里的类型段：例句 sent、中文释义 def（单词段直接写 word） */
const SEG: Record<Exclude<AudioKind, "word">, string> = { sentence: "sent", definition: "def" };

/** 访问路径（/api/audio/ 之后）：word/{voice}/{file}.mp3，或 sent|def/{voice}/{hash}.mp3 */
export function clipUrlPath(kind: AudioKind, voice: string, text: string): string {
  return kind === "word" ? `word/${voice}/${encodeURIComponent(wordFile(text))}.mp3` : `${SEG[kind]}/${voice}/${textHash(text)}.mp3`;
}

/** 磁盘相对路径（AUDIO_DIR 之下）：单词按首字母分目录，例句与释义按哈希前两位分目录 */
export function clipRelPath(kind: AudioKind, voice: string, text: string): string {
  if (kind === "word") { const f = wordFile(text); return `word/${voice}/${f[0] ?? "_"}/${f}.mp3`; }
  const h = textHash(text);
  return `${SEG[kind]}/${voice}/${h.slice(0, 2)}/${h}.mp3`;
}

const VOICE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,60}$/;
const SPELLING_RE = /^[a-z][a-z'.-]*( [a-z'.-]+)*$/;
/** 解析访问路径的三段（kind / voice / 文件名）；不合法返回 null。单词段返回拼写（下划线还原为空格），例句与释义段返回哈希 */
export function parseAudioPath(segments: string[]): { kind: AudioKind; voice: string; name: string } | null {
  if (segments.length !== 3) return null;
  const [k, voice, file] = segments;
  const kind: AudioKind | null = k === "word" ? "word" : k === "sent" ? "sentence" : k === "def" ? "definition" : null;
  if (!kind || !VOICE_RE.test(voice) || !file.endsWith(".mp3")) return null;
  const name = file.slice(0, -4);
  if (kind !== "word") return /^[0-9a-f]{40}$/.test(name) ? { kind, voice, name } : null;
  let spelling: string;
  try { spelling = spellingOfFile(decodeURIComponent(name)); } catch { return null; }
  // 上限与 words.ts 的 MAX_WORD_LEN 一致：卡在 40 会让 41–60 字符的合法短语生成了文件却取不到（审计 F076）
  return spelling.length <= 60 && SPELLING_RE.test(spelling) ? { kind, voice, name: spelling } : null;
}
