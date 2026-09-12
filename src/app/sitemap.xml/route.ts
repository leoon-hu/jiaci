import { countPublicWords, SITEMAP_SHARD } from "@/lib/public-dict";
import { sitemapIndexXml, sitemapResponse } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/**
 * sitemap 索引：公开页一片（落地页、登录、法务、词典目录、内置词库）+ 词条按拼写每 5000 一片。
 * 手写索引而不用 Next 的 sitemap.ts + generateSitemaps：那套只出分片、不出索引文件。
 */
export async function GET() {
  const shards = Math.ceil((await countPublicWords()) / SITEMAP_SHARD);
  return sitemapResponse(sitemapIndexXml(["/sitemap/pages.xml", ...Array.from({ length: shards }, (_, i) => `/sitemap/words-${i}.xml`)]));
}
