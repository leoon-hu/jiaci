import { describe, it, expect } from "vitest";
import { BREAK_OPTIONS, DEFAULT_BREAK, DEFAULT_FOCUS, FOCUS_OPTIONS, formatClock, initialPomodoro, isPaused, isRunning, normalizePomodoro, pausePomodoro, progress, remaining, resumePomodoro, setDurations, startPhase, stopPomodoro, tickPomodoro } from "../src/lib/pomodoro";

const DAY = "2026-10-14";
const T0 = 1_800_000_000_000;
const MIN = 60_000;

describe("番茄钟：开始 / 暂停 / 继续 / 放弃", () => {
  it("开始专注：结束时刻 = 现在 + 专注分钟；剩余与进度按 now 算", () => {
    const s = startPhase(initialPomodoro(DAY), "focus", T0);
    expect(s.phase).toBe("focus");
    expect(s.endAt).toBe(T0 + 25 * MIN);
    expect(isRunning(s)).toBe(true);
    expect(remaining(s, T0)).toBe(25 * MIN);
    expect(remaining(s, T0 + 10 * MIN)).toBe(15 * MIN);
    expect(remaining(s, T0 + 30 * MIN)).toBe(0);
    expect(progress(s, T0)).toBe(0);
    expect(progress(s, T0 + 12.5 * MIN)).toBeCloseTo(0.5, 9);
    expect(progress(s, T0 + 99 * MIN)).toBe(1);
  });
  it("暂停记下剩余、继续从剩余接着算；空闲时暂停 / 继续不改状态", () => {
    const s = startPhase(initialPomodoro(DAY), "focus", T0);
    const p = pausePomodoro(s, T0 + 5 * MIN);
    expect(isPaused(p)).toBe(true);
    expect(p.endAt).toBeNull();
    expect(p.left).toBe(20 * MIN);
    // 暂停期间时间不走
    expect(remaining(p, T0 + 60 * MIN)).toBe(20 * MIN);
    expect(progress(p, T0 + 60 * MIN)).toBeCloseTo(0.2, 9);
    const r = resumePomodoro(p, T0 + 60 * MIN);
    expect(r.endAt).toBe(T0 + 80 * MIN);
    expect(r.left).toBe(0);
    expect(remaining(r, T0 + 70 * MIN)).toBe(10 * MIN);
    // 重复暂停 / 继续不变
    expect(pausePomodoro(p, T0)).toBe(p);
    expect(resumePomodoro(r, T0)).toBe(r);
    const idle = initialPomodoro(DAY);
    expect(pausePomodoro(idle, T0)).toBe(idle);
    expect(resumePomodoro(idle, T0)).toBe(idle);
    expect(remaining(idle, T0)).toBe(0);
    expect(progress(idle, T0)).toBe(0);
  });
  it("放弃回到空闲、不计完成数；时长只认选项里的值", () => {
    const s = stopPomodoro(startPhase(initialPomodoro(DAY), "focus", T0));
    expect(s.phase).toBe("idle");
    expect(s.done).toBe(0);
    const d = setDurations(initialPomodoro(DAY), { focusMin: 45, breakMin: 10 });
    expect([d.focusMin, d.breakMin]).toEqual([45, 10]);
    const bad = setDurations(d, { focusMin: 33, breakMin: 0 });
    expect([bad.focusMin, bad.breakMin]).toEqual([45, 10]);
    expect(startPhase(d, "focus", T0).endAt).toBe(T0 + 45 * MIN);
    expect(startPhase(d, "break", T0).endAt).toBe(T0 + 10 * MIN);
  });
});

