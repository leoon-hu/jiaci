import WordScreen from "@/components/WordScreen";
import { loadWord } from "./load";

/**
 * 单词详情（独立页）：直接打开链接、刷新、分享进来时走这条路由。
 * 站内点词不会走到这里——会被 `@detail/(.)word/[spelling]` 拦下渲染成浮层（需求 3.2.5）。
 */
export default async function WordPage({ params, searchParams }: { params: Promise<{ spelling: string }>; searchParams: Promise<{ book?: string }> }) {
  const { spelling, initial, initialError } = await loadWord((await params).spelling, (await searchParams).book);
  return <WordScreen key={spelling} mode="page" spelling={spelling} initial={initial} initialError={initialError} />;
}
