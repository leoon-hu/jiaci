import type { Metadata } from "next";
import { bookMetadata, BookPage } from "./book";

export const revalidate = 86400;
export const dynamicParams = true;
export function generateStaticParams() { return []; }

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> { return bookMetadata((await params).slug, 1); }

/** 公开词库页第 1 页 */
export default async function Page({ params }: Props) { return <BookPage slug={(await params).slug} page={1} />; }
