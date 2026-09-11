import { describe, it, expect } from "vitest";
import { addDays, applyRating, NEW_PROGRESS, rateLabels, retrievability, DEFAULT_MASTER_INTERVAL, DEFAULT_RETENTION, type ProgressState } from "../src/lib/scheduler";

const T = "2026-09-05";
/** 按到期日连续打「认识」，返回每次的间隔 */
function knowUntilMastered(o = {}, max = 12) {
  let p: ProgressState = { ...NEW_PROGRESS }, today = T;
  const seen: number[] = [];
  for (let i = 0; i < max && p.status !== "mastered"; i++) {
    const r = applyRating(p, "know", today, o); p = r.progress; seen.push(r.nextInterval);
    if (p.dueDate) today = p.dueDate;
  }
  return { p, seen };
}

describe("FSRS 调度", () => {
  it("新词 认识 → 学习中，安排在 1 天以上，记录稳定性与难度", () => {
    const r = applyRating(NEW_PROGRESS, "know", T);
    expect(r.progress.status).toBe("learning");
    // interval 由 Math.max(1, …) 兜底，≥ 1 恒真：连同 stability 一起断言才有意义（审计 F159）
    expect(r.progress.interval).toBeGreaterThanOrEqual(1);
    expect(r.progress.interval).toBeLessThanOrEqual(30);
    expect(r.progress.dueDate).toBe(addDays(T, r.progress.interval));
    expect(r.progress).toMatchObject({ reps: 1, lapses: 0, lastReview: T });
    expect(r.progress.stability).toBeGreaterThan(0);
    expect(r.progress.difficulty).toBeGreaterThan(0);
    expect(r.nextInterval).toBe(r.progress.interval);
  });
  it("连续认识：间隔递增，达到 60 天自动已掌握", () => {
    const { p, seen } = knowUntilMastered();
    expect(p.status).toBe("mastered");
    expect(p.dueDate).toBeNull();
    expect(seen.at(-1)).toBe(-1);
    const days = seen.slice(0, -1);
    for (let i = 1; i < days.length; i++) expect(days[i]).toBeGreaterThan(days[i - 1]);
    expect(days.length).toBeGreaterThanOrEqual(3);
    expect(days.length).toBeLessThanOrEqual(8);
  });
  it("已掌握阈值可配：30 天更早掌握；目标保持率调低间隔更长", () => {
    // 用 < 而不是 ≤：阈值参数被忽略时两边相等，≤ 发现不了（审计 F159）
    expect(knowUntilMastered({ masterInterval: 30 }).seen.length).toBeLessThan(knowUntilMastered().seen.length);
    expect(knowUntilMastered({ masterInterval: 30 }).p.interval).toBeGreaterThanOrEqual(30);
    const p = applyRating(NEW_PROGRESS, "know", T).progress;
    const on = applyRating(p, "know", p.dueDate!, { retention: 0.9 }).progress.interval;
    const loose = applyRating(p, "know", p.dueDate!, { retention: 0.8 }).progress.interval;
    expect(loose).toBeGreaterThan(on);
  });
  it("模糊：新词或间隔 ≤ 1 → 今日再出现", () => {
    const r = applyRating(NEW_PROGRESS, "fuzzy", T);
    expect(r.requeueToday).toBe(true);
    expect(r.nextInterval).toBe(0);
    // 当日重排时 interval 与 dueDate 一致：都表示「今天」（审计 F029）
    expect(r.progress).toMatchObject({ interval: 0, status: "learning", dueDate: T, reps: 1 });
    // 同日再打认识：从今日算起安排
    const k = applyRating(r.progress, "know", T);
    expect(k.progress.interval).toBeGreaterThanOrEqual(1);
    expect(k.progress.dueDate).toBe(addDays(T, k.progress.interval));
  });
  it("同日「模糊 → 认识」按学习步毕业：安排 1 天后，到期保持率回到目标值（审计 F030）", () => {
    const fuzzy = applyRating(NEW_PROGRESS, "fuzzy", T).progress;
    const k = applyRating(fuzzy, "know", T);
    // 改之前：稳定性停在 0.212 不动，间隔却被 Good ≥ Hard + 1 的阶梯抬到 3 天，到期只剩 66%
    expect(k.progress.interval).toBe(1);
    expect(k.progress.stability!).toBeGreaterThan(fuzzy.stability!);
    expect(retrievability(k.progress, {}, k.progress.dueDate!)!).toBeGreaterThanOrEqual(DEFAULT_RETENTION);
    // 难度不因为毕业而被抹掉：先模糊过的词仍然比一上来就认识的难
    expect(k.progress.difficulty!).toBeGreaterThan(applyRating(NEW_PROGRESS, "know", T).progress.difficulty!);
    expect(rateLabels(fuzzy, {}, T).know).toBe("1 天后");
  });
  it("学习步毕业之后每次到期的预测保持率都不低于目标值", () => {
    let p = applyRating(applyRating(NEW_PROGRESS, "fuzzy", T).progress, "know", T).progress;
    const seen: number[] = [];
    for (let i = 0; i < 8 && p.status === "learning"; i++) {
      seen.push(retrievability(p, {}, p.dueDate!)!);
      p = applyRating(p, "know", p.dueDate!).progress;
    }
    expect(seen.length).toBeGreaterThan(3);
    // 间隔取整会让保持率在目标值上下各差一点，允许 1 个百分点
    for (const r of seen) expect(r).toBeGreaterThan(DEFAULT_RETENTION - 0.01);
  });
  it("学习步毕业只认「今天模糊过、被排到队尾」这一种：认识后同日再认识、重新记后认识都不受影响", () => {
    const know = applyRating(NEW_PROGRESS, "know", T).progress;
    const twice = applyRating(know, "know", T).progress;
    expect(twice.interval).toBe(know.interval);
    expect(twice.stability).toBeCloseTo(know.stability!, 6);
    // 模糊后隔天才认识：走正常的复习公式，不做毕业处理
    const nextDay = applyRating(applyRating(NEW_PROGRESS, "fuzzy", T).progress, "know", addDays(T, 1)).progress;
    expect(nextDay.interval).toBeGreaterThan(1);
    // 重新记把卡清成新卡，之后的认识等同新词（上面「已掌握 / 重新记 / 移出」一节已断言相等）
    const reset = applyRating(know, "reset", know.dueDate!).progress;
    expect(applyRating(reset, "know", know.dueDate!).progress.interval).toBe(know.interval);
  });
  it("模糊：长间隔的词 → 遗忘次数 +1，稳定性下降，比认识安排得近", () => {
    const mature = knowUntilMastered({ masterInterval: 1000 }, 4).p;   // 打 4 次认识
    expect(mature.interval).toBeGreaterThan(3);
    const day = mature.dueDate!;
    const f = applyRating(mature, "fuzzy", day);
    const k = applyRating(mature, "know", day);
    expect(f.requeueToday).toBe(false);
    expect(f.progress.lapses).toBe(mature.lapses + 1);
    expect(f.progress.stability!).toBeLessThan(mature.stability!);
    expect(f.progress.interval).toBeLessThan(k.progress.interval);
    expect(f.progress.dueDate).toBe(addDays(day, f.progress.interval));
  });
  it("迟到的复习按实际间隔给信用：晚 20 天再认识，下次间隔更长", () => {
    const p = knowUntilMastered({ masterInterval: 1000 }, 3).p;
    const onTime = applyRating(p, "know", p.dueDate!, { masterInterval: 1000 }).progress.interval;
    const late = applyRating(p, "know", addDays(p.dueDate!, 20), { masterInterval: 1000 }).progress.interval;
    expect(late).toBeGreaterThan(onTime);
  });
  it("已掌握 / 重新记 / 移出", () => {
    const p: ProgressState = { ...NEW_PROGRESS, interval: 7, stability: 7, difficulty: 5, reps: 4, lapses: 1, status: "learning", dueDate: "2026-09-12", lastReview: T };
    expect(applyRating(p, "master", T).progress).toMatchObject({ status: "mastered", dueDate: null, interval: DEFAULT_MASTER_INTERVAL, stability: DEFAULT_MASTER_INTERVAL });
    const reset = applyRating(p, "reset", T);
    expect(reset.progress).toMatchObject({ status: "new", interval: 0, stability: null, difficulty: null, reps: 4, lapses: 1, dueDate: T });
    expect(reset.requeueToday).toBe(true);
    expect(applyRating(p, "remove", T).progress).toMatchObject({ status: "removed", dueDate: null });
    // 重新记之后再认识：按新词起步
    // 重新记保留的次数不能被下一次打分清零（审计 F028）
    const afterReset = applyRating(reset.progress, "know", T).progress;
    expect(afterReset.reps).toBeGreaterThanOrEqual(5);
    expect(afterReset.lapses).toBeGreaterThanOrEqual(1);
    expect(applyRating(afterReset, "fuzzy", T).progress.lapses).toBeGreaterThanOrEqual(2);
    const again = applyRating(reset.progress, "know", T).progress;
    expect(again.interval).toBe(applyRating(NEW_PROGRESS, "know", T).progress.interval);
  });
  it("按钮文案与保持率", () => {
    const l = rateLabels(NEW_PROGRESS, {}, T);
    expect(l.fuzzy).toBe("今日再见");
    expect(l.know).toMatch(/^\d+ 天后$/);
    const mature = knowUntilMastered({ masterInterval: 1000 }, 5).p;
    expect(rateLabels(mature, {}, mature.dueDate!).know).toBe("已掌握");
    expect(rateLabels(mature, {}, mature.dueDate!).fuzzy).toMatch(/^\d+ 天后$/);
    expect(retrievability(NEW_PROGRESS)).toBeNull();
    const r = retrievability(mature, {}, mature.dueDate!);
    expect(r).toBeGreaterThan(0.8); expect(r).toBeLessThanOrEqual(1);
  });
  it("最近打分日期晚于今天（客户端日期领先）也不抛错，按同一天算", () => {
    const p = applyRating(NEW_PROGRESS, "know", "2026-09-08").progress;
    expect(() => rateLabels(p, {}, "2026-09-07")).not.toThrow();
    expect(applyRating(p, "know", "2026-09-07").progress.interval).toBeGreaterThanOrEqual(1);
  });
  it("结果确定（关闭随机扰动）", () => {
    expect(applyRating(NEW_PROGRESS, "know", T)).toEqual(applyRating(NEW_PROGRESS, "know", T));
  });
});
