import { describe, expect, it } from "vitest";
import { quotaFull, quotaFullMessage, quotaHint } from "@/lib/wordbook-quota";

describe("我的词库本数上限（3.3.1）", () => {
  it("到了上限才算满，超过的（上限调小之前建的）也算满；没取到不算满", () => {
    expect(quotaFull({ used: 2, max: 3 })).toBe(false);
    expect(quotaFull({ used: 3, max: 3 })).toBe(true);
    expect(quotaFull({ used: 5, max: 3 })).toBe(true);
    expect(quotaFull(null)).toBe(false);
    expect(quotaFull(undefined)).toBe(false);
  });
  it("提示：没满说还能加几本，满了说删一本", () => {
    expect(quotaHint({ used: 1, max: 3 })).toContain("还能再加 2 本");
    expect(quotaHint({ used: 3, max: 3 })).toBe(quotaFullMessage(3));
    expect(quotaFullMessage(3)).toContain("最多 3 本");
  });
});
