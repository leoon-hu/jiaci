import type { WordStatus } from "@/lib/status";

/** 进度饼图：颜色 = 状态，填充 = 进度（空心未开始 / 未加入，实心已掌握） */
export default function Pie({ status, progress, size = 16 }: { status: WordStatus; progress: number; size?: number }) {
  return <span className={`pie st-${status}`} style={{ ["--p" as string]: progress, width: size, height: size }} aria-label={`${status} ${progress}%`} />;
}
