import { DEFAULT_MASTER_INTERVAL } from "./scheduler";

/**
 * 单词状态四色（需求 1.5）：mastered 绿 / learning 黄 / new 红（未开始） / none 灰（未加入 = 移出学习）。
 * 状态跟着单词走、与词库无关：进度记录本来就是「用户 × 单词」，词库只是单词的子集，「当前词库」只决定哪些词进学习队列。
 * 没有记录（或重新记后还没学）的词在任何词库里都是「未开始」——原先审计 F031 按「不在当前词库就算未加入」，
 * 结果非当前词库的未开始永远是 0、灰色成了「没学过 + 移出」的混合，2026-09-13 撤掉。
 */
export type WordStatus = "mastered" | "learning" | "new" | "none";

export const STATUS_LABEL: Record<WordStatus, string> = { mastered: "已掌握", learning: "学习中", new: "未开始", none: "未加入" };

export function deriveStatus(args: { progressStatus?: "new" | "learning" | "mastered" | "removed" | null }): WordStatus {
  const s = args.progressStatus;
  if (s === "mastered") return "mastered";
  if (s === "learning") return "learning";
  if (s === "removed") return "none";
  return "new";
}

/** 进度饼图填充百分比：未开始 / 未加入 0，学习中按间隔对数增长（1 天约 17%，7 天约 50%，30 天约 84%），已掌握 100 */
export function pieProgress(status: WordStatus, interval: number, masterInterval = DEFAULT_MASTER_INTERVAL): number {
  if (status === "mastered") return 100;
  if (status !== "learning" || !interval) return 0;
  return Math.min(99, Math.round((Math.log1p(Math.min(interval, masterInterval)) / Math.log1p(masterInterval)) * 100));
}
