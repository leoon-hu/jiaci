import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/Toast";
import NavTracker from "@/components/NavTracker";

export const metadata: Metadata = {
  title: { default: "AI加词", template: "%s · AI加词" },
  description: "AI 驱动的精简背单词",
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: swScript }} />
      </head>
      <body>
        <NavTracker />
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
