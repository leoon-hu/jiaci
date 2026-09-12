/**
 * 间隔重复调度（需求 3.2.4）：FSRS（open-spaced-repetition 的开源算法，npm 包 ts-fsrs）。纯函数，不依赖数据库。
 * 模型为每个词维护 stability（记忆稳定性，天）与 difficulty（难度 1–10），按「目标记忆保持率」（默认 90%）安排下次复习；
 * 迟到的复习按实际间隔计算。四种打分映射：认识 → Good，模糊 → Again；已掌握 / 重新记 / 移出是状态操作，不进入模型。
 * 叠加的产品规则：新词或当前间隔 ≤ 1 天打模糊 → 当天重新排队；当天重排后的那次认识按「学习步毕业」处理（见 goodStep）；
 * 安排的间隔达到 master_interval（默认 60 天）→ 已掌握，不再复习。
 * 不用 FSRS 的当天学习步，按天调度；关闭随机扰动，结果可预测、可测试。
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type FSRS } from "ts-fsrs";

export type ProgressStatus = "new" | "learning" | "mastered" | "removed";
export type RateResult = "know" | "fuzzy" | "master" | "reset" | "remove";

export interface ProgressState {
  /** 当前安排的间隔天数（FSRS 的 scheduled_days）；0 = 新词 */
  interval: number;
  /** 记忆稳定性（天）与难度（1–10）；新词为 null */
  stability: number | null;
  difficulty: number | null;
  reps: number;
  lapses: number;
  status: ProgressStatus;
  /** YYYY-MM-DD，null 表示未安排 */
  dueDate: string | null;
  /** 最近一次打分的日期 YYYY-MM-DD，用于计算实际间隔 */
  lastReview: string | null;
}

export const NEW_PROGRESS: ProgressState = { interval: 0, stability: null, difficulty: null, reps: 0, lapses: 0, status: "new", dueDate: null, lastReview: null };
export const DEFAULT_RETENTION = 0.9;
export const DEFAULT_MASTER_INTERVAL = 60;

/** 可在 system_config 调的参数：目标保持率、已掌握阈值、个性化权重（官方优化器拟合的 w 数组） */
export type SchedulerOptions = { retention?: number; masterInterval?: number; w?: readonly number[] };

export interface RateOutcome {
  progress: ProgressState;
  /** 写入 study_log 的 next_interval：0 = 今日再出现，-1 = 不再出现 */
  nextInterval: number;
  /** 当日需要重新排队（模糊-今日、重新记） */
  requeueToday: boolean;
  becameMastered: boolean;
}

const engines = new Map<string, FSRS>();
function engine(o: SchedulerOptions): FSRS {
  const retention = o.retention ?? DEFAULT_RETENTION;
  const key = `${retention}|${o.w?.join(",") ?? ""}`;
  let f = engines.get(key);
  if (!f) {
    f = fsrs(generatorParameters({ request_retention: retention, maximum_interval: 365, enable_fuzz: false, enable_short_term: false, learning_steps: [], relearning_steps: [], ...(o.w?.length ? { w: [...o.w] } : {}) }));
    engines.set(key, f);
  }
  return f;
}

