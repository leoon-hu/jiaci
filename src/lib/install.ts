/**
 * 安装引导（需求 4.1）的纯逻辑：显不显示、按环境给哪种做法、「怎么做」的步骤。
 * 与 child-education 下另外三个站（同步练 / 拼音学习机 / 识字卡片）是同一套规则（2026-09-16 统一）。
 * 不碰 window，服务端与测试都能 import；浏览器侧的探测与状态在 lib/client/install.ts。
 */

/** 关掉 / 拒绝之后多久再出现：3 天 */
export const INSTALL_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000

/**
 * prompt = 拿到 beforeinstallprompt（Android / 电脑 Chromium），按钮「安装」直接弹系统框；
 * inapp  = 微信 / QQ 等内嵌浏览器，装不了，教他去浏览器打开；
 * ios    = iPhone / iPad，教他点分享 → 添加到主屏幕；
 * menu   = 其它触屏浏览器，「浏览器菜单 → 添加到主屏幕」
 */
export type InstallKind = "prompt" | "inapp" | "ios" | "menu";

export type InstallEnv = {
  /** 已以主屏幕 / 桌面应用方式打开 */
  standalone: boolean;
  /** 本设备装过（appinstalled 或系统框里点了安装） */
  installed: boolean;
  /** 拿到了 beforeinstallprompt */
  hasPrompt: boolean;
  /** 触屏设备（pointer: coarse）；电脑只在能一键安装时提示 */
  touch: boolean;
  /** 微信 / QQ / 微博 / Facebook / Instagram / LINE 内嵌浏览器 */
  inApp: boolean;
  ios: boolean;
};

/** 不看静默期的做法；null = 不引导（已安装 / 电脑没有安装事件）。顺序：能一键安装最优先，内嵌浏览器先于 iOS（iOS 微信里 ios 也为真） */
export function installKind(env: InstallEnv): InstallKind | null {
  if (env.standalone || env.installed) return null;
  if (env.hasPrompt) return "prompt";
  if (!env.touch) return null;
  if (env.inApp) return "inapp";
  if (env.ios) return "ios";
  return "menu";
}

export type InstallStep = { text: string; share?: boolean };

/** 「怎么做」弹窗的步骤（prompt 不需要）。iOS 不在 Safari 里先换 Safari；iPad 的分享按钮在右上角 */
export function installSteps(kind: InstallKind, opts: { iosSafari: boolean; ipad: boolean; host?: string }): InstallStep[] {
  switch (kind) {
    case "inapp":
      return [{ text: "点右上角「···」" }, { text: "选「在浏览器打开」" }, { text: "在浏览器里再按提示安装" }];
    case "ios":
      return [
        ...(opts.iosSafari ? [] : [{ text: `先用 Safari 打开本站${opts.host ? `（${opts.host}）` : ""}` }]),
        { text: opts.ipad ? "点右上角的分享按钮" : "点底部工具栏的分享按钮", share: true },
        { text: "在菜单里向下找到「添加到主屏幕」" },
        { text: "点右上角「添加」，主屏幕上就会出现 AI加词 的图标" },
      ];
    case "menu":
      return [{ text: "点浏览器的菜单（右上角 ⋮ 或底部 ≡）" }, { text: "选「添加到主屏幕」或「安装应用」" }, { text: "确认添加，桌面上就会出现图标" }];
    default:
      return [];
  }
}
