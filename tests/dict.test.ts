import { describe, it, expect } from "vitest";
import { parseExchange, inflectionOf, selectReason, mergeDictRows, parseTranslation, firstDef, firstDefParts, normalizePos, formatPhonetic, wordCreateData, hasRealPos, looksLikeName, rankBand, wordFreq, type DictRow } from "../src/lib/dict";

const row = (p: Partial<DictRow> & { word: string }): DictRow => ({ spelling: p.word.toLowerCase(), phonetic: null, definition: null, translation: null, collins: null, oxford: false, tag: null, bnc: null, frq: null, exchange: null, ...p });

describe("词典解析", () => {
  it("词形变化", () => {
    expect(parseExchange("p:took/d:taken/0:take/1:p")).toEqual({ p: "took", d: "taken", "0": "take", "1": "p" });
    expect(inflectionOf({ word: "went", exchange: "0:go/1:p" })).toBe("go");
    expect(inflectionOf({ word: "take", exchange: "p:took/d:taken/0:take" })).toBeNull();
    expect(inflectionOf({ word: "abandon", exchange: null })).toBeNull();
  });
  it("人名地名", () => {
    expect(looksLikeName("n. 谢菲尔德（英国城市）")).toBe(true);
    expect(looksLikeName("伍伦贡[澳大利亚东南部港市]")).toBe(true);
    expect(looksLikeName("n. 亚伦（男子名）")).toBe(true);
    expect(looksLikeName("n. 核对表, 一览表, 人名单")).toBe(false);
    expect(looksLikeName("n. 岛屿")).toBe(false);
  });
  it("中文释义 → meanings", () => {
    expect(parseTranslation("n. 罩；风帽\nv. 覆盖\n[网络] 胡德")).toEqual([{ pos: "n.", defs: ["罩", "风帽"] }, { pos: "v.", defs: ["覆盖"] }]);
    expect(parseTranslation("[网络] 胡德；兜帽")).toEqual([{ pos: "", defs: ["胡德", "兜帽"] }]);
    expect(parseTranslation("vt. & vi. 放弃")).toEqual([{ pos: "vt.&vi.", defs: ["放弃"] }]);
    expect(parseTranslation("interj. (非正式)哇\nn. 巨大的成功")).toEqual([{ pos: "interj.", defs: ["(非正式)哇"] }, { pos: "n.", defs: ["巨大的成功"] }]);
    expect(parseTranslation(null)).toEqual([]);
    expect(firstDef("n. 瓷器；陶瓷")).toBe("n. 瓷器");
    expect(firstDef(null)).toBeNull();
    expect(firstDefParts("a. 善意的；慈善的")).toEqual({ pos: "adj.", def: "善意的" });
    expect(firstDefParts("[网络] 胡德；兜帽")).toEqual({ pos: "", def: "胡德" });
    expect(firstDefParts(null)).toBeNull();
  });
  it("词性写法归一：词典老式写法与 AI 一致", () => {
    expect(normalizePos("a.")).toBe("adj.");
    expect(normalizePos("ad.")).toBe("adv.");
    expect(normalizePos("vt.&vi.")).toBe("v.");
    expect(normalizePos("n.&vt.")).toBe("n./v.");
    expect(normalizePos("det./pron.")).toBe("det./pron.");
    expect(normalizePos("adj.")).toBe("adj.");
    expect(normalizePos(null)).toBe("");
    expect(formatPhonetic("əˈbændən")).toBe("/əˈbændən/");
    expect(formatPhonetic("/x/")).toBe("/x/");
    expect(formatPhonetic("")).toBeNull();
  });
});

