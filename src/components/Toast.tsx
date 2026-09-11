"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

export type ToastAction = { label: string; onClick: () => void };
type ToastOpts = number | { ms?: number; action?: ToastAction };
type ToastCtx = { toast: (msg: string, opts?: ToastOpts) => void; hideToast: () => void };
const Ctx = createContext<ToastCtx>({ toast: () => {}, hideToast: () => {} });

/** 全局 toast：普通提示 2.2 秒；带 action（如「撤销」）时可点击，默认停留 5 秒 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [action, setAction] = useState<ToastAction | null>(null);
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideToast = useCallback(() => { if (timer.current) clearTimeout(timer.current); timer.current = null; setShow(false); }, []);
  const toast = useCallback((m: string, opts: ToastOpts = 2200) => {
    const o = typeof opts === "number" ? { ms: opts } : opts;
    setMsg(m); setAction(o.action ?? null); setShow(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), o.ms ?? (o.action ? 5000 : 2200));
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <Ctx.Provider value={{ toast, hideToast }}>
      {children}
      <div className={"toast" + (show ? " show" : "") + (action ? " with-action" : "")} role="status" aria-live="polite">
        <span>{msg}</span>
        {action && <button type="button" className="toast-btn" onClick={() => { hideToast(); action.onClick(); }}>{action.label}</button>}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
