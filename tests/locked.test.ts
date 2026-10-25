import { describe, expect, it } from "vitest";
import { wordView } from "../src/lib/word-view";
import { hasLocked, lockedLabels, lockedOf, withoutLocked } from "../src/lib/locked";
import { QUOTA_WINDOW_MS, createDetailQuota } from "../src/lib/detail-quota";

const dict = { phonetic: "ә'bændәn", translation: "vt. 放弃, 抛弃" };
const ai = {
  core: "放弃；抛弃",
  examples: [{ en: "They had to abandon the car in the snow.", zh: "他们不得不把车丢在雪地里。", level: 1 }],
  synonyms: [{ w: "give up", m: "口语最常用" }],
  confusables: [{ w: "abundant", m: "拼写相近" }, { w: "abound", m: "拼写相近" }],
  mistakes: [{ wrong: "abandon to do sth", right: "give up doing sth", note: "abandon 后接名词" }],
  mnemonic: "a + band + on：乐队还在台上人却走了。",
  etymology: { origin: "来自古法语 abandoner", parts: [{ part: "a-", meaning: "至" }] },
};

describe("登录后才看的四块", () => {
  it("数出各有几条", () => {
    const l = lockedOf(wordView(dict, ai, "deepseek"));
    expect(l).toEqual({ mnemonic: true, etymology: true, confusables: 2, mistakes: 1 });
    expect(hasLocked(l)).toBe(true);
  });

  it("词源只有空拆解、没有来源的不算；一块都没有的词 hasLocked 为假", () => {
    const v = wordView(dict, { core: "x", examples: ai.examples, etymology: { origin: null, parts: [] } }, "deepseek");
    expect(lockedOf(v)).toEqual({ mnemonic: false, etymology: false, confusables: 0, mistakes: 0 });
    expect(hasLocked(lockedOf(v))).toBe(false);
    expect(hasLocked(lockedOf(wordView(dict, null, null)))).toBe(false);
  });

  it("去掉四块，别的不动，也不改传进来的视图", () => {
    const v = wordView(dict, ai, "deepseek");
    const out = withoutLocked(v);
    expect(out.mnemonic).toBeNull();
    expect(out.etymology).toBeNull();
    expect(out.confusables).toEqual([]);
    expect(out.mistakes).toEqual([]);
    expect(out.synonyms).toBe(v.synonyms);
    expect(out.examples).toBe(v.examples);
    expect(v.mnemonic).toBe(ai.mnemonic);
    expect(v.confusables).toHaveLength(2);
    expect(hasLocked(lockedOf(out))).toBe(false);
  });

  it("卡片与提示列出本词有的几块，可以只要一个 Tab 的", () => {
    const l = { mnemonic: true, etymology: false, confusables: 2, mistakes: 1 };
    expect(lockedLabels(l)).toEqual(["易混词 2 个", "常见错误 1 条", "助记"]);
    expect(lockedLabels(l, "related")).toEqual(["易混词 2 个", "常见错误 1 条"]);
    expect(lockedLabels(l, "memory")).toEqual(["助记"]);
    expect(lockedLabels({ mnemonic: false, etymology: false, confusables: 0, mistakes: 0 })).toEqual([]);
  });
});

describe("登录后的详情：每个账号 24 小时的不同词条数", () => {
  const T = 1_800_000_000_000;

  it("到上限就不放行；看过的词反复打开不占名额", () => {
    const q = createDetailQuota();
    expect(q.take("u", "a", 3, T)).toBe(true);
    expect(q.take("u", "b", 3, T + 1)).toBe(true);
    expect(q.take("u", "a", 3, T + 2)).toBe(true);
    expect(q.take("u", "c", 3, T + 3)).toBe(true);
    expect(q.take("u", "d", 3, T + 4)).toBe(false);
    expect(q.take("u", "b", 3, T + 5)).toBe(true);
  });

  it("滑动 24 小时：最早看的那个滑出去，才空出一个名额", () => {
    const q = createDetailQuota();
    q.take("u", "a", 2, T);
    q.take("u", "b", 2, T + 1000);
    expect(q.take("u", "c", 2, T + QUOTA_WINDOW_MS - 1)).toBe(false);
    expect(q.take("u", "c", 2, T + QUOTA_WINDOW_MS)).toBe(true);
    expect(q.take("u", "d", 2, T + QUOTA_WINDOW_MS + 1)).toBe(false);
    // a 滑出去以后再打开要重新占名额
    expect(q.take("u", "a", 2, T + QUOTA_WINDOW_MS + 2)).toBe(false);
  });

  it("账号之间互不影响；上限调大立刻能多看", () => {
    const q = createDetailQuota();
    q.take("u", "a", 1, T);
    expect(q.take("u", "b", 1, T + 1)).toBe(false);
    expect(q.take("v", "b", 1, T + 1)).toBe(true);
    expect(q.take("u", "b", 2, T + 2)).toBe(true);
  });

  it("账号多了淘汰 24 小时没来过的", () => {
    const q = createDetailQuota(2);
    q.take("u1", "a", 5, T);
    q.take("u2", "a", 5, T);
    q.take("u3", "a", 5, T + QUOTA_WINDOW_MS);
    expect(q.trackedUsers()).toBe(1);
  });
});
