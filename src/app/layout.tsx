import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import NavTracker from "@/components/NavTracker";
import { siteUrl } from "@/lib/site";

const DESCRIPTION = "功能完整、免费开源的背单词网站：FSRS 间隔重复、21 本内置词库、AI 填充的词条资料、真人级发音，跑步模式熄屏也能循环听今天的词。数据完善、操作易用、无广告、不卖数据；仅中文界面，面向海外英语学习者。";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: "AI加词", template: "%s · AI加词" },
  description: DESCRIPTION,
  // 分享到微信 / Telegram / X 时的预览卡片；图片是 public/og.png（1200×630），登录后的页面沿用同一张
  openGraph: { type: "website", siteName: "AI加词", title: "AI加词", description: DESCRIPTION, locale: "zh_CN", images: [{ url: "/og.png", width: 1200, height: 630, alt: "AI加词" }] },
  twitter: { card: "summary_large_image", title: "AI加词", description: DESCRIPTION, images: ["/og.png"] },
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "AI加词", statusBarStyle: "default" },
  // 图标：src/app/icon.svg 与 favicon.ico 由 Next 自动加上；这里补 iOS 主屏图标
  icons: { apple: "/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#4f6df5" };

/** 主题在首屏渲染前应用，避免闪烁：读 localStorage 的 aiword.theme */
const themeScript = `(function(){try{var t=localStorage.getItem('aiword.theme');if(t==='light'||t==='dark'){document.documentElement.setAttribute('data-theme',t)}}catch(e){}})();`;
/** 基础 PWA：注册 Service Worker（仅生产环境） */
const swScript = `if('serviceWorker' in navigator && location.hostname!=='localhost'){window.addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){})})}`;
/**
 * 安装引导（需求 4.1）：Chromium 的 beforeinstallprompt 可能在 React 挂载前就抛出，这里先截下来存到 window，
 * 并压掉浏览器自己的安装小条（由应用内横幅统一引导，见 lib/client/install.ts）；装完记一笔，横幅与设置入口不再出现
 */
const installScript = `window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__aiwordInstall=e;window.dispatchEvent(new Event('aiword:install'))});window.addEventListener('appinstalled',function(){window.__aiwordInstall=null;try{localStorage.setItem('aiword.installed','1')}catch(e){}window.dispatchEvent(new Event('aiword:install'))});`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
        <script dangerouslySetInnerHTML={{ __html: installScript }} />
      </head>
      <body>
        <NavTracker />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
