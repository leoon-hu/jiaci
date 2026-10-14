import { describe, expect, it } from "vitest";
import { categorySummary, parseCategoryList, shortGloss } from "../src/lib/categories";

const e = (w: string, gloss: string | null = null) => ({ w, gloss });

describe("同类词词表解析", () => {
  it("一行一个类别，逗号分隔，短语可带空格，# 后是注释，大小写与首尾杂字符归一", () => {
    const { categories, problems } = parseCategoryList([
      "# 说明行",
      "家庭成员\tmother, father, Brother , sister.  # 注释",
      "",
      "房间\tbedroom, living room, kitchen，bathroom",
    ].join("\n"));
    expect(problems).toEqual([]);
    expect(categories).toEqual([
      { name: "家庭成员", entries: [e("mother"), e("father"), e("brother"), e("sister")] },
      { name: "房间", entries: [e("bedroom"), e("living room"), e("kitchen"), e("bathroom")] },
    ]);
  });
  it("「词=释义」给多义词指定这个类别里显示的义项；释义为空或太长报出来并跳过", () => {
    const { categories, problems } = parseCategoryList("法律职业\tlawyer, judge=法官, Judge=法官, cook=, clerk=这个释义实在是太长了超过了二十个字的上限吧, juror");
    expect(categories).toEqual([{ name: "法律职业", entries: [e("lawyer"), e("judge", "法官"), e("juror")] }]);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain("「judge」重复");
    expect(problems[1]).toContain("「cook」的释义为空或超过");
    expect(problems[2]).toContain("「clerk」的释义为空或超过");
  });
  it("重复的类别名、重复或不合法的词、太短的类别都报出来并跳过，其余照常", () => {
    const { categories, problems } = parseCategoryList([
      "水果\tapple, banana, apple, 苹果, orange",
      "水果\tpear, grape, peach",
      "颜色\tred, blue",
      "没有分隔符的行",
      "\tred, blue, green",
      "学科\tbiology, chemistry, physics",
    ].join("\n"));
    expect(categories).toEqual([
      { name: "水果", entries: [e("apple"), e("banana"), e("orange")] },
      { name: "学科", entries: [e("biology"), e("chemistry"), e("physics")] },
    ]);
    expect(problems).toHaveLength(6);
    expect(problems[0]).toContain("「apple」重复");
    expect(problems[1]).toContain("「苹果」不是合法");
    expect(problems[2]).toContain("「水果」重复");
    expect(problems[3]).toContain("只有 2 个词");
    expect(problems[4]).toContain("没有制表符");
    expect(problems[5]).toContain("类别名为空");
  });
  it("类别名太长也报出来", () => {
    const { categories, problems } = parseCategoryList("这个类别的名字实在是太长了一些\tred, blue, green");
    expect(categories).toEqual([]);
    expect(problems[0]).toContain("超过");
  });
});

describe("同类词展示", () => {
  it("主释义只取第一个分句", () => {
    expect(shortGloss("放弃；抛弃（人、物或计划）")).toBe("放弃");
    expect(shortGloss("n. 母亲, 妈妈")).toBe("n. 母亲");
    expect(shortGloss("（餐馆等的）服务员，侍者")).toBe("服务员");
    expect(shortGloss("（狼、狗）长嚎；（人）吼叫")).toBe("长嚎");
    expect(shortGloss("  ")).toBeNull();
    expect(shortGloss(null)).toBeNull();
  });
  it("摘要：类别名 + 前几个词 + 条数，用显示用词头", () => {
    const cats = [
      { name: "水果", words: [{ spelling: "banana", display: null, def: "香蕉" }, { spelling: "orange", display: null, def: "橙子" }, { spelling: "pear", display: null, def: "梨" }, { spelling: "grape", display: null, def: "葡萄" }] },
      { name: "星期", words: [{ spelling: "monday", display: "Monday", def: "星期一" }, { spelling: "tuesday", display: "Tuesday", def: "星期二" }] },
    ];
    expect(categorySummary(cats)).toBe("水果：banana · orange · pear…（4 个） · 星期：Monday · Tuesday（2 个）");
    expect(categorySummary([])).toBe("");
  });
});
