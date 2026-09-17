import { describe, it, expect } from "vitest";
import { jobsOf, targetsOfWord } from "../src/lib/tts/batch";
import type { TtsConfig } from "../src/lib/tts";

const cfg: TtsConfig = {
  provider: "edge", voices: { us_female: "A", us_male: "B", uk_female: "C", uk_male: "D" }, defVoice: "ZH",
  wordRate: "-10%", sentenceRate: "+0%", defRate: "+0%", concurrency: 3, batchVoices: ["us_female"],
};
const examples = [{ en: "They abandoned the car.", zh: "他们把车丢下了。" }, { en: "Don't abandon hope.", zh: "别放弃希望。" }];

describe("targetsOfWord / jobsOf", () => {
  it("一词的文本：拼写、各例句英文、例句译文（标 translation）、中文释义；释义与译文都是 definition 类型", () => {
    const t = targetsOfWord("abandon", [{ examples, core: "放弃；抛弃" }]);
    expect(t).toEqual([
      { kind: "word", text: "abandon" },
      { kind: "sentence", text: "They abandoned the car." }, { kind: "definition", text: "他们把车丢下了。", translation: true },
      { kind: "sentence", text: "Don't abandon hope." }, { kind: "definition", text: "别放弃希望。", translation: true },
      { kind: "definition", text: "放弃；抛弃" },
    ]);
  });
  it("译文默认只登记不生成；translations = true 才生成，音色是中文音色", () => {
    const t = targetsOfWord("abandon", [{ examples, core: "放弃" }]);
    const plain = jobsOf(cfg, t);
    expect(plain.map((j) => `${j.kind}:${j.voice}`)).toEqual(["word:A", "word:B", "word:C", "word:D", "sentence:A", "sentence:A", "definition:ZH"]);
    const withZh = jobsOf(cfg, t, undefined, true);
    expect(withZh.filter((j) => j.translation).map((j) => j.voice)).toEqual(["ZH", "ZH"]);
    expect(withZh.length).toBe(plain.length + 2);
  });
});
