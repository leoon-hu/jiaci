/**
 * 跑步模式（需求 3.2.6）的音频拼接计划：纯函数，浏览器与 Node 共用，tests/run-plan.test.ts 锁定。
 *
 * 熄屏后浏览器只保留正在播放的 <audio> 元素——不能靠定时器串片段，词与词之间的间隔也不能是「暂停」。
 * 所以今天的内容在开跑前拼成一整段 MP3，间隔是拼进去的静音帧。能这么拼的事实基础（2026-09-15 抽样验证）：
 * Edge-TTS 输出 24 kHz / 48 kbps 单声道 MP3（MPEG-2 Layer III），文件是裸帧、没有 ID3 / Xing 头，
 * 帧头一律 ff f3 64 c4，每帧固定 144 字节 = 24 ms（72 × 48000 / 24000 = 144，永远不需要 padding），
 * 每个文件第一帧 main_data_begin = 0（不引用前一帧的比特池）。于是片段按字节直接拼接就是合法的连续流，
 * 时长按字节数精确到帧，不用解码。
 */

/** 一帧的字节数与时长（MPEG-2 Layer III，24 kHz：每帧 576 个采样） */
export const FRAME_BYTES = 144;
export const FRAME_SECONDS = 576 / 24000;

/**
 * 一帧静音：LAME 对数字静音编出的帧——帧头 ff f3 64 c4 + 9 字节边信息（main_data_begin = 0、part2_3_length = 0），
 * 其余字节为零。重复 N 帧就是 N × 24 ms 的静音。
 */
export const SILENCE_FRAME: Uint8Array = (() => {
  const f = new Uint8Array(FRAME_BYTES);
  f.set([0xff, 0xf3, 0x64, 0xc4, 0x00, 0x00, 0x00, 0x03, 0x48]);
  return f;
})();

/**
 * 片段是不是与静音帧同一种格式：MPEG-2、Layer III、48 kbps、24 kHz、单声道。
 * 掩掉 CRC、padding、private、版权 / 原版、强调这些不影响拼接的位。格式不同的片段（换了合成引擎）
 * 不能拼进去——流从那里开始就解不出来了，宁可跳过这一段。
 */
export function isRunClip(bytes: Uint8Array): boolean {
  return bytes.length >= FRAME_BYTES
    && bytes[0] === 0xff && (bytes[1] & 0xfe) === 0xf2
    && (bytes[2] & 0xfc) === 0x64 && (bytes[3] & 0xc0) === 0xc0;
}

export const frameCount = (bytes: number) => Math.floor(bytes / FRAME_BYTES);
export const silenceFrames = (seconds: number) => Math.max(0, Math.round(seconds / FRAME_SECONDS));

export type RunClipKind = "word" | "definition" | "sentence";
/** 一个词三段片段各自的字节数；没下载到 / 格式不对的段不填 */
export type RunPlanWord = { clips: Partial<Record<RunClipKind, number>> };
export type RunPlanOptions = { repeat: number; def: boolean; sentence: boolean; gap: number };
export type RunPart = { type: "clip"; word: number; kind: RunClipKind } | { type: "silence"; frames: number };
/** 一个词在整段音频里的起止（秒）；end 含它后面的间隔，所以 cue 首尾相接铺满整段 */
export type RunCue = { word: number; start: number; end: number };
export type RunPlan = { parts: RunPart[]; cues: RunCue[]; duration: number; skipped: number[] };

/** 固定的段内间隔（秒）：单词两遍之间、单词到释义、释义到例句 */
const REPEAT_GAP = 0.5;
const DEF_GAP = 0.8;
const SENTENCE_GAP = 0.8;

export const clampRepeat = (n: number) => Math.min(3, Math.max(1, Math.round(n) || 1));
export const clampGap = (s: number) => Math.min(5, Math.max(1, Math.round(s) || 1));

/**
 * 每个词：单词 × repeat（遍间 0.5 s）→ 释义（可关）→ 例句（可关）→ 停 gap 秒 → 下一个词。
 * 一段都没有的词跳过（记在 skipped）。帧数用整数累加，避免浮点误差让 cue 与实际错位。
 */
export function buildRunPlan(words: RunPlanWord[], opts: RunPlanOptions): RunPlan {
  const repeat = clampRepeat(opts.repeat);
  const gapFrames = silenceFrames(clampGap(opts.gap));
  const parts: RunPart[] = [];
  const cues: RunCue[] = [];
  const skipped: number[] = [];
  let frames = 0;
  const has = (b: number | undefined): b is number => b !== undefined && frameCount(b) > 0;
  words.forEach((w, i) => {
    const seq: Array<RunClipKind | number> = [];
    if (has(w.clips.word)) for (let r = 0; r < repeat; r++) { if (r) seq.push(REPEAT_GAP); seq.push("word"); }
    if (opts.def && has(w.clips.definition)) { if (seq.length) seq.push(DEF_GAP); seq.push("definition"); }
    if (opts.sentence && has(w.clips.sentence)) { if (seq.length) seq.push(SENTENCE_GAP); seq.push("sentence"); }
    if (!seq.length) { skipped.push(i); return; }
    const start = frames;
    for (const s of seq) {
      if (typeof s === "number") { const n = silenceFrames(s); parts.push({ type: "silence", frames: n }); frames += n; }
      else { parts.push({ type: "clip", word: i, kind: s }); frames += frameCount(w.clips[s]!); }
    }
    parts.push({ type: "silence", frames: gapFrames });
    frames += gapFrames;
    cues.push({ word: i, start: start * FRAME_SECONDS, end: frames * FRAME_SECONDS });
  });
  return { parts, cues, duration: frames * FRAME_SECONDS, skipped };
}

/** 时间 t 落在第几个 cue（下标，不是词序号）；越界取两端 */
export function cueIndexAt(cues: RunCue[], t: number): number {
  if (!cues.length) return -1;
  let lo = 0, hi = cues.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cues[mid].start <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}
