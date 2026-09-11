import WordScreen from "@/components/WordScreen";
import { loadWord } from "@/app/(app)/word/[spelling]/load";

/**
 * 详情浮层（拦截路由）：站内点词进详情时渲染在 `(app)/layout.tsx` 的 detail 插槽里，
 * 盖在原来的页面之上。底层页面不卸载，返回 = 关掉浮层，不重新请求也不丢滚动位置。
 * 刷新 / 直接打开该 URL 时不走拦截，由 `(app)/word/[spelling]` 渲染整页。
 */
export default async function WordSheetPage({ params }: { params: Promise<{ spelling: string }> }) {
  const { spelling, initial, initialError } = await loadWord((await params).spelling);
  return <WordScreen key={spelling} mode="overlay" spelling={spelling} initial={initial} initialError={initialError} />;
}
