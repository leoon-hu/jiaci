"use client";
import { useCallback, useEffect, useState } from "react";
import { INSTALL_SNOOZE_MS, installKind, type InstallKind } from "@/lib/install";

/**
 * 安装引导（需求 4.1）的浏览器侧：探测环境、拿 beforeinstallprompt、记静默期；规则本身在 lib/install.ts。
 * - Chromium（Android / 桌面）：浏览器满足可安装条件时抛 `beforeinstallprompt`，根布局里的内联脚本先把事件
 *   截下来存进 `window.__aiwordInstall`（React 挂载前就可能抛出，组件里再监听会错过），这里拿它调起系统安装框。
 * - iOS / 内嵌浏览器 / 其它触屏浏览器：没有安装接口，只能按环境教操作（InstallGuide）。
 * - 已经以主屏幕应用方式打开（standalone）、本设备装过（`appinstalled` 或系统框里点了安装）：不引导。
 */
type InstallPromptEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
declare global { interface Window { __aiwordInstall?: InstallPromptEvent | null } }

/** 截获脚本存事件、装完清空时都广播一次，挂着的组件据此重算 */
export const INSTALL_EVENT = "aiword:install";
const INSTALLED_KEY = "aiword.installed";
/** 下一次可显示横幅的时间（ms）；早先存的是关掉的时刻，都在过去，等于没静默 */
const SNOOZE_KEY = "aiword.installTip";

export type InstallInfo = {
  /** 不看静默期的做法；null = 不引导。设置里的常驻入口按它显示 */
  kind: InstallKind | null;
  /** 横幅是否在静默期内（关掉 / 拒绝后 3 天） */
  snoozed: boolean;
  /** iOS 且就在 Safari 里：步骤说明可以直接从「点分享」开始，否则先让用户换 Safari 打开 */
  iosSafari: boolean;
  ipad: boolean;
  /** 触屏设备：设置里的文案按它区分「加到主屏幕」还是「安装到电脑桌面」 */
  touch: boolean;
};
const NONE: InstallInfo = { kind: null, snoozed: true, iosSafari: false, ipad: false, touch: false };

const ua = () => (typeof navigator === "undefined" ? "" : navigator.userAgent);
/** iPadOS 13 起 Safari 默认报成 Mac，用触点数区分 */
const isIPad = () => /iPad/.test(ua()) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isIos = () => /iPhone|iPod/.test(ua()) || isIPad();
/** 微信、QQ、微博、Facebook、Instagram、LINE 等内嵌浏览器没有「添加到主屏幕」 */
const isInApp = () => /MicroMessenger|\bQQ\/|Weibo|FBAN|FBAV|Instagram|Line\//.test(ua());
const isIosSafari = () => isIos() && /Safari\//.test(ua()) && !/CriOS|FxiOS|EdgiOS|OPT\/|DuckDuckGo/.test(ua()) && !isInApp();
const mq = (q: string) => typeof matchMedia === "function" && matchMedia(q).matches;
const isStandalone = () => mq("(display-mode: standalone)") || mq("(display-mode: fullscreen)") || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function read(): InstallInfo {
  let installed = false;
  let until = 0;
  try {
    installed = localStorage.getItem(INSTALLED_KEY) === "1";
    until = Number(localStorage.getItem(SNOOZE_KEY) ?? 0) || 0;
  } catch { /* ignore */ }
  const touch = mq("(pointer: coarse)");
  const kind = installKind({ standalone: isStandalone(), installed, hasPrompt: !!window.__aiwordInstall, touch, inApp: isInApp(), ios: isIos() });
  return { kind, snoozed: Date.now() < until, iosSafari: isIosSafari(), ipad: isIPad(), touch };
}

/**
 * 当前能否安装与安装方式。`install()` 只在 kind = prompt 时有效，返回用户是否接受（接受即记为已安装，拒绝即静默 3 天）；
 * `snooze()` 让横幅 3 天内不再出现
 */
export function useInstall(): InstallInfo & { install(): Promise<boolean>; snooze(): void } {
  // 挂载前一律 none：服务端渲染没有 UA 与 window，首屏必须和客户端第一次渲染一致
  const [info, setInfo] = useState<InstallInfo>(NONE);
  useEffect(() => {
    const sync = () => setInfo(read());
    sync();
    window.addEventListener(INSTALL_EVENT, sync);
    return () => window.removeEventListener(INSTALL_EVENT, sync);
  }, []);
  const snooze = useCallback(() => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + INSTALL_SNOOZE_MS)); } catch { /* ignore */ }
    window.dispatchEvent(new Event(INSTALL_EVENT));
  }, []);
  const install = useCallback(async () => {
    const e = window.__aiwordInstall;
    if (!e) return false;
    // 一个事件只能 prompt 一次，用掉就清空；用户拒绝后浏览器会在之后的页面加载里再抛
    window.__aiwordInstall = null;
    let accepted = false;
    try {
      await e.prompt();
      accepted = (await e.userChoice).outcome === "accepted";
    } catch { accepted = false; }
    try {
      if (accepted) localStorage.setItem(INSTALLED_KEY, "1");
      else localStorage.setItem(SNOOZE_KEY, String(Date.now() + INSTALL_SNOOZE_MS));
    } catch { /* ignore */ }
    window.dispatchEvent(new Event(INSTALL_EVENT));
    return accepted;
  }, []);
  return { ...info, install, snooze };
}
