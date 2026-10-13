/**
 * 番茄钟（需求 3.8）的纯逻辑：状态机与时间计算，不碰 window，浏览器与测试共用；
 * 定时器、本地存储、提示音在 lib/client/pomodoro.ts。
 *
 * 时间一律按「结束时刻」算（endAt = 开始时的 Date.now() + 时长），显示时用 now 减——
 * 后台标签页的定时器会被浏览器拖慢，按时刻算回到前台就是准的；刷新页面也接得上。
 */

export type PomodoroPhase = "focus" | "break";
export type PomodoroState = {
  /** idle = 没在计时；focus = 专注；break = 休息 */
  phase: "idle" | PomodoroPhase;
  /** 计时中：这一段的结束时刻（毫秒）；暂停或空闲时 null */
  endAt: number | null;
  /** 暂停时剩下的毫秒；计时中不用（由 endAt 算） */
  left: number;
  /** 专注 / 休息各几分钟（本设备记住） */
  focusMin: number;
  breakMin: number;
  /** 今天完成了几个番茄（专注段走完才算，中途放弃不算） */
  done: number;
  /** done 属于哪一天（YYYY-MM-DD），换天清零 */
  day: string;
};

export const FOCUS_OPTIONS = [25, 45, 60] as const;
export const BREAK_OPTIONS = [5, 10, 15] as const;
export const DEFAULT_FOCUS = 25;
export const DEFAULT_BREAK = 5;
const MINUTE = 60_000;

export const initialPomodoro = (day: string): PomodoroState => ({ phase: "idle", endAt: null, left: 0, focusMin: DEFAULT_FOCUS, breakMin: DEFAULT_BREAK, done: 0, day });

/** 从本地存储读回来的东西不可信：字段缺了 / 类型不对就回到初始值，时长只认选项里的 */
export function normalizePomodoro(raw: unknown, day: string): PomodoroState {
  const init = initialPomodoro(day);
  if (!raw || typeof raw !== "object") return init;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
  const pick = <T extends readonly number[]>(v: unknown, opts: T, d: number) => (typeof v === "number" && (opts as readonly number[]).includes(v) ? v : d);
  const phase = r.phase === "focus" || r.phase === "break" ? r.phase : "idle";
  const sameDay = r.day === day;
  return {
    phase,
    endAt: phase !== "idle" && typeof r.endAt === "number" && Number.isFinite(r.endAt) ? r.endAt : null,
    left: phase !== "idle" ? Math.max(0, num(r.left, 0)) : 0,
    focusMin: pick(r.focusMin, FOCUS_OPTIONS, DEFAULT_FOCUS),
    breakMin: pick(r.breakMin, BREAK_OPTIONS, DEFAULT_BREAK),
    done: sameDay ? Math.max(0, Math.floor(num(r.done, 0))) : 0,
    day,
  };
}

export const phaseMinutes = (s: PomodoroState, phase: PomodoroPhase) => (phase === "focus" ? s.focusMin : s.breakMin);

/** 还剩多少毫秒（不小于 0）；空闲时 0 */
export function remaining(s: PomodoroState, now: number): number {
  if (s.phase === "idle") return 0;
  return Math.max(0, s.endAt === null ? s.left : s.endAt - now);
}

/** 这一段走了多少（0–1），画进度条用 */
export function progress(s: PomodoroState, now: number): number {
  if (s.phase === "idle") return 0;
  const total = phaseMinutes(s, s.phase) * MINUTE;
  return total > 0 ? Math.min(1, Math.max(0, 1 - remaining(s, now) / total)) : 0;
}

export const isRunning = (s: PomodoroState) => s.phase !== "idle" && s.endAt !== null;
export const isPaused = (s: PomodoroState) => s.phase !== "idle" && s.endAt === null;

/** 开始一段（专注或休息）；正在计时的另一段直接被换掉 */
export function startPhase(s: PomodoroState, phase: PomodoroPhase, now: number): PomodoroState {
  return { ...s, phase, endAt: now + phaseMinutes(s, phase) * MINUTE, left: 0 };
}

export function pausePomodoro(s: PomodoroState, now: number): PomodoroState {
  if (!isRunning(s)) return s;
  return { ...s, endAt: null, left: remaining(s, now) };
}

export function resumePomodoro(s: PomodoroState, now: number): PomodoroState {
  if (!isPaused(s)) return s;
  return { ...s, endAt: now + s.left, left: 0 };
}

/** 放弃专注 / 跳过休息：回到空闲，不计入完成数 */
export function stopPomodoro(s: PomodoroState): PomodoroState {
  return { ...s, phase: "idle", endAt: null, left: 0 };
}

export function setDurations(s: PomodoroState, patch: { focusMin?: number; breakMin?: number }): PomodoroState {
  const focusMin = patch.focusMin !== undefined && (FOCUS_OPTIONS as readonly number[]).includes(patch.focusMin) ? patch.focusMin : s.focusMin;
  const breakMin = patch.breakMin !== undefined && (BREAK_OPTIONS as readonly number[]).includes(patch.breakMin) ? patch.breakMin : s.breakMin;
  return { ...s, focusMin, breakMin };
}

export type PomodoroEvent = "focus-done" | "break-done";

/**
 * 时间走到了就推进：专注走完 → 完成数 +1、自动开始休息；休息走完 → 回到空闲。
 * 换天时完成数清零。没到点返回原对象（引用不变，订阅方不用重绘）。
 */
export function tickPomodoro(s: PomodoroState, now: number, day: string): { state: PomodoroState; event: PomodoroEvent | null } {
  let state = s;
  if (day !== s.day) state = { ...state, done: 0, day };
  if (!isRunning(state) || remaining(state, now) > 0) return { state, event: null };
  if (state.phase === "focus") {
    // 从本该结束的那一刻起算休息，后台标签页晚几十秒才醒过来也不会把休息拖长
    const at = state.endAt!;
    return { state: startPhase({ ...state, done: state.done + 1 }, "break", at), event: "focus-done" };
  }
  return { state: stopPomodoro(state), event: "break-done" };
}

/** 剩余毫秒 → 「mm:ss」，不足一秒按一秒进位，所以刚开始显示的是 25:00 而不是 24:59 */
export function formatClock(ms: number): string {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
