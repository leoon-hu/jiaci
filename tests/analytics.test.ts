import { describe, expect, it } from "vitest";
import { analyticsConfig } from "@/lib/analytics";

const full = { script: "https://stats.example.com/script.js", websiteId: "abc-123", siteUrl: "https://jiaci.example.com" };

describe("访问统计的配置（需求 4.1：两项都配了才统计）", () => {
  it("两项齐全才有配置，顺手去掉空白，域名取自站点地址", () => {
    expect(analyticsConfig(full)).toEqual({ script: full.script, websiteId: "abc-123", domain: "jiaci.example.com" });
    expect(analyticsConfig({ ...full, websiteId: "  abc-123 " })?.websiteId).toBe("abc-123");
  });

  it("缺任何一项、或只有空白 → 不统计", () => {
    expect(analyticsConfig({})).toBeNull();
    expect(analyticsConfig({ script: full.script })).toBeNull();
    expect(analyticsConfig({ websiteId: "abc" })).toBeNull();
    expect(analyticsConfig({ ...full, script: "   " })).toBeNull();
  });

  it("没有站点地址或它不是合法地址 → 不限域名", () => {
    expect(analyticsConfig({ ...full, siteUrl: undefined })?.domain).toBe("");
    expect(analyticsConfig({ ...full, siteUrl: "not a url" })?.domain).toBe("");
  });
});
