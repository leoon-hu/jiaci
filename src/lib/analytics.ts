/**
 * 访问统计（需求 4.1「访问统计」，2026-09-21 child-education 四个站统一）：自建的 Umami（开源、无 cookie、不存 IP），
 * 页面里只多一行 <script defer>。脚本地址与站点 id 来自构建期环境变量 NEXT_PUBLIC_UMAMI_SCRIPT / NEXT_PUBLIC_UMAMI_WEBSITE_ID
 * （构建机的 .env，不进仓库；根布局按字面量引用，构建时内联进两个包，运行机不用配）：两项都有才加标签，别人自己部署时不配
 * 就什么都不加。data-domains 限定只在正式域名（SITE_URL 的主机名）下上报，本机 next start 不算。
 * 上报的是页面地址、标题、来源、屏幕尺寸、语言；账号、学习记录、查询串（data-exclude-search）都不上报。
 * 站内跳转走 pushState，tracker 自己记；返回键的 popstate 之后 App Router 会 replaceState 一次，tracker 也记到了，
 * 所以这里不像另外三个站那样再补一次（补了就重复，2026-09-21 线上验过）。
 */
export interface AnalyticsConfig {
  script: string;
  websiteId: string;
  /** 只在这个主机名下上报；空 = 不限 */
  domain: string;
}

export function analyticsConfig(env: { script?: string; websiteId?: string; siteUrl?: string }): AnalyticsConfig | null {
  const script = env.script?.trim() ?? "";
  const websiteId = env.websiteId?.trim() ?? "";
  if (!script || !websiteId) return null;
  let domain = "";
  try {
    if (env.siteUrl?.trim()) domain = new URL(env.siteUrl.trim()).hostname;
  } catch {
    domain = "";
  }
  return { script, websiteId, domain };
}
