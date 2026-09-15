"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * 安装引导（需求 4.1）：判断当前浏览器能不能把网站加到主屏幕、怎么加。
 * - Chromium（Android / 桌面）：浏览器满足可安装条件时抛 `beforeinstallprompt`，根布局里的内联脚本先把事件
 *   截下来存进 `window.__aiwordInstall`（React 挂载前就可能抛出，组件里再监听会错过），这里拿它调起系统安装框。
 * - iOS：系统没有安装接口，只能提示用户在 Safari 里点分享 → 添加到主屏幕。
 * - 已经以主屏幕应用方式打开（standalone）、本设备装过（`appinstalled`）、微信等内嵌浏览器：不引导。
 */
type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global { interface Window { __aiwordInstall?: InstallPromptEvent | null } }

/** 截获脚本存事件、装完清空时都广播一次，挂着的组件据此重算 */
export const INSTALL_EVENT = "aiword:install";
const INSTALLED_KEY = "aiword.installed";

export type InstallMode = "none" | "prompt" | "ios";
export type InstallInfo = {
  mode: InstallMode;
  /** 手机 / 平板（Android 或 iOS）：首页横幅只在这些设备上出现，桌面只留设置里的入口 */
  mobile: boolean;
  /** iOS 且就在 Safari 里：步骤说明可以直接从「点分享」开始，否则先让用户换 Safari 打开 */
  iosSafari: boolean;
};
const NONE: InstallInfo = { mode: "none", mobile: false, iosSafari: false };

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
/** iPadOS 13 起 Safari 默认报成 Mac，用触点数区分 */
const isIos = () => /iPhone|iPad|iPod/.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobile = () => isIos() || /Android/.test(ua());
/** 微信、QQ、微博、Facebook、Instagram、LINE 等内嵌浏览器没有「添加到主屏幕」 */
const isInApp = () => /MicroMessenger|QQ\/|Weibo|FBAN|FBAV|Instagram|Line\//.test(ua());
const isIosSafari = () => /Safari\//.test(ua()) && !/CriOS|FxiOS|EdgiOS|OPT\/|DuckDuckGo/.test(ua()) && !isInApp();
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function read(): InstallInfo {
  const mobile = isMobile();
  let installed = false;
  try { installed = localStorage.getItem(INSTALLED_KEY) === "1"; } catch { /* ignore */ }
  if (isStandalone() || installed) return { ...NONE, mobile };
  if (window.__aiwordInstall) return { mode: "prompt", mobile, iosSafari: false };
  if (isIos() && !isInApp()) return { mode: "ios", mobile, iosSafari: isIosSafari() };
  return { ...NONE, mobile };
}

/** 当前能否安装与安装方式；`install()` 只在 mode = prompt 时有效，返回用户是否接受 */
export function useInstall(): InstallInfo & { install(): Promise<boolean> } {
  // 挂载前一律 none：服务端渲染没有 UA 与 window，首屏必须和客户端第一次渲染一致
  const [info, setInfo] = useState<InstallInfo>(NONE);
  useEffect(() => {
    const sync = () => setInfo(read());
    sync();
    window.addEventListener(INSTALL_EVENT, sync);
    return () => window.removeEventListener(INSTALL_EVENT, sync);
  }, []);
  const install = useCallback(async () => {
    const e = window.__aiwordInstall;
    if (!e) return false;
    // 一个事件只能 prompt 一次，用掉就清空；用户拒绝后浏览器会在之后的页面加载里再抛
    window.__aiwordInstall = null;
    try {
      await e.prompt();
      const { outcome } = await e.userChoice;
      if (outcome === "accepted") { try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* ignore */ } }
      return outcome === "accepted";
    } catch { return false; }
    finally { window.dispatchEvent(new Event(INSTALL_EVENT)); }
  }, []);
  return { ...info, install };
}
