import { describe, it, expect } from "vitest";
import { candidateLemmas, tokenize } from "../src/lib/lemma";
import { parseImportText, splitManualInput, normalizeWord, isValidWord, wordKind } from "../src/lib/words";
import { deriveStatus, pieProgress } from "../src/lib/status";

describe("原形候选", () => {
  it("规则后缀", () => {
    expect(candidateLemmas("abandoned")).toContain("abandon");
    expect(candidateLemmas("studies")).toContain("study");
    expect(candidateLemmas("running")).toContain("run");
    expect(candidateLemmas("cars")[1]).toBe("car");
    expect(candidateLemmas("She's")).toContain("she");
  });
  it("不规则表", () => {
    expect(candidateLemmas("hypotheses")[0]).toBe("hypothesis");
    expect(candidateLemmas("wolves")[0]).toBe("wolf");
    expect(candidateLemmas("took")[0]).toBe("take");
  });
  it("分词保留标点", () => {
    const t = tokenize("They had to abandon the car, and walk.");
    expect(t.filter((x) => x.word).map((x) => x.text)).toEqual(["They", "had", "to", "abandon", "the", "car", "and", "walk"]);
    expect(t.map((x) => x.text).join("")).toBe("They had to abandon the car, and walk.");
  });
});

describe("导入解析", () => {
  it("去重 / 空行 / 非英文 / 末尾空行", () => {
    const r = parseImportText("resilient\nUbiquitous\npragmatic\npragmatic\n\n单词本\nvolatile\n\n\n");
    expect(r.words).toEqual(["resilient", "ubiquitous", "pragmatic", "volatile"]);
    expect(r.ok).toBe(4);
    expect(r.skipped).toBe(3);
    expect(r.rows.map((x) => x.status)).toEqual(["ok", "ok", "ok", "dup", "empty", "bad", "ok"]);
  });
  it("手动输入多词与短语", () => {
    expect(splitManualInput("plan, Study abroad\n单词\n  give   up ;cost")).toEqual({ words: ["plan", "study abroad", "give up", "cost"], bad: ["单词"] });
    expect(normalizeWord("  Hello!  ")).toBe("hello");
    expect(normalizeWord("abandon 放弃")).toBe("abandon");
  });
  it("短语合法性", () => {
    expect(isValidWord("give up")).toBe(true);
    expect(isValidWord("as soon as")).toBe(true);
    expect(isValidWord("a bit")).toBe(true);
    expect(isValidWord("alzheimer's disease")).toBe(true);
    expect(isValidWord("abandon v")).toBe(false);
    expect(isValidWord("give  up")).toBe(false);
    expect(isValidWord("e.g")).toBe(false);
    expect(wordKind("give up")).toBe("phrase");
    expect(wordKind("give")).toBe("word");
  });
  it("导入行含短语与注释", () => {
    // 带词性缩写的注释行现在会被剥掉注释后收下（原来整行判为 bad，词性缩写还可能混成短语，审计 F083）
    const r = parseImportText("give up\nabandon v. 放弃\nlook after 照顾\n");
    expect(r.words).toEqual(["give up", "abandon", "look after"]);
    expect(r.rows.map((x) => x.status)).toEqual(["ok", "ok", "ok"]);
    for (const line of ["able adj. 能够的", "absent a. 缺席的", "abandon vt. 放弃", "quick adv. 快"]) {
      expect(parseImportText(line).words).toEqual([line.split(" ")[0]]);
    }
    // 带重音的词折成 ASCII，而不是被剪成半截（审计 F082）
    expect(parseImportText("café\ncliché\nnaïve\n").words).toEqual(["cafe", "cliche", "naive"]);
    // 折不成 ASCII 的整行判为不合法
    expect(parseImportText("中文\nсолнце\n").rows.map((x) => x.status)).toEqual(["bad", "bad"]);
  });
});

describe("单字母 token", () => {
  it("保留 a / I 本身，点词不再返回空候选（审计 F089）", () => {
    expect(candidateLemmas("a")).toEqual(["a"]);
    expect(candidateLemmas("I")).toEqual(["i"]);
    expect(candidateLemmas("")).toEqual([]);
  });
});

describe("状态与饼图", () => {
  it("四色判定", () => {
    expect(deriveStatus({ progressStatus: null, inCurrentBook: true })).toBe("new");
    expect(deriveStatus({ progressStatus: null, inCurrentBook: false })).toBe("none");
    expect(deriveStatus({ progressStatus: "removed", inCurrentBook: true })).toBe("none");
    expect(deriveStatus({ progressStatus: "learning", inCurrentBook: false })).toBe("learning");
    // 「重新记」后的词若不在当前词库，永远进不了队列，不该显示成红色「未开始」（审计 F031）
    expect(deriveStatus({ progressStatus: "new", inCurrentBook: true })).toBe("new");
    expect(deriveStatus({ progressStatus: "new", inCurrentBook: false })).toBe("none");
  });
  it("饼图进度：学习中按间隔对数增长，已掌握 100", () => {
    expect(pieProgress("mastered", 60)).toBe(100);
    expect(pieProgress("new", 0)).toBe(0);
    expect(pieProgress("none", 30)).toBe(0);
    expect(pieProgress("learning", 0)).toBe(0);
    expect(pieProgress("learning", 1)).toBe(17);
    expect(pieProgress("learning", 7)).toBe(51);
    expect(pieProgress("learning", 30)).toBe(84);
    expect(pieProgress("learning", 60)).toBe(99);
    expect(pieProgress("learning", 500)).toBe(99);
  });
});
