"use client";
import { useEffect, useState } from "react";
import Modal from "./Modal";
import { IconPause, IconTimer } from "./Icons";
import { useToast } from "./Toast";
import { BREAK_OPTIONS, FOCUS_OPTIONS, isPaused, isRunning } from "@/lib/pomodoro";
import { onPomodoroEvent, pomoClock, pomoProgress, setPomoDurations, startFocus, stopPomo, togglePomo, usePomodoro } from "@/lib/client/pomodoro";

/**
 * 番茄钟（需求 3.8）：顶栏右侧一个小按钮，点了弹窗选时长、开始；计时中按钮变成「图标 + mm:ss」的小钟
 * （专注主色、休息绿色、暂停换成暂停图标），点小钟回到弹窗暂停 / 继续 / 放弃。
 * compact：学习卡片页顶行用，空闲时什么都不画。
 */
export default function PomodoroButton({ compact = false }: { compact?: boolean }) {
  const p = usePomodoro();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const { s } = p;
  const active = s.phase !== "idle";
  const paused = isPaused(s);
  useEffect(() => onPomodoroEvent((e, st) => {
    toast(e === "focus-done" ? `专注完成，今天第 ${st.done} 个番茄 🍅 休息 ${st.breakMin} 分钟` : "休息结束，准备好了就开始下一个番茄", 5000);
  }), [toast]);
  if (compact && !active) return null;
  const label = active ? `番茄钟 ${s.phase === "focus" ? "专注" : "休息"}${paused ? "已暂停" : "中"} ${pomoClock(p)}` : "番茄钟";
  return (
    <>
      <button type="button" className={"pomo-btn" + (active ? ` on ${s.phase}` : "") + (paused ? " paused" : "")} onClick={() => setOpen(true)} aria-label={label} title={label}>
        {paused ? <IconPause /> : <IconTimer />}
        {active && <span className="time">{pomoClock(p)}</span>}
      </button>
      <PomodoroModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function PomodoroModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const p = usePomodoro();
  const { s } = p;
  if (s.phase === "idle") {
    return (
      <Modal open={open} onClose={onClose}>
        <h3>番茄钟</h3>
        <p>专注一段时间，到点提醒你休息；剩余时间一直显示在顶栏上。</p>
        <div className="pomo-row"><span>专注</span><div className="seg">{FOCUS_OPTIONS.map((m) => <button key={m} type="button" className={s.focusMin === m ? "active" : ""} onClick={() => setPomoDurations({ focusMin: m })}>{m} 分钟</button>)}</div></div>
        <div className="pomo-row"><span>休息</span><div className="seg">{BREAK_OPTIONS.map((m) => <button key={m} type="button" className={s.breakMin === m ? "active" : ""} onClick={() => setPomoDurations({ breakMin: m })}>{m} 分钟</button>)}</div></div>
        {s.done > 0 && <p className="small muted">今天已完成 {s.done} 个番茄</p>}
        <div className="actions">
          <button type="button" className="btn btn-primary btn-lg pomo-start" onClick={() => { startFocus(); onClose(); }}>开始专注</button>
        </div>
      </Modal>
    );
  }
  const running = isRunning(s);
  return (
    <Modal open={open} onClose={onClose}>
      <h3>番茄钟</h3>
      <div className="pomo-clock">{pomoClock(p)}</div>
      <div className={`pomo-phase ${s.phase}`}>{s.phase === "focus" ? `专注 ${s.focusMin} 分钟` : `休息 ${s.breakMin} 分钟`}{running ? "" : "（已暂停）"}</div>
      <div className="progress thin"><i className={s.phase === "break" ? "ok" : undefined} style={{ width: `${pomoProgress(p) * 100}%` }} /></div>
      <p className="small muted center mt-12">{s.done > 0 ? `今天已完成 ${s.done} 个番茄` : "专注走完算一个番茄，中途放弃不算"}</p>
      <div className="actions">
        <button type="button" className="btn btn-secondary pomo-stop" onClick={() => { stopPomo(); onClose(); }}>{s.phase === "focus" ? "放弃" : "跳过休息"}</button>
        <button type="button" className="btn btn-primary pomo-toggle" onClick={togglePomo}>{running ? "暂停" : "继续"}</button>
      </div>
    </Modal>
  );
}
