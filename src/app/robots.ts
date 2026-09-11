import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/** 只让搜索引擎收录公开页（落地页、登录、法务）；登录后的页面与接口对爬虫本来就是跳转，明确禁掉免得白爬 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login", "/legal/"], disallow: ["/api/", "/home", "/study", "/wordbooks", "/word/", "/import", "/settings"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
