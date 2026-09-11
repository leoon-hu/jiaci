import { DEFAULT_MASTER_INTERVAL } from "./scheduler";

/** 单词状态四色（需求 1.5）：mastered 绿 / learning 黄 / new 红（已加入未开始） / none 灰（未加入） */
export type WordStatus = "mastered" | "learning" | "new" | "none";

export const STATUS_LABEL: Record<WordStatus, string> = { mastered: "已掌握", learning: "学习中", new: "未开始", none: "未加入" };

export function deriveStatus(args: { progressStatus?: "new" | "learning" | "mastered" | "removed" | null; inCurrentBook: boolean }): WordStatus {
  const s = args.progressStatus;
  if (s === "mastered") return "mastered";
  if (s === "learning") return "learning";
  if (s === "removed") return "none";
  // status=new（重新记后）也要看是否在当前词库：不在的话它永远进不了队列，显示红色「未开始」是误导（审计 F031）
  return args.inCurrentBook ? "new" : "none";
}

/** 进度饼图填充百分比：未开始 / 未加入 0，学习中按间隔对数增长（1 天约 17%，7 天约 50%，30 天约 84%），已掌握 100 */
export function pieProgress(status: WordStatus, interval: number, masterInterval = DEFAULT_MASTER_INTERVAL): number {
  if (status === "mastered") return 100;
  if (status !== "learning" || !interval) return 0;
  return Math.min(99, Math.round((Math.log1p(Math.min(interval, masterInterval)) / Math.log1p(masterInterval)) * 100));
}
