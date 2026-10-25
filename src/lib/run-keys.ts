/**
 * 跑步模式播放页的电脑端快捷键（需求 3.2.6 / 3.2.2 第 6 条）：按键 → 操作。
 * 1 加进度 / 3 已掌握与详情页打分的 1 认识 / 3 已掌握同义，用户只用记一套；带修饰键的组合、在输入框里打字时不算。
 */
export type RunAct = "prev" | "toggle" | "stop" | "next" | "progress" | "master" | "replay";
export const RUN_KEYS: Record<RunAct, { key: string; label: string }> = {
  prev: { key: "ArrowLeft", label: "←" },
  toggle: { key: " ", label: "空格" },
  stop: { key: "s", label: "S" },
  next: { key: "ArrowRight", label: "→" },
  progress: { key: "1", label: "1" },
  master: { key: "3", label: "3" },
  replay: { key: "r", label: "R" },
};
export const RUN_KEYS_HINT = "快捷键：空格 暂停 / 继续，← → 上一个 / 下一个，S 停止，1 加进度，3 已掌握，R 重放";

export type KeyLike = { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; editing?: boolean };
/** 这次按键对应哪个操作；字母不分大小写（Shift 不算修饰键），Ctrl / Cmd / Alt 组合与在输入框里打字都返回 null */
export function runShortcut(e: KeyLike): RunAct | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.editing) return null;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  for (const act of Object.keys(RUN_KEYS) as RunAct[]) if (RUN_KEYS[act].key === k) return act;
  return null;
}
