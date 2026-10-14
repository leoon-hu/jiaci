"use client";
import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * 全局弹窗。一律 portal 到 body 上画：顶栏 `.app-header`、学习页顶行 `.study-top` 都是 sticky + z-index 的层叠上下文，
 * 弹窗画在它们里面时自己的 z-index 只在那一层内算数，手机底部 Tab 条、打分栏会盖住弹窗下沿（按钮看不见）。
 */
export default function Modal({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">{children}</div>
    </div>,
    document.body,
  );
}
