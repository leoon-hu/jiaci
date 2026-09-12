import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { bookMetadata, BookPage } from "../book";

export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

type Props = { params: Promise<{ slug: string; page: string }> };

/** 页码：正整数；1 归到不带页码的地址，其余不合法的 404 */
async function pageOf(params: Props["params"]) {
  const { slug, page } = await params;
  if (!/^[1-9]\d{0,3}$/.test(page)) notFound();
  if (page === "1") permanentRedirect(`/dict/book/${slug}`);
  return { slug, page: Number(page) };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> { const p = await pageOf(params); return bookMetadata(p.slug, p.page); }

/** 公开词库页第 2 页起 */
export default async function Page({ params }: Props) { const p = await pageOf(params); return <BookPage slug={p.slug} page={p.page} />; }
