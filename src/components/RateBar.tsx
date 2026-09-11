"use client";
import { useEffect, useRef, useState } from "react";
import type { RateResult } from "@/lib/scheduler";

type Alt = { action: RateResult; label: string; sub: string; cls: string };

/**
 * 底部悬浮打分栏（需求 3.2.5）：认识 / 模糊 两个按钮；
 * 长按「认识」上滑弹出「已掌握」，长按「模糊」上滑弹出「重新记」；已掌握的词只显示「重新记」。
 * 桌面快捷键：1 认识 2 模糊 3 已掌握 4 重新记。
 */
export default function RateBar({ labels, mastered, removed = false, onRate, disabled }: { labels: { know: string; fuzzy: string }; mastered: boolean; removed?: boolean; onRate: (r: RateResult) => void; disabled?: boolean }) {
  const [tip, setTip] = useState(false);
  const [popup, setPopup] = useState<{ alt: Alt; left: number; width: number; hover: boolean } | null>(null);
  const [pressed, setPressed] = useState<RateResult | null>(null);
  const lp = useRef<{ btn: HTMLButtonElement; alt: Alt; x: number; y: number; timer: ReturnType<typeof setTimeout> | null; active: boolean; cancelled: boolean } | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { setTip(!mastered && !removed && !localStorage.getItem("aiword.lpTip")); } catch { /* ignore */ } }, [mastered, removed]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (disabled) return;
      const t = e.target as HTMLElement; if (/INPUT|TEXTAREA/.test(t.tagName)) return;
      if (document.querySelector(".modal-backdrop.open")) return;
      const map: Record<string, RateResult> = mastered || removed ? { "4": "reset" } : { "1": "know", "2": "fuzzy", "3": "master", "4": "reset" };
      if (map[e.key]) { e.preventDefault(); onRate(map[e.key]); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mastered, removed, onRate, disabled]);

  const reset = () => { const s = lp.current; if (s?.timer) clearTimeout(s.timer); lp.current = null; setPopup(null); setPressed(null); };
  const overPopup = (x: number, y: number) => { const r = popupRef.current?.getBoundingClientRect(); return !!r && x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 40 && y <= r.bottom + 6; };

  function down(e: React.PointerEvent<HTMLButtonElement>, action: RateResult, alt: Alt | null) {
    if (disabled || (e.button !== undefined && e.button !== 0)) return;
    reset();
    const btn = e.currentTarget;
    try { btn.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    setPressed(action);
    lp.current = { btn, alt: alt ?? { action, label: "", sub: "", cls: "" }, x: e.clientX, y: e.clientY, timer: null, active: false, cancelled: false };
    if (alt) {
      lp.current.timer = setTimeout(() => {
        const s = lp.current; if (!s) return;
        s.active = true;
        setPopup({ alt, left: btn.offsetLeft, width: btn.offsetWidth, hover: false });
        try { navigator.vibrate?.(15); } catch { /* ignore */ }
      }, 380);
    }
  }
  function move(e: React.PointerEvent<HTMLButtonElement>) {
    const s = lp.current; if (!s) return;
    if (!s.active) { if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 14) { if (s.timer) clearTimeout(s.timer); s.cancelled = true; setPressed(null); } return; }
    setPopup((p) => (p ? { ...p, hover: overPopup(e.clientX, e.clientY) } : p));
  }
  function up(e: React.PointerEvent<HTMLButtonElement>, action: RateResult) {
    const s = lp.current; if (!s) return;
    let act: RateResult | null = null;
    if (s.active) { if (overPopup(e.clientX, e.clientY)) act = s.alt.action; }
    else if (!s.cancelled) act = action;
    reset();
    if (act) { try { localStorage.setItem("aiword.lpTip", "1"); } catch { /* ignore */ } setTip(false); onRate(act); }
  }
  const btnProps = (action: RateResult, alt: Alt | null) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => down(e, action, alt),
    onPointerMove: move,
    onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => up(e, action),
    onPointerCancel: reset,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClick: (e: React.MouseEvent) => e.preventDefault(),
    className: `rate-btn ${pressed === action ? "pressed" : ""}`,
    disabled,
  });

  // 已掌握 / 已移出的词只给「重新记」：直接打「认识」会把它悄悄放回复习队列（审计 NU08）
  if (mastered || removed) {
    return (
      <div className="rate-bar">
        <div className="rate-hint">{removed ? "该词已移出学习，不再出现" : "该词已掌握，不再进入学习"}</div>
        <div className="inner single"><button {...btnProps("reset", null)} className={"rate-btn rate-reset" + (pressed === "reset" ? " pressed" : "")} aria-keyshortcuts="4">重新记<span className="key" aria-hidden>快捷键 4</span><small>{removed ? "放回当前词库，按新词重新开始背" : "保留学习记录，按新词重新开始背"}</small></button></div>
      </div>
    );
  }
  const MASTER: Alt = { action: "master", label: "已掌握", sub: "不再出现在学习中", cls: "master" };
  const RESET: Alt = { action: "reset", label: "重新记", sub: "保留记录，按新词重背", cls: "reset" };
  return (
    <>
      {popup && <div className="rate-mask" />}
      <div className="rate-bar">
        {tip && <div className="lp-tip">长按「认识」可标记已掌握，长按「模糊」可重新记<button className="lp-tip-close" type="button" onClick={() => { try { localStorage.setItem("aiword.lpTip", "1"); } catch { /* ignore */ } setTip(false); }}>知道了</button></div>}
        <div className="inner" ref={innerRef}>
          {popup && (
            <div ref={popupRef} className={`rate-popup ${popup.alt.cls}${popup.hover ? " hover" : ""}`} style={{ left: popup.left, width: popup.width }}>
              {popup.alt.label}<small>{popup.alt.sub}</small>
            </div>
          )}
          <button {...btnProps("know", MASTER)} className={"rate-btn rate-know" + (pressed === "know" ? " pressed" : "")} aria-keyshortcuts="1">认识<span className="key" aria-hidden>快捷键 1</span><small>{labels.know}</small></button>
          <button {...btnProps("fuzzy", RESET)} className={"rate-btn rate-fuzzy" + (pressed === "fuzzy" ? " pressed" : "")} aria-keyshortcuts="2">模糊<span className="key" aria-hidden>快捷键 2</span><small>{labels.fuzzy}</small></button>
        </div>
      </div>
    </>
  );
}
