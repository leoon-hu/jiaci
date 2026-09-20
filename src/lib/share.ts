/**
 * 「分享给朋友」的纯逻辑（需求 4.1「开源与分享」，2026-09-21 child-education 四个站统一）：按环境决定怎么分享。
 * - 微信 / QQ / 微博内置浏览器：没有系统分享面板，用它们自己右上角的菜单最顺手 → 弹窗教「···」→ 发送给朋友 / 分享到朋友圈；
 * - 有 navigator.share（手机 Safari / Chrome、部分电脑浏览器）→ 直接调系统分享面板；
 * - 其它（多数电脑浏览器）→ 复制一段话 + 链接到剪贴板，弹窗里也能手动选中复制。
 */
export type ShareWay = "wechat" | "native" | "copy";

export interface ShareEnv {
  ua: string;
  canShare: boolean;
}

export function shareWay(env: ShareEnv): ShareWay {
  if (/MicroMessenger|\bQQ\/|Weibo/.test(env.ua)) return "wechat";
  return env.canShare ? "native" : "copy";
}

/** 分享出去的是站点根地址（不带当前页面的路径）；不是 http(s) 打开时退到公开地址 */
export function siteRoot(href: string, fallback: string): string {
  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return fallback;
    return `${u.origin}/`;
  } catch {
    return fallback;
  }
}

/** 分享文案：一句话 + 换行 + 链接（系统分享面板里 text 与 url 分开给，复制时合成一段） */
export function shareMessage(text: string, url: string): string {
  return `${text}\n${url}`;
}

/** 写剪贴板：优先异步 API，没有权限（http、旧浏览器）时退到 execCommand；都不行返回 false，弹窗里让用户手动复制 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 往下退 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
