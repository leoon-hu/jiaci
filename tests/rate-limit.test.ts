import { describe, it, expect, beforeEach } from "vitest";
import { allow, isOver, resetRateLimit, clientIp } from "../src/lib/rate-limit";

describe("限速", () => {
  beforeEach(() => resetRateLimit());

  it("窗口内超过上限即拒绝，不同 key 互不影响", () => {
    for (let i = 0; i < 3; i++) expect(allow("a", 3, 60_000)).toBe(true);
    expect(allow("a", 3, 60_000)).toBe(false);
    expect(allow("b", 3, 60_000)).toBe(true);
  });

  it("isOver 不记命中", () => {
    expect(allow("c", 1, 60_000)).toBe(true);
    expect(isOver("c", 1, 60_000)).toBe(true);
    expect(isOver("c", 2, 60_000)).toBe(false);
  });

  it("客户端 IP 取 X-Real-IP，其次取 X-Forwarded-For 的最后一跳（前面的可伪造）", () => {
    const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
    expect(clientIp(req({ "x-real-ip": "1.2.3.4" }))).toBe("1.2.3.4");
    expect(clientIp(req({ "x-forwarded-for": "9.9.9.9, 5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientIp(req({}))).toBe("local");
  });
});
