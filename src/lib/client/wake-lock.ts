"use client";
import { useEffect, useState } from "react";

/** 这个浏览器有没有屏幕唤醒锁（Screen Wake Lock API）；服务端与首次渲染都按没有算，挂载后再定 */
export function useWakeLockSupported(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => { setOk(typeof navigator !== "undefined" && "wakeLock" in navigator); }, []);
  return ok;
}

/**
 * 跑步模式「播放时保持亮屏」（需求 3.2.6）：`on` 为真时持有屏幕唤醒锁，不让屏幕自动熄灭；为假或卸载时释放。
 * 锁只在页面可见时有效：用户手动锁屏、切到别的应用，浏览器会自己释放它（播放照常在后台继续），
 * 回到页面时在 visibilitychange 里重新申请。申请被拒（旧 iOS、内嵌浏览器、低电量模式）就什么都不做。
 */
export function useScreenWakeLock(on: boolean) {
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let sentinel: WakeLockSentinel | null = null;
    let pending = false;
    let cancelled = false;
    const acquire = async () => {
      if (cancelled || pending || sentinel || document.visibilityState !== "visible") return;
      pending = true;
      try {
        const s = await navigator.wakeLock.request("screen");
        // 等待期间已经不需要了（暂停 / 离开页面）：拿到也立刻放掉
        if (cancelled) { s.release().catch(() => {}); return; }
        sentinel = s;
        s.addEventListener("release", () => { if (sentinel === s) sentinel = null; });
      } catch { /* 不支持或被拒绝：静默，播放不受影响 */ }
      finally { pending = false; }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void acquire(); };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [on]);
}
