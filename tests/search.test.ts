import { describe, expect, it } from "vitest";
import {
  dropSearchHistory, editDistance, lemmaNote, mergeHits, normalizeSearchHistory, parseSearchQuery, pushSearchHistory, rankFuzzy, sortZh, zhRank,
  SEARCH_FUZZY_LIMIT, SEARCH_HISTORY_MAX, SEARCH_MAX_LEN, type SearchHistoryItem,
} from "../src/lib/search";

describe("单词搜索：输入怎么理解", () => {
  it("英文：小写、合并空白、去掉首尾的非字母；短语、撇号、连字符保留", () => {
    expect(parseSearchQuery("  Abandon ")).toEqual({ kind: "en", text: "abandon" });
    expect(parseSearchQuery("Give   UP!")).toEqual({ kind: "en", text: "give up" });
    expect(parseSearchQuery("give ")).toEqual({ kind: "en", text: "give" });
    expect(parseSearchQuery("don’t")).toEqual({ kind: "en", text: "don't" });
    expect(parseSearchQuery("self-")).toEqual({ kind: "en", text: "self" });
    expect(parseSearchQuery("café")).toEqual({ kind: "en", text: "cafe" });
  });
  it("有汉字按中文搜，去掉空白与标点", () => {
    expect(parseSearchQuery("放弃")).toEqual({ kind: "zh", text: "放弃" });
    expect(parseSearchQuery(" 放 弃， ")).toEqual({ kind: "zh", text: "放弃" });
    expect(parseSearchQuery("T恤")).toEqual({ kind: "zh", text: "T恤" });
  });
  it("什么都不剩、不是字母开头或含别的字符的不搜", () => {
    for (const s of ["", "   ", "!!", "123", "e.g.", "a1b", "привет", "，。"]) expect(parseSearchQuery(s)).toBeNull();
  });
  it("太长的只取前面", () => {
    expect(parseSearchQuery("a".repeat(100))?.text).toHaveLength(SEARCH_MAX_LEN);
    expect(parseSearchQuery("苹".repeat(100))?.text).toHaveLength(SEARCH_MAX_LEN);
  });
});

