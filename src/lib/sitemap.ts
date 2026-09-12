import { siteUrl } from "./site";

/** sitemap XML 的拼装（公开页 sitemap 索引与各分片共用）；地址一律绝对路径 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const day = (d: Date) => d.toISOString().slice(0, 10);

export type SitemapEntry = { path: string; lastmod?: Date | null; changefreq?: "daily" | "weekly" | "monthly" | "yearly"; priority?: number };

export function sitemapIndexXml(paths: string[]): string {
  const base = siteUrl();
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `<sitemap><loc>${esc(base + p)}</loc></sitemap>`).join("\n")}\n</sitemapindex>\n`;
}

export function urlsetXml(entries: SitemapEntry[]): string {
  const base = siteUrl();
  const item = (e: SitemapEntry) => `<url><loc>${esc(base + e.path)}</loc>${e.lastmod ? `<lastmod>${day(e.lastmod)}</lastmod>` : ""}${e.changefreq ? `<changefreq>${e.changefreq}</changefreq>` : ""}${e.priority != null ? `<priority>${e.priority}</priority>` : ""}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(item).join("\n")}\n</urlset>\n`;
}

/** sitemap 由请求时查库生成，边缘缓存一天；构建机不必连库 */
export const sitemapResponse = (xml: string) => new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=86400, stale-while-revalidate=3600" } });
