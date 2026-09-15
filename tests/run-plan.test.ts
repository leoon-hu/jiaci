import { describe, it, expect } from "vitest";
import { buildRunPlan, clampGap, clampRepeat, cueIndexAt, FRAME_BYTES, FRAME_SECONDS, frameCount, isRunClip, SILENCE_FRAME, silenceFrames } from "../src/lib/run-plan";

/** 一个 Edge 片段的开头：帧头 ff f3 64 c4（MPEG-2 Layer III、48 kbps、24 kHz、单声道） */
const edgeHead = (extra: number[] = []) => { const b = new Uint8Array(FRAME_BYTES * 3); b.set([0xff, 0xf3, 0x64, 0xc4, ...extra]); return b; };
const sec = (frames: number) => frames * FRAME_SECONDS;

describe("帧常量与静音帧", () => {
  it("24 kHz / 48 kbps 单声道：每帧 144 字节、24 ms", () => {
    expect(FRAME_BYTES).toBe(144);
    expect(FRAME_SECONDS).toBeCloseTo(0.024, 9);
    expect(frameCount(144 * 10 + 100)).toBe(10);
    expect(silenceFrames(1)).toBe(42);
    expect(silenceFrames(0.5)).toBe(21);
    expect(silenceFrames(0)).toBe(0);
  });
  it("静音帧本身通过格式守卫，且 main_data_begin = 0", () => {
    expect(SILENCE_FRAME.length).toBe(FRAME_BYTES);
    expect(isRunClip(SILENCE_FRAME)).toBe(true);
    expect(SILENCE_FRAME[4]).toBe(0);
  });
});

describe("isRunClip：只认同一种格式", () => {
  it("Edge 片段合格；CRC / padding / 原版位不影响", () => {
    expect(isRunClip(edgeHead())).toBe(true);
    const crc = edgeHead(); crc[1] = 0xf2; expect(isRunClip(crc)).toBe(true);
    const pad = edgeHead(); pad[2] = 0x66; expect(isRunClip(pad)).toBe(true);
    const orig = edgeHead(); orig[3] = 0xc0; expect(isRunClip(orig)).toBe(true);
  });
  it("采样率 / 码率 / 声道 / 版本不同的都不合格，太短的也不合格", () => {
    const stereo = edgeHead(); stereo[3] = 0x04; expect(isRunClip(stereo)).toBe(false);
    const mpeg1 = edgeHead(); mpeg1[1] = 0xfb; expect(isRunClip(mpeg1)).toBe(false);
    const kbps128 = edgeHead(); kbps128[2] = 0x94; expect(isRunClip(kbps128)).toBe(false);
    const hz22 = edgeHead(); hz22[2] = 0x60; expect(isRunClip(hz22)).toBe(false);
    expect(isRunClip(new Uint8Array([0xff, 0xf3, 0x64, 0xc4]))).toBe(false);
    expect(isRunClip(new Uint8Array([0x49, 0x44, 0x33, 0x04, ...new Array(200).fill(0)]))).toBe(false); // ID3 头
  });
});

describe("buildRunPlan", () => {
  const words = [
    { clips: { word: 144 * 40, definition: 144 * 100, sentence: 144 * 200 } },
    { clips: { word: 144 * 50 } },
    { clips: {} },
    { clips: { definition: 144 * 30 } },
  ];

  it("默认：单词两遍（间 0.5 s）→ 0.8 s → 释义 → 0.8 s → 例句 → gap；缺的段跳过；一段都没有的词跳过", () => {
    const plan = buildRunPlan(words, { repeat: 2, def: true, sentence: true, gap: 2 });
    expect(plan.skipped).toEqual([2]);
    expect(plan.cues.map((c) => c.word)).toEqual([0, 1, 3]);
    const w0 = [40, silenceFrames(0.5), 40, silenceFrames(0.8), 100, silenceFrames(0.8), 200, silenceFrames(2)];
    const w1 = [50, silenceFrames(0.5), 50, silenceFrames(2)];
    const w3 = [30, silenceFrames(2)];
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(plan.cues[0]).toEqual({ word: 0, start: 0, end: sec(sum(w0)) });
    expect(plan.cues[1]).toEqual({ word: 1, start: sec(sum(w0)), end: sec(sum(w0) + sum(w1)) });
    expect(plan.cues[2]).toEqual({ word: 3, start: sec(sum(w0) + sum(w1)), end: sec(sum(w0) + sum(w1) + sum(w3)) });
    expect(plan.duration).toBe(plan.cues[2].end);
    // parts 顺序
    expect(plan.parts.slice(0, 8)).toEqual([
      { type: "clip", word: 0, kind: "word" }, { type: "silence", frames: silenceFrames(0.5) },
      { type: "clip", word: 0, kind: "word" }, { type: "silence", frames: silenceFrames(0.8) },
      { type: "clip", word: 0, kind: "definition" }, { type: "silence", frames: silenceFrames(0.8) },
      { type: "clip", word: 0, kind: "sentence" }, { type: "silence", frames: silenceFrames(2) },
    ]);
    // 只有释义的词：没有前置间隔
    expect(plan.parts.slice(-2)).toEqual([{ type: "clip", word: 3, kind: "definition" }, { type: "silence", frames: silenceFrames(2) }]);
  });

  it("关掉释义与例句：只剩单词；repeat 1 没有遍间静音", () => {
    const plan = buildRunPlan(words, { repeat: 1, def: false, sentence: false, gap: 3 });
    expect(plan.skipped).toEqual([2, 3]);
    expect(plan.parts).toEqual([
      { type: "clip", word: 0, kind: "word" }, { type: "silence", frames: silenceFrames(3) },
      { type: "clip", word: 1, kind: "word" }, { type: "silence", frames: silenceFrames(3) },
    ]);
    expect(plan.duration).toBeCloseTo(sec(40 + 50 + 2 * silenceFrames(3)), 9);
  });

  it("参数越界被夹住；不足一帧的片段当没有", () => {
    expect(clampRepeat(0)).toBe(1); expect(clampRepeat(9)).toBe(3); expect(clampRepeat(NaN)).toBe(1);
    expect(clampGap(0)).toBe(1); expect(clampGap(7)).toBe(5);
    const plan = buildRunPlan([{ clips: { word: 100 } }], { repeat: 5, def: true, sentence: true, gap: 0 });
    expect(plan.skipped).toEqual([0]);
    expect(plan.parts).toEqual([]);
    expect(plan.duration).toBe(0);
  });

  it("空列表", () => {
    const plan = buildRunPlan([], { repeat: 2, def: true, sentence: true, gap: 2 });
    expect(plan).toEqual({ parts: [], cues: [], duration: 0, skipped: [] });
  });
});

describe("cueIndexAt", () => {
  const cues = [{ word: 0, start: 0, end: 5 }, { word: 2, start: 5, end: 9 }, { word: 3, start: 9, end: 20 }];
  it("落在哪个 cue；边界与越界", () => {
    expect(cueIndexAt(cues, 0)).toBe(0);
    expect(cueIndexAt(cues, 4.999)).toBe(0);
    expect(cueIndexAt(cues, 5)).toBe(1);
    expect(cueIndexAt(cues, 8.5)).toBe(1);
    expect(cueIndexAt(cues, 9)).toBe(2);
    expect(cueIndexAt(cues, 999)).toBe(2);
    expect(cueIndexAt(cues, -1)).toBe(0);
    expect(cueIndexAt([], 3)).toBe(-1);
  });
});
