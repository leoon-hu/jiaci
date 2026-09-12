import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * 只让搜索引擎收录公开页：落地页、登录、法务，以及匿名可看的词条与词库页 /dict/*（sitemap 索引在 /sitemap.xml，分片在 /sitemap/*）。
 * 登录后的页面与接口对爬虫本来就是跳转，明确禁掉免得白爬。AI 爬虫不单独拒。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login", "/legal/", "/dict", "/dict/"], disallow: ["/api/", "/home", "/study", "/wordbooks", "/word/", "/import", "/settings"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
