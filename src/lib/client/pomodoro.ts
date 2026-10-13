"use client";
/**
 * 番茄钟（需求 3.8）的浏览器侧：模块级单例，状态存在本设备的 localStorage，顶栏按钮、弹窗、学习页顶行都只订阅它。
 * 每秒一次的 tick 只在计时中开着；时间按结束时刻算（lib/pomodoro 的纯逻辑），后台标签页被拖慢、刷新页面都不会错。
 * 到点：专注 → 自动开始休息、休息 → 回到空闲，各响一声提示音（Web Audio 现合成，不用音频文件）并震动一下。
 */
import { useSyncExternalStore } from "react";
import { localToday } from "./api";
import { formatClock, initialPomodoro, isPaused, isRunning, normalizePomodoro, pausePomodoro, progress, remaining, resumePomodoro, setDurations, startPhase, stopPomodoro, tickPomodoro, type PomodoroEvent, type PomodoroState } from "@/lib/pomodoro";

const KEY = "aiword.pomodoro";

/** 订阅方拿到的快照：状态 + 这次 tick 的时刻（计时中每秒换一个新对象，显示才会跟着走） */
export type PomodoroSnapshot = { s: PomodoroState; now: number };

let snap: PomodoroSnapshot | null = null;
const SERVER: PomodoroSnapshot = { s: initialPomodoro(""), now: 0 };
const listeners = new Set<() => void>();
const eventListeners = new Set<(e: PomodoroEvent, s: PomodoroState) => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let bound = false;

function readStored(): PomodoroState {
  let raw: unknown = null;
  try { raw = JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { /* 坏数据当没有 */ }
  return normalizePomodoro(raw, localToday());
}

/** 第一次用到时从本地存储读；关着页面的时候可能已经到点，先推进（最多两步：专注完 → 休息完） */
function current(): PomodoroSnapshot {
  if (snap) return snap;
  let s = readStored();
  for (let i = 0; i < 2; i++) { const r = tickPomodoro(s, Date.now(), localToday()); if (r.state === s) break; s = r.state; }
  snap = { s, now: Date.now() };
  persist(s);
  bind();
  syncTimer();
  return snap;
}

function persist(s: PomodoroState) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 存不了就只在内存里 */ } }
function notify() { listeners.forEach((l) => l()); }
function commit(s: PomodoroState) { snap = { s, now: Date.now() }; persist(s); notify(); syncTimer(); }

function syncTimer() {
  const running = !!snap && isRunning(snap.s);
  if (running && timer === null) timer = setInterval(tick, 1000);
  if (!running && timer !== null) { clearInterval(timer); timer = null; }
}

function tick() {
  if (!snap) return;
  const now = Date.now();
  const r = tickPomodoro(snap.s, now, localToday());
  if (r.state !== snap.s) commit(r.state);
  else { snap = { s: snap.s, now }; notify(); }
  if (r.event) { chime(); eventListeners.forEach((l) => l(r.event!, r.state)); }
}

/** 回到前台立刻对一次表；别的标签页改了就跟着换（两个标签页各自计时会各响一次） */
function bind() {
  if (bound || typeof window === "undefined") return;
  bound = true;
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  window.addEventListener("storage", (e) => { if (e.key === KEY) { snap = { s: readStored(), now: Date.now() }; notify(); syncTimer(); } });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function usePomodoro(): PomodoroSnapshot { return useSyncExternalStore(subscribe, current, () => SERVER); }
/** 到点事件（专注完成 / 休息结束）：页面层挂 toast */
export function onPomodoroEvent(l: (e: PomodoroEvent, s: PomodoroState) => void) { eventListeners.add(l); return () => { eventListeners.delete(l); }; }

// ---- 操作：都在用户点击里调，顺带解锁提示音 ----
export function startFocus() { unlockChime(); commit(startPhase(current().s, "focus", Date.now())); }
export function pausePomo() { commit(pausePomodoro(current().s, Date.now())); }
export function resumePomo() { unlockChime(); commit(resumePomodoro(current().s, Date.now())); }
export function togglePomo() { if (isRunning(current().s)) pausePomo(); else if (isPaused(current().s)) resumePomo(); }
/** 放弃专注 / 跳过休息 */
export function stopPomo() { commit(stopPomodoro(current().s)); }
export function setPomoDurations(patch: { focusMin?: number; breakMin?: number }) { commit(setDurations(current().s, patch)); }

export const pomoRemaining = (p: PomodoroSnapshot) => remaining(p.s, p.now);
export const pomoProgress = (p: PomodoroSnapshot) => progress(p.s, p.now);
export const pomoClock = (p: PomodoroSnapshot) => formatClock(pomoRemaining(p));

// ---- 提示音：一个 AudioContext，在用户点击里建好（iOS 要求），到点时合成两个短音 ----
let ctx: AudioContext | null = null;
function unlockChime() {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch { ctx = null; }
}
function chime() {
  try { navigator.vibrate?.([150, 80, 150]); } catch { /* 不支持 */ }
  if (!ctx) return;
  const play = () => {
    const t0 = ctx!.currentTime;
    [[880, 0], [1174.7, 0.18]].forEach(([freq, at]) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.35);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + 0.4);
    });
  };
  if (ctx.state === "suspended") ctx.resume().then(play).catch(() => { /* 浏览器不让响 */ });
  else play();
}
