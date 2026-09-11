import { describe, it, expect } from "vitest";
import { americanCandidate, isJunkShort, isPlaceholderPhrase, isProperNounLike, preferAmerican, parseListFile, parseSupplement, isRegularInflectionOf, dropInflections } from "../src/lib/wordbook-rules";
import { normalizeWord, isValidWord } from "../src/lib/words";

const c = (spelling: string, translation: string | null = "n. 东西", display: string | null = null) => ({ spelling, kind: (spelling.includes(" ") ? "phrase" : "word") as "word" | "phrase", translation, display });

describe("内置词库选词规则", () => {
  it("单字母与缩写", () => {
    expect(isJunkShort(c("p", "便士\n[计] 页"))).toBe(true);
    expect(isJunkShort(c("km", "[医] 千米, 公里"))).toBe(true);
    expect(isJunkShort(c("mr", "先生\n[计] 存储器回收程序"))).toBe(true);
    expect(isJunkShort(c("tv", "电视\n[计] 电视"))).toBe(false);
    expect(isJunkShort(c("wow", "interj. 哇"))).toBe(false);
    expect(isJunkShort(c("cat", "n. 猫"))).toBe(false);
    expect(isJunkShort(c("internet", "[计] 因特网"))).toBe(false);
  });
  it("占位短语与专名", () => {
    expect(isPlaceholderPhrase("put sth on")).toBe(true);
    expect(isPlaceholderPhrase("put on")).toBe(false);
    expect(isProperNounLike(c("london", "n. 伦敦", "London"))).toBe(true);
    expect(isProperNounLike(c("paris", "n. 巴黎\n[医] 重楼属", "Paris"))).toBe(true);
    expect(isProperNounLike(c("russia", "n. 俄罗斯", "Russia"))).toBe(true);
    expect(isProperNounLike(c("dr", "n. 博士, 医生\n[医] 英钱", "Dr"))).toBe(false);
    expect(isProperNounLike(c("monday", "n. 星期一", "Monday"))).toBe(false);
    expect(isProperNounLike(c("christmas", "n. 圣诞节", "Christmas"))).toBe(false);
    expect(isProperNounLike(c("american", "a. 美国的, 美国人的\nn. 美国人", "American"))).toBe(false);
    expect(isProperNounLike(c("china", "n. 中国, 瓷器\na. 中国的", null))).toBe(false);
  });
  it("英美拼写只留美式", () => {
    const all = new Map([["color", c("color")], ["colour", c("colour")], ["centre", c("centre")], ["center", c("center")], ["organise", c("organise")]]);
    const out = preferAmerican([c("colour"), c("color"), c("centre"), c("organise")], all);
    expect(out.map((x) => x.spelling)).toEqual(["color", "center", "organise"]);
  });
  it("对照表之外的 -ise / -isation 按后缀换，但美式排名更差的不换", () => {
    expect(americanCandidate("generalisation")).toBe("generalization");
    expect(americanCandidate("analyse")).toBe("analyze");
    expect(americanCandidate("colour")).toBe("color");
    expect(americanCandidate("advice")).toBeNull();
    // 本来就以 -ise 结尾的英语词不再造出假美式拼写（审计 F093）
    for (const w of ["rise", "promise", "surprise", "exercise", "praise", "wise", "advise"]) expect(americanCandidate(w)).toBeNull();
    for (const w of ["promising", "surprises", "revised"]) expect(americanCandidate(w)).toBeNull();
    expect(americanCandidate("organising")).toBe("organizing");
    expect(americanCandidate("paralysed")).toBe("paralyzed");
    const r = (spelling: string, rank: number | null) => ({ ...c(spelling), rank });
    const all = new Map([["generalization", r("generalization", 15000)], ["advertize", r("advertize", null)], ["advertise", r("advertise", 4000)], ["epitomize", r("epitomize", null)]]);
    const out = preferAmerican([r("generalisation", 30000), r("advertise", 4000), r("epitomise", null), r("rise", 500)], all);
    expect(out.map((x) => x.spelling)).toEqual(["generalization", "advertise", "epitomize", "rise"]);
  });
  it("规则变形去重", () => {
    expect(isRegularInflectionOf("teams", "team")).toBe(true);
    expect(isRegularInflectionOf("studying", "study")).toBe(true);
    expect(isRegularInflectionOf("studies", "study")).toBe(true);
    expect(isRegularInflectionOf("stopped", "stop")).toBe(true);
    expect(isRegularInflectionOf("number", "numb")).toBe(false);
    expect(isRegularInflectionOf("evening", "even")).toBe(true);
    const mk = (spelling: string, base: string | null, collins: number | null = null, translation = "n. 东西") => ({ spelling, base, oxford: false, collins, translation });
    const out = dropInflections([mk("team", null), mk("teams", "team"), mk("means", "mean", 3), mk("mean", null), mk("teeth", "tooth", null, "n. 牙齿( tooth的复数 )"), mk("tooth", null), mk("evening", "even", 4), mk("even", null), mk("number", "numb"), mk("numb", null)]);
    expect(out.map((c) => c.spelling)).toEqual(["team", "means", "mean", "tooth", "evening", "even", "number", "numb"]);
  });
  it("没有独立词频的变形去掉或换成原形；有排名 / 星级 / 大写 / 保留表的留下", () => {
    const mk = (spelling: string, base: string | null, o: { form?: string; rank?: number | null; collins?: number; display?: string | null; translation?: string } = {}) =>
      ({ spelling, base, oxford: false, collins: o.collins ?? null, translation: o.translation ?? "n. 东西", form: o.form ?? null, rank: o.rank ?? null, display: o.display ?? null });
    const available = new Map([["beginner", mk("beginner", null, { rank: 9000 })], ["cheap", mk("cheap", null, { rank: 1200 })], ["aid", mk("aid", null, { rank: 1500 })]]);
    const list = [
      mk("foot", null, { rank: 800 }), mk("feet", "foot", { form: "s", translation: "pl. 脚" }),
      mk("criterion", null, { rank: 9000 }), mk("criteria", "criterion", { form: "s", rank: 2500 }),
      mk("beginners", "beginner", { form: "s" }), mk("cheaper", "cheap", { form: "r" }), mk("cheapest", "cheap", { form: "t" }),
      mk("aids", "aid", { form: "s3", display: "AIDS" }), mk("ski", null, { rank: 7000 }), mk("skiing", "ski", { form: "i" }),
      mk("go", null, { rank: 50 }), mk("went", "go", { form: "p", rank: 900 }),
      mk("learn", null, { rank: 400 }), mk("learning", "learn", { form: "i", rank: 1455 }), mk("work", null, { rank: 100 }), mk("worked", "work", { form: "p" }),
    ];
    const out = dropInflections(list, { available, keep: new Set(["skiing"]) });
    expect(out.map((c) => c.spelling)).toEqual(["foot", "criterion", "criteria", "beginner", "cheap", "aids", "ski", "skiing", "go", "went", "learn", "learning", "work"]);
  });
  it("词表文件与补充词典解析", () => {
    expect(parseListFile("# 注释\ngive up\n\nGive Up # 重复\nabandon v. 放弃\nkettle\n", normalizeWord, isValidWord)).toEqual(["give up", "abandon", "kettle"]);
    const s = parseSupplement("# h\napp\tæp\tn. 应用程序|v. 无\nbad line\n", normalizeWord);
    expect(s.get("app")).toEqual({ phonetic: "æp", translation: "n. 应用程序\nv. 无" });
    expect(s.size).toBe(1);
  });
});
