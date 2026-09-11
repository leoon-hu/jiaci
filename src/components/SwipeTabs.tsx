"use client";
import { Children, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * 左右滑动切换的 Tab（单词详情页「释义 / 词频 / …」）。
 * - 顶部 Tab 栏点击切换，也可用左右方向键；
 * - 内容区用 Pointer Events 识别横向拖动（与单词列表的 DragRow 同一套判定：先分辨轴向，横向才接管），
 *   松手时超过阈值或甩动速度足够就切到相邻 Tab，否则弹回；
 * - 视口高度跟随当前面板（ResizeObserver），拖动中取当前与目标面板的较大者，避免裁切。
 */
export default function SwipeTabs({ tabs, index, onChange, children }: { tabs: string[]; index: number; onChange: (i: number) => void; children: ReactNode }) {
  const panels = Children.toArray(children);
  const n = panels.length;
  const viewRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef<Array<HTMLDivElement | null>>([]);
  const sw = useRef<{ x: number; y: number; dx: number; axis: "x" | "y" | null; id: number; t: number; vx: number } | null>(null);
  const suppress = useRef(false);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [height, setHeight] = useState<number | undefined>(undefined);

  const panelH = (i: number) => panelRefs.current[i]?.getBoundingClientRect().height ?? 0;

  // 高度跟随当前面板：内容变化（AI 资料到达、展开记录）时同步
  useLayoutEffect(() => {
    const el = panelRefs.current[index];
    if (!el) return;
    const apply = () => setHeight(el.getBoundingClientRect().height);
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [index, n]);
  useEffect(() => { setDx(0); }, [index]);

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== undefined && e.button !== 0) return;
    sw.current = { x: e.clientX, y: e.clientY, dx: 0, axis: null, id: e.pointerId, t: e.timeStamp, vx: 0 };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const s = sw.current; if (!s) return;
    let d = e.clientX - s.x; const dy = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(d) < 8 && Math.abs(dy) < 8) return;
      s.axis = Math.abs(d) > Math.abs(dy) ? "x" : "y";
      if (s.axis === "x") { try { viewRef.current?.setPointerCapture(s.id); } catch { /* ignore */ } setDragging(true); }
    }
    if (s.axis !== "x") return;
    // 两端没有相邻 Tab 时只允许轻微拉动
    const target = d < 0 ? index + 1 : index - 1;
    if (target < 0 || target >= n) d *= 0.25;
    const dt = e.timeStamp - s.t; if (dt > 0) s.vx = (d - s.dx) / dt;
    s.t = e.timeStamp; s.dx = d; setDx(d);
    if (target >= 0 && target < n) setHeight(Math.max(panelH(index), panelH(target)));
  }
  function end() {
    const s = sw.current; sw.current = null;
    if (!s || s.axis !== "x") return;
    suppress.current = true; setTimeout(() => { suppress.current = false; }, 80);
    setDragging(false);
    const w = viewRef.current?.offsetWidth ?? 320;
    const far = Math.abs(s.dx) > Math.min(w * 0.25, 80);
    const fling = Math.abs(s.dx) > 24 && Math.abs(s.vx) > 0.45 && Math.sign(s.vx) === Math.sign(s.dx);
    const target = s.dx < 0 ? index + 1 : index - 1;
    if ((far || fling) && target >= 0 && target < n) { setDx(0); onChange(target); return; }
    setDx(0); setHeight(panelH(index));
  }
  function cancel() { sw.current = null; setDragging(false); setDx(0); setHeight(panelH(index)); }
  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowRight" && index < n - 1) { e.preventDefault(); onChange(index + 1); }
    if (e.key === "ArrowLeft" && index > 0) { e.preventDefault(); onChange(index - 1); }
  }

  return (
    <div className="tabs-wrap">
      <div className="tabs" role="tablist" onKeyDown={onKey}>
        {tabs.map((t, i) => (
          <button key={t} type="button" role="tab" id={`tab-${i}`} aria-selected={i === index} aria-controls={`tabpanel-${i}`} tabIndex={i === index ? 0 : -1} className={"tab" + (i === index ? " active" : "")} onClick={() => onChange(i)}>{t}</button>
        ))}
      </div>
      <div ref={viewRef} className={"tabs-view" + (dragging ? " dragging" : "")} style={{ height }}
        onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}
        onClickCapture={(e) => { if (suppress.current) { e.stopPropagation(); e.preventDefault(); } }}>
        <div className={"tabs-track" + (dragging ? " dragging" : "")} style={{ transform: `translateX(calc(${-index * 100}% + ${dx}px))` }}>
          {panels.map((p, i) => (
            <div key={i} ref={(el) => { panelRefs.current[i] = el; }} className="tabs-panel" role="tabpanel" id={`tabpanel-${i}`} aria-labelledby={`tab-${i}`} aria-hidden={i !== index} inert={i !== index}>{p}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
