import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadPublicWord } from "@/lib/public-dict";
import { dictUrl, pathToSpelling } from "@/lib/dict-url";
import { siteUrl } from "@/lib/site";
import PublicWord from "@/components/public/PublicWord";

/** ISR：首次访问时渲染并缓存，一天后再生成；不预渲染任何词（generateStaticParams 为空），构建机不必连库 */
export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

type Props = { params: Promise<{ spelling: string }> };

/** 标题、描述、canonical 都按词生成；描述取核心义 + 第一条例句 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const spelling = pathToSpelling((await params).spelling);
  const data = spelling ? await loadPublicWord(spelling) : null;
  if (!data) return { title: "没有收录这个词", robots: { index: false } };
  const w = data.display ?? data.spelling;
  const v = data.view;
  const core = v.core ?? "";
  const ex = v.examples[0]?.en ?? "";
  const description = `${w}${core ? `：${core}` : ""}。${w} 的释义、例句、搭配、句型、近反义辨析、词族与词源${ex ? `。例句：${ex}` : ""}`.slice(0, 160);
  const title = `${w} 是什么意思？${w} 的用法、例句与搭配`;
  const url = dictUrl(data.spelling);
  return {
    title, description,
    alternates: { canonical: url },
    openGraph: { type: "article", title: `${w} · AI加词`, description, url, images: [{ url: "/og.png", width: 1200, height: 630, alt: "AI加词" }] },
    twitter: { card: "summary_large_image", title: `${w} · AI加词`, description, images: ["/og.png"] },
  };
}

/** 公开词条页：匿名可看；查不到（不在 word 表）404，不像登录版那样退到词典 */
export default async function PublicWordPage({ params }: Props) {
  const spelling = pathToSpelling((await params).spelling);
  const data = spelling ? await loadPublicWord(spelling) : null;
  if (!data) notFound();
  const w = data.display ?? data.spelling;
  const base = siteUrl();
  // 结构化数据：词条（DefinedTerm）+ 面包屑
  const ld = [
    { "@context": "https://schema.org", "@type": "DefinedTerm", name: w, description: data.view.core ?? undefined, inLanguage: "en", url: base + dictUrl(data.spelling), inDefinedTermSet: { "@type": "DefinedTermSet", name: "AI加词词典", url: `${base}/dict` } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "首页", item: `${base}/` },
      { "@type": "ListItem", position: 2, name: "词典", item: `${base}/dict` },
      ...(data.books[0] ? [{ "@type": "ListItem", position: 3, name: data.books[0].name, item: `${base}/dict/book/${data.books[0].slug}` }] : []),
      { "@type": "ListItem", position: data.books[0] ? 4 : 3, name: w, item: base + dictUrl(data.spelling) },
    ] },
  ];
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <PublicWord data={data} />
    </>
  );
}
