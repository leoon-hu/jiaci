import { notFound } from "next/navigation";
import { listPublicWords, loadPublicBooks } from "@/lib/public-dict";
import { dictUrl } from "@/lib/dict-url";
import { sitemapResponse, urlsetXml, type SitemapEntry } from "@/lib/sitemap";

export const dynamic = "force-dynamic";

/** /sitemap/pages.xml 公开页与内置词库（只列第 1 页，其余靠分页链接）；/sitemap/words-<n>.xml 词条分片 */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (name === "pages.xml") {
    const books = await loadPublicBooks();
    const entries: SitemapEntry[] = [
      { path: "/", changefreq: "monthly", priority: 1 },
      { path: "/dict", changefreq: "weekly", priority: 0.8 },
      ...books.map((b): SitemapEntry => ({ path: `/dict/book/${b.slug}`, changefreq: "monthly", priority: 0.7 })),
      { path: "/login", changefreq: "yearly", priority: 0.3 },
      { path: "/legal/privacy", changefreq: "yearly", priority: 0.2 },
      { path: "/legal/terms", changefreq: "yearly", priority: 0.2 },
    ];
    return sitemapResponse(urlsetXml(entries));
  }
  const m = /^words-(\d{1,3})\.xml$/.exec(name);
  if (!m) notFound();
  const words = await listPublicWords(Number(m[1]));
  if (!words.length) notFound();
  return sitemapResponse(urlsetXml(words.map((w) => ({ path: dictUrl(w.spelling), lastmod: w.updatedAt, changefreq: "monthly", priority: 0.6 }))));
}