export function addDays(today: string, n: number): string {
  const d = new Date(today + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const dayOf = (d: string) => new Date(d + "T00:00:00Z");
const daysBetween = (a: string, b: string) => Math.round((dayOf(b).getTime() - dayOf(a).getTime()) / 86_400_000);
const todayUtc = () => new Date().toISOString().slice(0, 10);

/** 进度 → FSRS 卡片；新词（或重新记之后）是空卡片，其余按复习态重建，实际间隔按最近打分日期算 */
function toCard(p: ProgressState, today: string): Card {
  if (p.status === "new" || !p.reps || p.stability == null) return createEmptyCard(dayOf(today));
  // 最近打分日期可能晚于「今天」（客户端本地日期领先服务器 UTC 日期，或换了时区），按同一天算，避免负的间隔
  const lastRaw = p.lastReview ?? (p.dueDate ? addDays(p.dueDate, -p.interval) : today);
  const last = daysBetween(lastRaw, today) < 0 ? today : lastRaw;
  return {
    due: dayOf(p.dueDate ?? today), stability: p.stability, difficulty: p.difficulty ?? 5,
    elapsed_days: Math.max(0, daysBetween(last, today)), scheduled_days: p.interval, learning_steps: 0,
    reps: p.reps, lapses: p.lapses, state: State.Review, last_review: dayOf(last),
  };
}
const shortInterval = (p: ProgressState) => !p.reps || p.interval <= 1;
/** 今天打过模糊、被排到队尾等着再来一次的词（模糊-今日的产物；「重新记」清成新卡，stability 为空，不算） */
const requeuedToday = (p: ProgressState, today: string) =>
  p.status === "learning" && p.stability != null && p.interval === 0 && p.lastReview === today;

/**
 * 打「认识」得到的稳定性与间隔。
 *
 * 同一天再打分时 elapsed_days = 0、保持率 = 1，FSRS 的复习公式给不出任何稳定性增长（s' = s），
 * 间隔却被「Good 至少比 Hard 多一天」的阶梯抬到 3 天：到期时模型自己预测的保持率只有 66%，
 * 与需求 3.2.4「把下次复习安排在保持率降到目标值的那一天」直接矛盾（审计 F030）。
 *
 * 我们关掉了 FSRS 的当天学习步，「模糊 → 当天重排 → 认识」这个循环就是本产品的学习步。
 * 所以这一次认识按**学习步毕业**处理：稳定性提到「首次答对但吃力」的水平（w[1]，也就是 Hard 的
 * 初始稳定性；用 max 保证只升不降），间隔再由稳定性反推到保持率正好落到目标值的那天，
 * 并且不超过 FSRS 原本给的天数。新词走这条路的结果是 1 天后再见、到期保持率 92%。
 */
function goodStep(p: ProgressState, today: string, o: SchedulerOptions) {
  const f = engine(o);
  const c = f.next(toCard(p, today), dayOf(today), Rating.Good).card;
  let stability = c.stability;
  let interval = Math.max(1, c.scheduled_days);
  if (requeuedToday(p, today)) {
    stability = Math.max(c.stability, f.parameters.w[1]);
    interval = Math.max(1, Math.min(interval, f.next_interval(stability, 0)));
  }
  return { card: c, stability, interval };
}
/**
 * 学习次数与遗忘次数取「模型给的」与「已累计 + 1」的较大者：
 * 「重新记」会把卡片清成新卡，模型的 reps 从 0 重新数，直接采用会让详情页的次数跳回去（审计 F028）。
 */
const counters = (p: ProgressState, c: Card, lapse: boolean) => ({
  reps: Math.max(c.reps, p.reps + 1),
  lapses: Math.max(c.lapses, p.lapses + (lapse ? 1 : 0)),
});

export function applyRating(p: ProgressState, result: RateResult, today: string, o: SchedulerOptions = {}): RateOutcome {
  const master = o.masterInterval ?? DEFAULT_MASTER_INTERVAL;
  const now = dayOf(today);
  switch (result) {
    case "know": {
      const { card: c, stability, interval: n } = goodStep(p, today, o);
      const mastered = n >= master;
      return {
        progress: { interval: n, stability, difficulty: c.difficulty, ...counters(p, c, false), status: mastered ? "mastered" : "learning", dueDate: mastered ? null : addDays(today, n), lastReview: today },
        nextInterval: mastered ? -1 : n, requeueToday: false, becameMastered: mastered,
      };
    }
    case "fuzzy": {
      const c = engine(o).next(toCard(p, today), now, Rating.Again).card;
      const n = shortInterval(p) ? 0 : Math.max(1, c.scheduled_days);
      return {
        // interval 与 dueDate 必须一致：当日重排时写 0 / 今天，否则写模型安排的天数（审计 F029）
        progress: { interval: n, stability: c.stability, difficulty: c.difficulty, ...counters(p, c, true), status: "learning", dueDate: addDays(today, n), lastReview: today },
        nextInterval: n, requeueToday: n === 0, becameMastered: false,
      };
    }
    case "master":
      return { progress: { ...p, status: "mastered", interval: Math.max(p.interval, master), stability: Math.max(p.stability ?? 0, master), dueDate: null, lastReview: today }, nextInterval: -1, requeueToday: false, becameMastered: true };
    case "reset":
      return { progress: { ...NEW_PROGRESS, reps: p.reps, lapses: p.lapses, dueDate: today, lastReview: today }, nextInterval: 0, requeueToday: true, becameMastered: false };
    case "remove":
      return { progress: { ...p, status: "removed", dueDate: null }, nextInterval: -1, requeueToday: false, becameMastered: false };
  }
}

/** 「认识 / 已掌握」算今天学过；模糊、重新记、移出都不算 */
export const isDone = (r: RateResult) => r === "know" || r === "master";
/**
 * 今天学过的词 = 今天**最后一条**记录是认识 / 已掌握的词（logs 须按打分时间升序）。
 * 认识之后又「重新记」的词已经清成新卡，要能重新进今天的队列、也要能再打认识；
 * 只要「今天有过一条认识」就算学过的话，这种词会在队列与单词列表的「加进度」两边都被拦下——
 * 列表里明明是「未开始」，拖到「加进度」却提示今天学过。
 */
export function doneTodayIds(logs: Array<{ wordId: string; result: RateResult }>): Set<string> {
  const last = new Map<string, RateResult>();
  for (const l of logs) last.set(l.wordId, l.result);
  return new Set([...last].filter(([, r]) => isDone(r)).map(([id]) => id));
}

/** 打分按钮上预先显示的文案（按今天计算，迟到的复习会体现在天数里） */
export function rateLabels(p: ProgressState, o: SchedulerOptions = {}, today = todayUtc()): { know: string; fuzzy: string } {
  const master = o.masterInterval ?? DEFAULT_MASTER_INTERVAL;
  const f = engine(o), now = dayOf(today);
  const good = goodStep(p, today, o).interval;
  const again = shortInterval(p) ? 0 : Math.max(1, f.next(toCard(p, today), now, Rating.Again).card.scheduled_days);
  return { know: good >= master ? "已掌握" : `${good} 天后`, fuzzy: again ? `${again} 天后` : "今日再见" };
}

/** 当前记忆保持率 0–1（新词 / 未安排为 null），供后续「掌握度」展示 */
export function retrievability(p: ProgressState, o: SchedulerOptions = {}, today = todayUtc()): number | null {
  if (p.status !== "learning" || p.stability == null) return null;
  return engine(o).get_retrievability(toCard(p, today), dayOf(today), false);
}
