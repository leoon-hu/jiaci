import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { clipRelPath, clipUrlPath, normalizeText, parseAudioPath, sha1Hex, textHash, voiceKeyOf, wordFile } from "../src/lib/tts/text";

const node = (s: string) => createHash("sha1").update(s, "utf8").digest("hex");

describe("sha1Hex（纯 JS）", () => {
  it("与 Node crypto 一致，覆盖分块边界与多字节字符", () => {
    const cases = ["", "a", "abc", "abandon", "They had to abandon the car and walk the rest of the way.", "中文例句：放弃 & <标签> 'quote' \"double\"", "x".repeat(55), "y".repeat(56), "z".repeat(63), "w".repeat(64), "v".repeat(65), "u".repeat(200), "emoji 🎧 test", "𝄞 astral plane"];
    for (const s of cases) expect(sha1Hex(s), s).toBe(node(s));
  });
  it("固定值", () => expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d"));
});

describe("文本与路径规则", () => {
  it("规范化后再哈希，空白差异不影响", () => {
    expect(normalizeText("  They  had\tto  abandon it. ")).toBe("They had to abandon it.");
    expect(textHash("  They  had to abandon it. ")).toBe(textHash("They had to abandon it."));
  });
  it("单词文件名与路径", () => {
    expect(wordFile("Give  Up")).toBe("give_up");
    expect(clipRelPath("word", "en-US-AriaNeural", "give up")).toBe("word/en-US-AriaNeural/g/give_up.mp3");
    expect(clipUrlPath("word", "en-US-AriaNeural", "give up")).toBe("word/en-US-AriaNeural/give_up.mp3");
  });
  it("例句路径按哈希分目录", () => {
    const h = textHash("They had to abandon the car.");
    expect(clipRelPath("sentence", "en-US-AriaNeural", "They had to abandon the car.")).toBe(`sent/en-US-AriaNeural/${h.slice(0, 2)}/${h}.mp3`);
    expect(clipUrlPath("sentence", "en-US-AriaNeural", "They had to abandon the car.")).toBe(`sent/en-US-AriaNeural/${h}.mp3`);
  });

  it("中文释义：走 def 段，与例句同样按哈希分目录", () => {
    const d = textHash("放弃；抛弃");
    expect(clipRelPath("definition", "zh-CN-XiaoxiaoNeural", "放弃；抛弃")).toBe(`def/zh-CN-XiaoxiaoNeural/${d.slice(0, 2)}/${d}.mp3`);
    expect(clipUrlPath("definition", "zh-CN-XiaoxiaoNeural", "放弃；抛弃")).toBe(`def/zh-CN-XiaoxiaoNeural/${d}.mp3`);
  });
  it("声音键", () => { expect(voiceKeyOf("uk", "male")).toBe("uk_male"); expect(voiceKeyOf("us", "female")).toBe("us_female"); });
});

describe("parseAudioPath", () => {
  const h = "a".repeat(40);
  it("单词：下划线还原为空格", () => expect(parseAudioPath(["word", "en-US-AriaNeural", "give_up.mp3"])).toEqual({ kind: "word", voice: "en-US-AriaNeural", name: "give up" }));
  it("例句：40 位十六进制哈希", () => expect(parseAudioPath(["sent", "en-GB-RyanNeural", `${h}.mp3`])).toEqual({ kind: "sentence", voice: "en-GB-RyanNeural", name: h }));
  it("释义：def 段同样只认 40 位哈希", () => {
    expect(parseAudioPath(["def", "zh-CN-XiaoxiaoNeural", `${h}.mp3`])).toEqual({ kind: "definition", voice: "zh-CN-XiaoxiaoNeural", name: h });
    expect(parseAudioPath(["def", "zh-CN-XiaoxiaoNeural", "放弃.mp3"])).toBeNull();
  });
  it("拒绝不合法的路径", () => {
    expect(parseAudioPath(["word", "en-US-AriaNeural"])).toBeNull();
    expect(parseAudioPath(["word", "en-US-AriaNeural", "abandon.wav"])).toBeNull();
    expect(parseAudioPath(["word", "../x", "abandon.mp3"])).toBeNull();
    expect(parseAudioPath(["word", "en-US-AriaNeural", "Abandon.mp3"])).toBeNull();
    expect(parseAudioPath(["word", "en-US-AriaNeural", "..%2F..%2Fetc.mp3"])).toBeNull();
    expect(parseAudioPath(["sent", "en-US-AriaNeural", "abc.mp3"])).toBeNull();
    expect(parseAudioPath(["sent", "en-US-AriaNeural", `${"G".repeat(40)}.mp3`])).toBeNull();
    expect(parseAudioPath(["other", "en-US-AriaNeural", `${h}.mp3`])).toBeNull();
  });
});