describe("筛选与合并", () => {
  const opts = { maxRank: 30000, includeForms: false };
  it("入选理由", () => {
    expect(selectReason(row({ word: "abandon", tag: "cet4 ky", frq: 3000 }), opts)).toBe("tag");
    expect(selectReason(row({ word: "the", oxford: true }), opts)).toBe("oxford");
    expect(selectReason(row({ word: "acid rain", collins: 1 }), opts)).toBe("collins");
    expect(selectReason(row({ word: "kettle", frq: 12000, translation: "n. 水壶" }), opts)).toBe("rank");
    expect(selectReason(row({ word: "Aaron", frq: 9000, translation: "n. 亚伦（男子名）" }), opts)).toBeNull();
    expect(selectReason(row({ word: "aaron", frq: 9000, translation: "n. 亚伦（男子名）；[圣经]亚伦" }), opts)).toBeNull();
    expect(selectReason(row({ word: "sheffield", bnc: 4000, translation: "n. 谢菲尔德（英国城市）" }), opts)).toBeNull();
    expect(selectReason(row({ word: "lewis", bnc: 2349, translation: "n. 吊楔" }), opts)).toBeNull();
    expect(selectReason(row({ word: "monday", bnc: 1679, tag: "zk gk", translation: "n. 星期一" }), opts)).toBe("tag");
    expect(selectReason(row({ word: "athens", bnc: 4000, translation: "n. 雅典(希腊首都)" }), opts)).toBeNull();
    expect(selectReason(row({ word: "city", frq: 300, translation: "n. 城市, 市" }), opts)).toBe("rank");
    expect(selectReason(row({ word: "borough", frq: 9000, translation: "n. 自治市镇（英）；区（美国纽约市）" }), opts)).toBe("rank");
    expect(selectReason(row({ word: "aa", frq: 20000, translation: "[计] 绝对地址" }), opts)).toBeNull();
    expect(selectReason(row({ word: "aah", frq: 20000, translation: "abbr.[军] Armored Artillery Howitzer" }), opts)).toBeNull();
    expect(selectReason(row({ word: "China", tag: "zk", translation: "n. 中国" }), opts)).toBe("tag");
    expect(hasRealPos("vt. & vi. 放弃")).toBe(true);
    expect(hasRealPos("[网络] 胡德")).toBe(false);
    expect(selectReason(row({ word: "went", frq: 500, exchange: "0:go/1:p", translation: "v. go的过去式" }), opts)).toBeNull();
    expect(selectReason(row({ word: "went", frq: 500, exchange: "0:go/1:p", translation: "v. go的过去式" }), { ...opts, includeForms: true })).toBe("rank");
    expect(selectReason(row({ word: "zymurgy", frq: 90000, translation: "n. 酿造学" }), opts)).toBeNull();
    expect(selectReason(row({ word: "kettle", frq: 12000, translation: "n. 水壶" }), { ...opts, maxRank: 0 })).toBeNull();
    expect(selectReason(row({ word: "take care of" }), opts)).toBeNull();
  });
  it("大小写变体合并", () => {
    const m = mergeDictRows([row({ word: "China", tag: "zk gk", translation: "n. 中国", frq: 800 }), row({ word: "china", translation: "n. 瓷器", collins: 2, frq: 5000, phonetic: "ˈtʃaɪnə" })]);
    expect(m.translation).toBe("n. 瓷器\n[China] n. 中国");
    expect(m.tags).toEqual(["zk", "gk"]);
    expect(m.collins).toBe(2);
    expect(m.oxford).toBe(false);
    expect(m.frq).toBe(800);
    expect(m.phonetic).toBe("ˈtʃaɪnə");
    expect(m.display).toBeNull();
  });
  it("只有大写形式时也能合并；标签按考试顺序", () => {
    const m = mergeDictRows([row({ word: "Monday", tag: "gk zk", translation: "n. 星期一" })]);
    expect(m.translation).toBe("n. 星期一");
    expect(m.tags).toEqual(["zk", "gk"]);
    expect(m.display).toBe("Monday");
    expect(mergeDictRows([row({ word: "North", translation: "n. 北方" })]).display).toBeNull();
    expect(mergeDictRows([row({ word: "sydney", translation: "n. 悉尼（澳大利亚港市）" })]).display).toBe("Sydney");
  });
  it("新建 word 行数据", () => {
    expect(wordCreateData("give up")).toEqual({ spelling: "give up", kind: "phrase" });
    const d = wordCreateData("china", mergeDictRows([row({ word: "china", translation: "n. 瓷器" })]));
    expect(d.kind).toBe("word");
    expect(d.dictSource).toBe("ecdict");
    expect(d.translation).toBe("n. 瓷器");
  });
});

describe("词频 Tab", () => {
  it("排名分档：越小越常用，无数据为 null", () => {
    expect(rankBand(1)).toBe("最常用");
    expect(rankBand(1000)).toBe("最常用");
    expect(rankBand(2182)).toBe("常用");
    expect(rankBand(8000)).toBe("较常用");
    expect(rankBand(17755)).toBe("较少见");
    expect(rankBand(40000)).toBe("少见");
    expect(rankBand(null)).toBeNull();
    expect(rankBand(0)).toBeNull();
  });
  it("wordFreq 补齐缺省值", () => {
    expect(wordFreq({})).toEqual({ frq: null, bnc: null, collins: null, oxford: false, tags: [] });
    expect(wordFreq({ frq: 2182, bnc: 2057, collins: 3, oxford: true, tags: ["gk", "cet4"] })).toEqual({ frq: 2182, bnc: 2057, collins: 3, oxford: true, tags: ["gk", "cet4"] });
  });
});

describe("专名判定 looksLikeName（审计 F084）", () => {
  it("真专名仍然判为专名", () => {
    expect(looksLikeName("n. 亚伦(男子名)")).toBe(true);
    expect(looksLikeName("n. 谢菲尔德(英国城市)")).toBe(true);
    expect(looksLikeName("n. 伦敦(英国首都)")).toBe(true);
    expect(looksLikeName("n. 史密斯(姓氏)")).toBe(true);
  });
  it("不再误伤这几个常用词", () => {
    expect(looksLikeName("n. 姓, 别号, 绰号\nvt. 呼以姓氏, 起绰号")).toBe(false);      // surname
    expect(looksLikeName("a. 姓氏不详的, 无名的, 无特色的")).toBe(false);                 // anonymous
    expect(looksLikeName("n. 匿名, 姓氏不明")).toBe(false);                              // anonymity
    expect(looksLikeName("n. 地名辞典, 公报作者")).toBe(false);                          // gazetteer
    expect(looksLikeName("n. 汉堡(德国港口), 肉饼, 汉堡包, 纯精牛肉, 汉堡牛排")).toBe(false); // hamburger
  });
});
