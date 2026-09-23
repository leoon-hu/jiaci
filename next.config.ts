import type { NextConfig } from "next";

/**
 * 当前版本（需求 3.5 设置「关于 → 版本」，lib/version.ts）：构建时刻的北京时间「2026-09-23 14:05」（与构建机器的时区无关）。
 * 写进 NEXT_PUBLIC_APP_VERSION，构建时内联进页面与服务端（/api/version 回的就是它）。先放进 process.env：
 * next build 的工作进程会重新读这个文件，继承到的值不变，页面与服务端不会差一分钟。
 */
function buildVersion(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}
const APP_VERSION = (process.env.NEXT_PUBLIC_APP_VERSION ||= buildVersion());

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_APP_VERSION: APP_VERSION },
  // 部署用最小产物：.next/standalone（配合 .next/static 与 public 同步到服务器）
  output: "standalone",
  // Edge-TTS 客户端（msedge-tts）走 Node 的 ws 与 axios，打进服务端包后 WebSocket 连不上，保持外部依赖按 Node 方式加载
  serverExternalPackages: ["msedge-tts"],
  // 不对外报框架版本（审计 F127）
  poweredByHeader: false,
  // 末尾斜杠的 308 由中间件自己做：存在的页面才跳到规范地址，不存在的路径直接 404 而不是先重定向一次（见 src/middleware.ts）
  skipTrailingSlashRedirect: true,
  // 基础安全响应头；CSP 涉及 Next 的内联脚本，留待单独评估
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
      ],
    }];
  },
};

export default nextConfig;
