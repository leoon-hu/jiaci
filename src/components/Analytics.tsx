"use client";
import Script from "next/script";
import type { AnalyticsConfig } from "@/lib/analytics";

/**
 * 访问统计的上报脚本（需求 4.1）：根布局按构建期环境变量算出配置后挂在这里；没配置就不渲染。
 * next/script 的 afterInteractive 在水合后插入一个普通 <script>，tracker 读 document.currentScript 拿属性；
 * 站内跳转与返回都由 tracker 自己记（App Router 的跳转是 pushState，返回后它会 replaceState）。
 */
export default function Analytics({ config }: { config: AnalyticsConfig | null }) {
  if (!config) return null;
  return (
    <Script
      src={config.script}
      strategy="afterInteractive"
      data-website-id={config.websiteId}
      data-exclude-search="true"
      {...(config.domain ? { "data-domains": config.domain } : {})}
    />
  );
}
