import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site";

/**
 * 只让搜索引擎收录公开页：落地页、登录、法务，以及匿名可看的词条与词库页 /dict/*（sitemap 索引在 /sitemap.xml，分片在 /sitemap/*）。
 * 登录后的页面（/home 等）不在这里禁：它们对爬虫是跳到登录页的 302，让它爬到这一跳才会从索引里去掉——
 * 用 robots.txt 挡住反而会因为 manifest 里的 start_url 指向 /home 被收录成「已编入索引，尽管遭到 robots.txt 屏蔽」。
 * 接口明确禁掉免得白爬。AI 爬虫不单独拒。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/login", "/legal/", "/dict", "/dict/"], disallow: ["/api/"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
