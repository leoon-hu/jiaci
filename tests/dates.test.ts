import { describe, it, expect } from "vitest";
import { resolveToday, serverToday, toDate, fromDate } from "../src/lib/dates";

describe("学习日期解析", () => {
  const today = serverToday();
  const shift = (n: number) => { const d = new Date(today + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

  it("相差不超过一天的客户端日期采用，超出的按服务器日期", () => {
    expect(resolveToday(today)).toBe(today);
    expect(resolveToday(shift(1))).toBe(shift(1));
    expect(resolveToday(shift(-1))).toBe(shift(-1));
    expect(resolveToday(shift(2))).toBe(today);
    expect(resolveToday(shift(-5))).toBe(today);
  });

  it("空值与格式不合法的一律按服务器日期", () => {
    expect(resolveToday(null)).toBe(today);
    expect(resolveToday(undefined)).toBe(today);
    expect(resolveToday("2026/09/08")).toBe(today);
    expect(resolveToday("20260908")).toBe(today);
  });

  it("格式合法但日期不存在的不采用（审计 F161）", () => {
    expect(resolveToday("2026-02-30")).toBe(today);
    expect(resolveToday("2026-13-01")).toBe(today);
    expect(resolveToday("2026-00-10")).toBe(today);
  });

  it("字符串与 Date 互转", () => {
    expect(fromDate(toDate("2026-09-08"))).toBe("2026-09-08");
    expect(toDate(null)).toBeNull();
    expect(fromDate(null)).toBeNull();
  });
});
