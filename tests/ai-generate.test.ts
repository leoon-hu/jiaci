import { describe, it, expect } from "vitest";
import { BAN_COUNTED, bannedMessage, generateEnabled, generateStatus, refusalResponse, refuseReason, remainingAfter, shouldBan, type GenerateLimits } from "../src/lib/ai/generate-rules";

const L: GenerateLimits = { dailyPerUser: 50, perMinute: 5, dailyPerIp: 150, concurrency: 3, banAfter: 20, banHours: 24 };
const c = (o: Partial<{ userDay: number; userMinute: number; ipDay: number; running: number }> = {}) => ({ userDay: 0, userMinute: 0, ipDay: 0, running: 0, ...o });

describe("生成 AI 资料：放不放行", () => {
  it("功能开关：有密钥且每日上限 > 0", () => {
    expect(generateEnabled(L, true)).toBe(true);
    expect(generateEnabled(L, false)).toBe(false);
    expect(generateEnabled({ dailyPerUser: 0 }, true)).toBe(false);
  });
  it("没超限就放行；每日 → 每分钟 → IP → 并发依次判断", () => {
    expect(refuseReason(c(), L)).toBeNull();
    expect(refuseReason(c({ userDay: 49, userMinute: 4, ipDay: 149, running: 2 }), L)).toBeNull();
    expect(refuseReason(c({ userDay: 50 }), L)).toBe("limit_daily");
    expect(refuseReason(c({ userMinute: 5 }), L)).toBe("limit_minute");
    expect(refuseReason(c({ ipDay: 150 }), L)).toBe("limit_ip");
    expect(refuseReason(c({ running: 3 }), L)).toBe("busy");
    // 同时超几项时按顺序报第一项：每日用完的人不该被说成「太频繁」
    expect(refuseReason(c({ userDay: 50, userMinute: 5, running: 9 }), L)).toBe("limit_daily");
  });
  it("剩余次数：这次放行之后还剩几次，不会是负数", () => {
    expect(remainingAfter(0, L)).toBe(49);
    expect(remainingAfter(49, L)).toBe(0);
    expect(remainingAfter(60, L)).toBe(0);
  });
  it("被拒的状态码与文案：每日 / 每分钟 / IP 是 429，忙是 503，已有资料 409，查无此词 404；每日上限写进文案", () => {
    expect(refusalResponse("limit_daily", L)).toEqual({ status: 429, message: "24 小时内最多生成 50 次，已经用完，过一天再来" });
    expect(refusalResponse("limit_daily", { ...L, dailyPerUser: 8 }).message).toContain("8 次");
    expect(refusalResponse("limit_minute", L)).toMatchObject({ status: 429, retryAfter: 60 });
    expect(refusalResponse("limit_ip", L).status).toBe(429);
    expect(refusalResponse("busy", L)).toMatchObject({ status: 503, retryAfter: 30 });
    expect(refusalResponse("exists", L).status).toBe(409);
    expect(refusalResponse("unknown", L).status).toBe(404);
  });
});

describe("生成 AI 资料：封禁", () => {
  it("24 小时内被拒达到 banAfter 次就封；banAfter = 0 不封", () => {
    expect(shouldBan(19, L)).toBe(false);
    expect(shouldBan(20, L)).toBe(true);
    expect(shouldBan(999, { banAfter: 0 })).toBe(false);
  });
  it("服务器自己忙（busy）不算用户的问题，其余原因都算", () => {
    expect(BAN_COUNTED).not.toContain("busy");
    for (const r of ["limit_daily", "limit_minute", "limit_ip", "exists", "unknown"] as const) expect(BAN_COUNTED).toContain(r);
  });
  it("封禁中的文案：还剩几小时，不足一小时按一小时", () => {
    const now = Date.parse("2026-10-29T00:00:00Z");
    expect(bannedMessage(new Date(now + 24 * 3_600_000), now)).toBe("生成功能已暂停使用，24 小时后恢复");
    expect(bannedMessage(new Date(now + 90 * 60_000), now)).toBe("生成功能已暂停使用，2 小时后恢复");
    expect(bannedMessage(new Date(now + 10 * 60_000), now)).toBe("生成功能已暂停使用，1 小时后恢复");
  });
});

describe("生成 AI 资料：轮询时的状态", () => {
  const now = Date.parse("2026-10-29T08:00:00Z");
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000);
  it("在跑就是 running，不管别的", () => {
    expect(generateStatus(true, true, { status: "ok", reason: null, createdAt: at(1) }, now)).toEqual({ status: "running" });
  });
  it("已有资料就是 done；10 分钟内刚写入的标 justDone（接口据此刷新公开页），更早的或别的来源的不标", () => {
    expect(generateStatus(false, true, { status: "ok", reason: null, createdAt: at(1) }, now)).toEqual({ status: "done", justDone: true });
    expect(generateStatus(false, true, { status: "ok", reason: null, createdAt: at(30) }, now)).toEqual({ status: "done", justDone: false });
    expect(generateStatus(false, true, null, now)).toEqual({ status: "done", justDone: false });
  });
  it("最近一次放行的请求失败 → failed 并带原因；pending 却没在跑（服务重启）也算 failed", () => {
    expect(generateStatus(false, false, { status: "failed", reason: "接口 502", createdAt: at(2) }, now)).toEqual({ status: "failed", error: "接口 502" });
    expect(generateStatus(false, false, { status: "pending", reason: null, createdAt: at(2) }, now)).toEqual({ status: "failed", error: "生成被打断了，请再试一次" });
  });
  it("没有最近的记录就是 idle：很久以前失败过的不算这次", () => {
    expect(generateStatus(false, false, null, now)).toEqual({ status: "idle" });
    expect(generateStatus(false, false, { status: "failed", reason: "x", createdAt: at(30) }, now)).toEqual({ status: "idle" });
  });
});
