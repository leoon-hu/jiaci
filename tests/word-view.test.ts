import { describe, it, expect } from "vitest";
import { wordView, wordCore, inflectionsOf } from "../src/lib/word-view";
import { AiMeaningsSchema, AiExamplesSchema, AiMistakesSchema, parseAi } from "../src/lib/ai/schema";

const dict = { phonetic: "ә'bændәn", translation: "vt. 放弃, 抛弃, 遗弃\nn. 放任" };
const abandon = {
  phoneticUs: "/əˈbændən/", phoneticUk: "/əˈbændən/", core: "放弃；抛弃（人、物或计划）",
  meanings: [{ pos: "v.", senses: [{ zh: "放弃，中止（计划、努力、活动）", en: "to stop doing something before it is finished", ex: { en: "They abandoned the search when it got dark.", zh: "天黑后他们中止了搜寻。" } }, { zh: "遗弃，抛弃（人、动物、地方）", en: null, ex: null }] }, { pos: "n.", senses: [{ zh: "放任，尽情（with abandon）" }] }],
  examples: [{ en: "They had to abandon the car in the snow.", zh: "他们不得不把车丢在雪地里。", level: 1 }, { en: "The project was abandoned because it cost too much.", zh: "这个项目因为花费太高被放弃了。", level: 2 }],
  collocations: [{ en: "abandon a plan", zh: "放弃计划" }],
  phrases: [{ en: "abandon ship", zh: "弃船" }],
  patterns: [{ en: "abandon sb / sth to sth", zh: "把某人 / 某物丢给（某种境地）", ex: { en: "They abandoned the town to the invaders.", zh: "他们把城镇丢给了入侵者。" } }],
  usage: "中性偏书面。", synonyms: [{ w: "give up", m: "口语最常用" }], antonyms: [{ w: "keep", m: "保留、不放手" }],
  confusables: [{ w: "abundant", m: "adj. 丰富的；只是拼写相近" }], mistakes: [{ wrong: "abandon to do sth", right: "give up doing sth", note: "abandon 后接名词" }],
  family: [{ w: "abandoned", pos: "adj.", zh: "被遗弃的" }], cognates: [{ w: "abandonment", pos: "n.", zh: "遗弃" }],
  mnemonic: "a + band + on：乐队还在台上人却走了。", etymology: { origin: "来自古法语 abandoner", parts: [{ part: "a-", meaning: "至，向" }, { part: "bandon", meaning: "控制权" }] },
};

describe("词条展示视图 wordView", () => {
  it("AI 字段齐全时按契约解析", () => {
    const v = wordView(dict, abandon, "deepseek");
    expect(v.phonetic).toEqual({ us: "/əˈbændən/", uk: "/əˈbændən/" });
    expect(v.core).toBe("放弃；抛弃（人、物或计划）");
    expect(v.coreFromAi).toBe(true);
    expect(v.meaningsSource).toBe("ai");
    expect(v.meanings[0].senses[0].ex?.en).toContain("abandoned");
    expect(v.examples).toHaveLength(2);
    expect(v.patterns[0].ex?.zh).toContain("入侵者");
    expect(v.mistakes[0].note).toBe("abandon 后接名词");
    expect(v.cognates[0].pos).toBe("n.");
    expect(v.etymology?.parts).toHaveLength(2);
    expect(v.hasAi).toBe(true);
    expect(v.provider).toBe("deepseek");
  });
  it("没有 AI 字段时用词典兜底：音标、主释义、只有中文的释义块，其余为空", () => {
    const v = wordView({ phonetic: "'ketl", translation: "n. 茶壶, 罐\n[化] 釜体釜; 锅" }, null, "openai");
    expect(v.phonetic).toEqual({ us: "/'ketl/", uk: "/'ketl/" });
    expect(v.core).toBe("n. 茶壶, 罐");
    expect(v.coreFromAi).toBe(false);
    expect(v.meaningsSource).toBe("dict");
    expect(v.meanings).toEqual([{ pos: "n.", senses: [{ zh: "茶壶, 罐" }] }]);
    expect(v.examples).toEqual([]); expect(v.collocations).toEqual([]); expect(v.mnemonic).toBeNull(); expect(v.etymology).toBeNull();
    expect(v.hasAi).toBe(false); expect(v.provider).toBeNull();
    expect(wordView({ phonetic: null, translation: null }, null).meaningsSource).toBe("none");
  });
  it("不合规的 JSON 整块当作空，不影响其它字段", () => {
    const v = wordView(dict, { ...abandon, examples: [{ en: "", zh: "x" }], meanings: "oops" });
    expect(v.examples).toEqual([]);
    expect(v.meaningsSource).toBe("dict");
    expect(v.collocations).toHaveLength(1);
  });
  it("词形变化来自词典 exchange，同一形式合并标签，变形词条列原形", () => {
    expect(inflectionsOf("abandon", "d:abandoned/p:abandoned/i:abandoning/3:abandons")).toEqual([{ w: "abandoned", label: "过去式 / 过去分词" }, { w: "abandoning", label: "现在分词" }, { w: "abandons", label: "第三人称单数" }]);
    expect(inflectionsOf("abandoned", "0:abandon/1:dp/p:abandoned/d:abandoned")).toEqual([{ w: "abandon", label: "原形" }]);
    expect(inflectionsOf("big", "t:biggest/r:bigger")).toEqual([{ w: "bigger", label: "比较级" }, { w: "biggest", label: "最高级" }]);
    expect(inflectionsOf("give up", null)).toEqual([]);
    expect(wordView({ spelling: "study", exchange: "s:studies/3:studies", translation: "v. 学习" }, null).inflections).toEqual([{ w: "studies", label: "复数 / 第三人称单数" }]);
  });
  it("主释义与 zod 契约", () => {
    expect(wordCore({ translation: "vt. 抛弃" }, { core: " 放弃 ", corePos: "v." })).toEqual({ def: "放弃", pos: "v." });
    expect(wordCore({ translation: "vt. 抛弃" }, { core: "放弃", corePos: null })).toEqual({ def: "放弃", pos: "" });
    expect(wordCore({ translation: "vt. 抛弃, 遗弃" }, null)).toEqual({ def: "抛弃, 遗弃", pos: "v." });
    expect(wordCore({ translation: null }, null)).toEqual({ def: null, pos: "" });
    expect(wordView({ translation: "a. 善意的" }, null).meanings[0].pos).toBe("adj.");
    expect(parseAi(AiMeaningsSchema, abandon.meanings)).not.toBeNull();
    expect(parseAi(AiMeaningsSchema, [])).toBeNull();
    expect(parseAi(AiExamplesSchema, Array(6).fill({ en: "a b c", zh: "x" }))).toBeNull();
    expect(parseAi(AiMistakesSchema, [{ wrong: "a", right: "b" }])?.[0].note).toBe("");
  });
});
