import { describe, expect, it } from "vitest";
import { BRAND_TAG_COUNT, BRAND_WORDS_MAX, brandExample, brandHash, pickBrandWords } from "../src/lib/brand";

const WORDS = Array.from({ length: 30000 }, (_, i) => `w${i}`);
const HOST = "jiaci.app";
const ex = (n: number) => Array.from({ length: n }, (_, i) => ({ zh: `译文${i}` }));

describe("来源标注：哪些词", () => {
  it("取 max 个，超过上限按 2000，0 或负数一个不取", () => {
    expect(BRAND_WORDS_MAX).toBe(2000);
    expect(pickBrandWords(WORDS, 2000).size).toBe(2000);
    expect(pickBrandWords(WORDS, 5000).size).toBe(2000);
    expect(pickBrandWords(WORDS, 300).size).toBe(300);
    expect(pickBrandWords(WORDS, 0).size).toBe(0);
    expect(pickBrandWords(WORDS, -1).size).toBe(0);
    expect(pickBrandWords(["a", "b"], 2000)).toEqual(new Set(["a", "b"]));
  });

  it("与输入顺序、重复无关", () => {
    const a = pickBrandWords(WORDS, 2000);
    const b = pickBrandWords([...WORDS].reverse().concat(WORDS.slice(0, 100)), 2000);
    expect([...b].sort()).toEqual([...a].sort());
  });

  it("调小只是取前面一段：300 个都在 2000 个里", () => {
    const big = pickBrandWords(WORDS, 2000);
    for (const w of pickBrandWords(WORDS, 300)) expect(big.has(w)).toBe(true);
  });

  it("词表加一个词最多换掉一个，删掉名单里的一个只补进一个", () => {
    const before = pickBrandWords(WORDS, 2000);
    const added = pickBrandWords([...WORDS, "newword"], 2000);
    expect([...before].filter((w) => !added.has(w)).length).toBeLessThanOrEqual(1);
    const gone = [...before][0];
    const removed = pickBrandWords(WORDS.filter((w) => w !== gone), 2000);
    expect([...removed].filter((w) => !before.has(w))).toHaveLength(1);
  });

  it("哈希与名单固定（改了被标注的词会整批换掉）", () => {
    expect([brandHash(""), brandHash("a"), brandHash("brand:abandon")]).toEqual([2872998923, 444641715, 1031549449]);
    expect([...pickBrandWords(WORDS, 5)]).toEqual(["w2522", "w18065", "w5466", "w21530", "w9186"]);
  });
});

describe("来源标注：放在哪条例句、用哪种写法", () => {
  it("两条以上不放第一条，只有一条就放这条", () => {
    for (const w of WORDS.slice(0, 500)) {
      for (const n of [2, 3, 5]) {
        const m = brandExample(w, ex(n), HOST)!;
        expect(m.index).toBeGreaterThan(0);
        expect(m.index).toBeLessThan(n);
      }
      expect(brandExample(w, ex(1), HOST)!.index).toBe(0);
    }
  });

  it("后面几条都轮得到", () => {
    expect(new Set(WORDS.slice(0, 200).map((w) => brandExample(w, ex(3), HOST)!.index))).toEqual(new Set([1, 2]));
  });

  it("跳过没有译文的例句，一条带译文的都没有返回 null", () => {
    expect(brandExample("abandon", [{ zh: "放弃" }, { zh: " " }, { zh: "" }], HOST)!.index).toBe(0);
    expect(brandExample("abandon", [{ zh: "" }, { zh: "乙" }, { zh: "丙" }], HOST)!.index).toBeGreaterThan(0);
    expect(brandExample("abandon", [], HOST)).toBeNull();
    expect(brandExample("abandon", [{ zh: " " }], HOST)).toBeNull();
  });

  it("同一个词每次一样；每种写法都带域名，几种写法都用得上", () => {
    expect(brandExample("abandon", ex(4), HOST)).toEqual(brandExample("abandon", ex(4), HOST));
    const texts = new Set(WORDS.slice(0, 400).map((w) => brandExample(w, ex(3), HOST)!.text));
    expect(texts.size).toBe(BRAND_TAG_COUNT);
    for (const t of texts) expect(t).toContain(HOST);
  });
});
