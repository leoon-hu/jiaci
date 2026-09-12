import { describe, expect, it } from "vitest";
import { bookPageUrl, dictUrl, pathToSpelling, spellingToPath } from "../src/lib/dict-url";
import { PUBLIC_BOOKS, bookBySlug, bookByName } from "../src/lib/public-books";

describe("公开词条页地址", () => {
  it("空格写成下划线，连字符与撇号原样", () => {
    expect(dictUrl("abandon")).toBe("/dict/abandon");
    expect(dictUrl("give up")).toBe("/dict/give_up");
    expect(dictUrl("after-school")).toBe("/dict/after-school");
    expect(spellingToPath("ain't")).toBe("ain't");
  });
  it("URL 段还原成拼写：下划线 → 空格，大小写与首尾杂字符归一", () => {
    expect(pathToSpelling("give_up")).toBe("give up");
    expect(pathToSpelling("give%20up")).toBe("give up");
    expect(pathToSpelling("China")).toBe("china");
    expect(pathToSpelling("after-school")).toBe("after-school");
    expect(pathToSpelling("best-seller")).toBe("best-seller");
    expect(pathToSpelling("abandon.")).toBe("abandon");
  });
  it("不合法的拼写返回 null", () => {
    expect(pathToSpelling("")).toBeNull();
    expect(pathToSpelling("%E5%8D%95%E8%AF%8D")).toBeNull();
    expect(pathToSpelling("a%ZZ")).toBeNull();
    expect(pathToSpelling("x".repeat(80))).toBeNull();
    expect(pathToSpelling("give_u")).toBeNull();   // 短语里的单字母只允许 a / i
  });
  it("词库页第 1 页不带页码", () => {
    expect(bookPageUrl("ielts", 1)).toBe("/dict/book/ielts");
    expect(bookPageUrl("ielts", 2)).toBe("/dict/book/ielts/2");
  });
});

describe("公开词库清单", () => {
  it("21 本，slug 与名字都唯一，slug 只含小写字母、数字与连字符", () => {
    expect(PUBLIC_BOOKS).toHaveLength(21);
    expect(new Set(PUBLIC_BOOKS.map((b) => b.slug)).size).toBe(21);
    expect(new Set(PUBLIC_BOOKS.map((b) => b.name)).size).toBe(21);
    for (const b of PUBLIC_BOOKS) { expect(b.slug).toMatch(/^[a-z0-9-]+$/); expect(b.blurb.length).toBeGreaterThan(10); }
  });
  it("按 slug / 名字查", () => {
    expect(bookBySlug("ielts-core")?.name).toBe("雅思核心");
    expect(bookByName("海外生活 · 租房与家居")?.slug).toBe("life-housing");
    expect(bookBySlug("nope")).toBeUndefined();
  });
});
