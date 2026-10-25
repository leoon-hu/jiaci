"use client";
import { Fragment, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconCheckCircle, IconMore, IconNext, IconPause, IconPlay, IconPrev, IconRepeat, IconStop, IconTrendUp, IconX } from "./Icons";

export type RunAct = "prev" | "toggle" | "stop" | "next" | "progress" | "master" | "replay";
export type RunControlsPos = "bottom" | "top";

/**
 * 跑步模式播放中的操作按钮（需求 3.2.6，2026-10-25 改版；之前是底部四个并排的大按钮）：
 * 一个圆形大按钮悬浮在屏幕底部正中（设置「操作按钮位置」可改到顶栏下面），点了弹出一列竖排的大按钮——
 * 上一个 / 暂停或继续 / 停止 / 下一个，分隔线后是对当前词的 加进度 / 已掌握 / 重放（各带一行说明）。
 * 按钮与菜单都 portal 到 body 上：页面里的 sticky 顶栏是层叠上下文，画在它里面会被盖住（同 Modal）。
 * 选任何一项都收起；点遮罩、再点圆形按钮、按 Esc 也收起。play() 要在点击的处理函数里同步调用，onAct 就是同步调的。
 */
export default function RunControls({ pos, playing, onAct }: { pos: RunControlsPos; playing: boolean; onAct: (a: RunAct) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
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
      <button type="button" className={`run-fab ${pos}` + (open ? " open" : "")} aria-label="播放控制" aria-haspopup="menu" aria-expanded={open} data-state={playing ? "playing" : "paused"} onClick={() => setOpen((o) => !o)}>
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
