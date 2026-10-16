import { describe, it, expect } from "vitest";
import robots from "../src/app/robots";

describe("robots.txt", () => {
  const { rules } = robots();
  const groups = Array.isArray(rules) ? rules : [rules];

  it("SEO 工具的外链爬虫整站拒掉", () => {
    const g = groups.find((r) => r.disallow === "/");
    expect(g?.userAgent).toEqual(["SemrushBot", "AhrefsBot", "DotBot"]);
    expect(g?.allow).toBeUndefined();
  });

  it("其它爬虫放行公开页、只禁接口", () => {
    const g = groups.find((r) => r.userAgent === "*");
    expect(g?.allow).toContain("/dict/");
    expect(g?.disallow).toEqual(["/api/"]);
  });
});
