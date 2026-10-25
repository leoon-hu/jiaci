"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheckCircle, IconMore, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconStop, IconTrendUp, IconX } from "./Icons";
import { RUN_KEYS, RUN_KEYS_HINT, runShortcut, type RunAct } from "@/lib/run-keys";

export type { RunAct };
export type RunControlsPos = "bottom" | "top";

/**
 * 跑步模式播放中的操作按钮（需求 3.2.6，2026-10-25 改版；之前是底部四个并排的大按钮）：
 * 一个圆形大按钮悬浮在屏幕底部正中（设置「操作按钮位置」可改到顶栏下面），点了弹出一列竖排的大按钮——
 * 上一个 / 暂停或继续 / 停止 / 下一个，分隔线后是对当前词的 加进度 / 已掌握 / 重放（各带一行说明）。
 * 按钮与菜单都 portal 到 body 上：页面里的 sticky 顶栏是层叠上下文，画在它里面会被盖住（同 Modal）。
 * 选任何一项都收起；点遮罩、再点圆形按钮、按 Esc 也收起。play() 要在用户手势的处理函数里同步调用，onAct 就是同步调的
 * （键盘的 keydown 也算用户手势）。电脑端快捷键在 lib/run-keys：挂在这里是因为这个组件只在播放中 / 暂停时挂着。
 */
export default function RunControls({ pos, playing, onAct }: { pos: RunControlsPos; playing: boolean; onAct: (a: RunAct) => void }) {
  const [open, setOpen] = useState(false);
  const actRef = useRef(onAct);
  actRef.current = onAct;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  // 快捷键：弹窗（停止确认）开着时不响应；按了就收起菜单。空格 / 方向键要 preventDefault，否则页面会跟着滚
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const editing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
      if (document.querySelector(".modal-backdrop.open")) return;
      const act = runShortcut({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, editing });
      if (!act) return;
      e.preventDefault();
      setOpen(false);
      actRef.current(act);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  if (typeof document === "undefined") return null;
  const act = (a: RunAct) => { setOpen(false); onAct(a); };
  const items: Array<{ act: RunAct; icon: React.ReactNode; label: string; hint?: string; danger?: boolean }> = [
    { act: "prev", icon: <IconPrev />, label: "上一个" },
    { act: "toggle", icon: playing ? <IconPause /> : <IconPlay />, label: playing ? "暂停" : "继续" },
    { act: "stop", icon: <IconStop />, label: "停止", danger: true },
    { act: "next", icon: <IconNext />, label: "下一个" },
    { act: "progress", icon: <IconTrendUp />, label: "加进度", hint: "记一次认识，本次不再播放这个词" },
    { act: "master", icon: <IconCheckCircle />, label: "已掌握", hint: "以后不再学习，本次也不再播放" },
    { act: "replay", icon: <IconRepeat />, label: "重放", hint: "这遍读完后，紧接着再读两遍" },
  ];
  return createPortal(
    <>
      {/* 点完就 blur：按钮留着焦点时，之后按空格会再触发一次按钮的点击（开 / 关菜单），而不是快捷键的暂停 */}
      <button type="button" className={`run-fab ${pos}` + (open ? " open" : "")} aria-label="播放控制" title={RUN_KEYS_HINT} aria-haspopup="menu" aria-expanded={open} data-state={playing ? "playing" : "paused"} onClick={(e) => { e.currentTarget.blur(); setOpen((o) => !o); }}>
        {open ? <IconX /> : <IconMore />}
      </button>
      {open && (
        <div className="run-menu-backdrop" onClick={() => setOpen(false)}>
          <div className={`run-menu ${pos}`} role="menu" aria-label="播放控制" onClick={(e) => e.stopPropagation()}>
            {items.map((it, i) => (
              <Fragment key={it.act}>
                {i === 4 && <hr className="run-menu-sep" />}
                <button type="button" role="menuitem" className={"run-mi" + (it.danger ? " danger" : "")} data-act={it.act} aria-label={it.label} onClick={() => act(it.act)}>
                  {it.icon}
                  <span className="t"><b>{it.label}</b>{it.hint && <small>{it.hint}</small>}</span>
                  <kbd className="run-kbd" aria-hidden="true">{RUN_KEYS[it.act].label}</kbd>
                </button>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
