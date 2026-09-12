import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { bookBySlug } from "@/lib/public-books";
import { loadPublicBook } from "@/lib/public-dict";
import { siteUrl } from "@/lib/site";
import BookList from "@/components/public/BookList";
import { bookPageUrl } from "@/lib/dict-url";

const fmt = (n: number) => n.toLocaleString("zh-CN");

/** /dict/book/<slug> 与 /dict/book/<slug>/<page> 共用：取数、元数据、结构化数据 */
export async function bookMetadata(slug: string, page: number): Promise<Metadata> {
  const book = bookBySlug(slug);
  const data = book ? await loadPublicBook(book, page) : null;
  if (!data) return { title: "没有这个词库", robots: { index: false } };
  const suffix = page > 1 ? `（第 ${page} 页）` : "";
  const title = `${data.book.name}词汇表${suffix}：${fmt(data.wordCount)} 词，含释义与例句`;
  const description = `${data.book.name}${suffix}共 ${fmt(data.wordCount)} 词：${data.book.blurb} 每个词都有释义、例句、搭配与辨析，无需登录即可查阅。`;
  return { title, description, alternates: { canonical: bookPageUrl(slug, page) }, openGraph: { title: `${data.book.name}词汇表 · AI加词`, description, url: bookPageUrl(slug, page), images: [{ url: "/og.png", width: 1200, height: 630, alt: "AI加词" }] } };
}

export async function BookPage({ slug, page }: { slug: string; page: number }) {
  const book = bookBySlug(slug);
  const data = book ? await loadPublicBook(book, page) : null;
  if (!data) notFound();
  const base = siteUrl();
  const ld = [
    { "@context": "https://schema.org", "@type": "DefinedTermSet", name: `${data.book.name}词汇表`, description: data.book.blurb, url: base + bookPageUrl(slug, 1), numberOfItems: data.wordCount },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "首页", item: `${base}/` },
      { "@type": "ListItem", position: 2, name: "词典", item: `${base}/dict` },
      { "@type": "ListItem", position: 3, name: data.book.name, item: base + bookPageUrl(slug, 1) },
    ] },
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <BookList data={data} />
    </>
  );
}