describe("tickPomodoro", () => {
  it("没到点：原对象原样返回；到点：专注 → 完成数 +1、从本该结束的那一刻开始休息；休息 → 空闲", () => {
    const s = startPhase(initialPomodoro(DAY), "focus", T0);
    expect(tickPomodoro(s, T0 + 24 * MIN, DAY)).toEqual({ state: s, event: null });
    expect(tickPomodoro(s, T0 + 24 * MIN, DAY).state).toBe(s);
    // 后台标签页晚了 40 秒才醒：休息按原定的结束时刻起算
    const late = T0 + 25 * MIN + 40_000;
    const { state: b, event } = tickPomodoro(s, late, DAY);
    expect(event).toBe("focus-done");
    expect(b.phase).toBe("break");
    expect(b.done).toBe(1);
    expect(b.endAt).toBe(T0 + 30 * MIN);
    expect(remaining(b, late)).toBe(5 * MIN - 40_000);
    const { state: i, event: e2 } = tickPomodoro(b, T0 + 30 * MIN, DAY);
    expect(e2).toBe("break-done");
    expect(i.phase).toBe("idle");
    expect(i.done).toBe(1);
    // 空闲与暂停都不推进
    expect(tickPomodoro(i, T0 + 99 * MIN, DAY).state).toBe(i);
    const p = pausePomodoro(startPhase(i, "focus", T0), T0 + MIN);
    expect(tickPomodoro(p, T0 + 99 * MIN, DAY)).toEqual({ state: p, event: null });
  });
  it("换天：完成数清零、day 更新（即使没在计时）", () => {
    const s = { ...initialPomodoro(DAY), done: 3 };
    const { state } = tickPomodoro(s, T0, "2026-10-15");
    expect(state.done).toBe(0);
    expect(state.day).toBe("2026-10-15");
    expect(tickPomodoro(s, T0, DAY).state).toBe(s);
  });
});

describe("normalizePomodoro：本地存储读回来的东西不可信", () => {
  it("缺字段 / 类型不对 / 不在选项里的时长 → 初始值；隔天的完成数清零", () => {
    const init = initialPomodoro(DAY);
    expect(normalizePomodoro(null, DAY)).toEqual(init);
    expect(normalizePomodoro("x", DAY)).toEqual(init);
    expect(normalizePomodoro({ phase: "focus", endAt: "soon", focusMin: 33, breakMin: "5", done: -2, day: DAY }, DAY)).toEqual({ ...init, phase: "focus", endAt: null, left: 0 });
    expect(normalizePomodoro({ phase: "idle", endAt: T0, left: 999, focusMin: 60, breakMin: 15, done: 2, day: DAY }, DAY)).toEqual({ ...init, focusMin: 60, breakMin: 15, done: 2 });
    expect(normalizePomodoro({ done: 4, day: "2026-10-13" }, DAY).done).toBe(0);
    expect(normalizePomodoro({ phase: "break", endAt: T0 + MIN, left: 0, day: DAY }, DAY)).toEqual({ ...init, phase: "break", endAt: T0 + MIN });
    expect(normalizePomodoro({ phase: "focus", endAt: null, left: 90_000, day: DAY }, DAY)).toEqual({ ...init, phase: "focus", endAt: null, left: 90_000 });
  });
  it("默认 25 / 5 分钟，选项固定", () => {
    expect([DEFAULT_FOCUS, DEFAULT_BREAK]).toEqual([25, 5]);
    expect(FOCUS_OPTIONS).toEqual([25, 45, 60]);
    expect(BREAK_OPTIONS).toEqual([5, 10, 15]);
  });
});

describe("formatClock", () => {
  it("mm:ss，不足一秒进位；0 与负数都是 00:00", () => {
    expect(formatClock(25 * MIN)).toBe("25:00");
    expect(formatClock(25 * MIN - 1)).toBe("25:00");
    expect(formatClock(25 * MIN - 1000)).toBe("24:59");
    expect(formatClock(61_500)).toBe("01:02");
    expect(formatClock(999)).toBe("00:01");
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(-5)).toBe("00:00");
    expect(formatClock(60 * MIN)).toBe("60:00");
  });
});