describe("单词搜索：结果怎么排", () => {
  const h = (spelling: string, note?: string) => ({ spelling, note });
  it("完全相同的 → 原形 → 前缀，同一个词只出一次（先出现的那条留下，带着原形的小字）", () => {
    const merged = mergeHits([[h("found")], [h("find", "found 是它的过去式")], [h("found"), h("foundation"), h("find")]]);
    expect(merged).toEqual([h("found"), h("find", "found 是它的过去式"), h("foundation")]);
  });
  it("最多给 limit 条", () => {
    expect(mergeHits([[h("a"), h("b")], [h("c"), h("d")]], 3).map((x) => x.spelling)).toEqual(["a", "b", "c"]);
  });
  it("原形那一条的小字", () => {
    expect(lemmaNote("went", "过去式")).toBe("went 是它的过去式");
    expect(lemmaNote("men", null)).toBe("men 的原形");
  });
  it("中文：核心义第一个分句是它 → 核心义别的分句是它 → 词典释义的分句是它 → 以它开头 → 核心义里有 → 只在词典释义里有", () => {
    expect(zhRank("放弃", "放弃；抛弃", null)).toBe(0);
    expect(zhRank("放弃", "（正式）放弃", null)).toBe(0);
    expect(zhRank("放弃", "滴；落下；下降；放弃", null)).toBe(1);
    expect(zhRank("放弃", "离开", "vt. 离开, 放弃\nn. 离开")).toBe(2);
    expect(zhRank("放弃", "放弃（权利）", null)).toBe(3);
    expect(zhRank("放弃", "主动放弃权利", null)).toBe(4);
    expect(zhRank("放弃", "免除", "vt. 免除；不坚持主动放弃的权利")).toBe(5);
    expect(zhRank("放弃", null, null)).toBe(5);
  });
  it("中文按档位稳定排序，同一档保持原来的词频顺序", () => {
    const rows = [
      { s: "drop", core: "滴；落下；下降；放弃", translation: null },
      { s: "a", core: "主动放弃权利", translation: null },
      { s: "abandon", core: "放弃；抛弃", translation: null },
      { s: "c", core: null, translation: "vt. 放弃" },
      { s: "give up", core: "放弃；停止尝试", translation: null },
    ];
    expect(sortZh("放弃", rows).map((r) => r.s)).toEqual(["abandon", "give up", "drop", "c", "a"]);
  });
  it("编辑距离：相邻两个字母对调算一步", () => {
    expect(editDistance("recieve", "receive")).toBe(1);
    expect(editDistance("recieve", "relieve")).toBe(1);
    expect(editDistance("teh", "the")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("same", "same")).toBe(0);
  });
  it("「你要找的是不是」：差得远的不要，同样近的常用词在前，没有词频的排后面", () => {
    const rows = [
      { spelling: "relieve", rank: 3764 }, { spelling: "retrieve", rank: 4952 }, { spelling: "reprieve", rank: 20000 },
      { spelling: "receive", rank: 497 }, { spelling: "recieved", rank: null }, { spelling: "recipe", rank: 3000 },
    ];
    expect(rankFuzzy("recieve", rows).map((r) => r.spelling)).toEqual(["receive", "relieve", "recieved", "recipe", "retrieve"]);
    expect(rankFuzzy("recieve", rows)).toHaveLength(SEARCH_FUZZY_LIMIT);
    // 4 个字母以内只容一处
    expect(rankFuzzy("teh", [{ spelling: "the", rank: 1 }, { spelling: "ten", rank: 900 }, { spelling: "tech", rank: 5000 }, { spelling: "eh", rank: null }, { spelling: "toe", rank: 2000 }]).map((r) => r.spelling)).toEqual(["the", "ten", "tech", "eh"]);
  });
});

describe("单词搜索：本设备的搜索记录", () => {
  const it_ = (spelling: string, def: string | null = null): SearchHistoryItem => ({ spelling, display: null, def });
  it("打开过的词挪到最前，同一个词只留一条，超出上限丢掉最旧的", () => {
    let list: SearchHistoryItem[] = [];
    list = pushSearchHistory(list, it_("apple"));
    list = pushSearchHistory(list, it_("give up"));
    list = pushSearchHistory(list, it_("apple", "苹果"));
    expect(list).toEqual([it_("apple", "苹果"), it_("give up")]);
    for (let i = 0; i < 30; i++) list = pushSearchHistory(list, it_(`w${String.fromCharCode(97 + (i % 26))}${i}`));
    expect(list).toHaveLength(SEARCH_HISTORY_MAX);
    expect(list[0].spelling).toBe("wd29");
  });
  it("删掉一条", () => {
    expect(dropSearchHistory([it_("apple"), it_("pear")], "apple")).toEqual([it_("pear")]);
  });
  it("从本地存储读回来的东西过一遍：不是数组、拼写不合法、重复的丢掉，文本截短，最多 20 条", () => {
    expect(normalizeSearchHistory(null)).toEqual([]);
    expect(normalizeSearchHistory({ spelling: "apple" })).toEqual([]);
    expect(normalizeSearchHistory([
      { spelling: "Apple", display: "Apple", def: "苹果" },
      { spelling: "apple", def: "重复的" },
      { spelling: "123" }, null, "pear", { spelling: 3 },
      { spelling: "give up", display: "", def: "放".repeat(200) },
    ])).toEqual([
      { spelling: "apple", display: "Apple", def: "苹果" },
      { spelling: "give up", display: null, def: "放".repeat(80) },
    ]);
    expect(normalizeSearchHistory(Array.from({ length: 50 }, (_, i) => ({ spelling: `w${String.fromCharCode(97 + (i % 26))}${"x".repeat(Math.floor(i / 26) + 1)}` })))).toHaveLength(SEARCH_HISTORY_MAX);
  });
});
