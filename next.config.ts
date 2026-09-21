import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
