"use client";
import { useEffect, useRef, useState } from "react";
import { IconChevron } from "./Icons";

export type DropdownOption<T extends string> = { value: T; label: string; /** 右侧灰色小字，如「无资料」 */ note?: string };

/**
 * 自绘下拉选择（替代原生 select：原生弹出层由系统定位，在各端会错位）。
 * 按钮显示当前项，点击在按钮下方展开菜单，当前项带对勾；点外部或 Esc 收起。
 * block = 撑满一行、外观同 .input（列表页排序）；否则是紧凑按钮、菜单靠右对齐（详情页顶部）。
 */
export default function Dropdown<T extends string>({ value, options, onChange, disabled = false, block = false, ariaLabel, className = "" }: {
  value: T; options: Array<DropdownOption<T>>; onChange: (v: T) => void; disabled?: boolean; block?: boolean; ariaLabel: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("click", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = options.find((o) => o.value === value);
  return (
    <div className={"dd" + (block ? " block" : "") + (open ? " open" : "") + (className ? " " + className : "")} ref={ref}>
      <button type="button" className={"dd-btn" + (block ? " input" : "")} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} disabled={disabled} onClick={() => setOpen((o) => !o)}>
        <span className="dd-label">{current?.label ?? ""}</span><span className="chev"><IconChevron /></span>
      </button>
      {open && (
        <div className="dd-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((o) => (
            <button type="button" role="option" aria-selected={o.value === value} className={o.value === value ? "active" : ""} key={o.value} onClick={() => { setOpen(false); if (o.value !== value) onChange(o.value); }}>
              <span className="mark">{o.value === value ? "✓" : ""}</span>{o.label}{o.note && <span className="dd-note">{o.note}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
