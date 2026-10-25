import type { WordView } from "./word-view";

/**
 * 登录后才看的四块（需求 3.7 P13 / 3.2.5）：助记、词源与构词、易混词、常见错误。
 * 公开词条页不放（取数时就去掉，HTML 与页面内嵌的数据里都没有）；登录后的详情 24 小时内超过上限也去掉。
 * 浏览器与 Node 共用的纯函数。
 */
export type LockedBlocks = { mnemonic: boolean; etymology: boolean; confusables: number; mistakes: number };

/** 本词这四块各有没有 / 有几条（与页面上「有内容才显示」同一口径） */
export function lockedOf(v: WordView): LockedBlocks {
  return {
    mnemonic: !!v.mnemonic,
    etymology: !!v.etymology && (v.etymology.parts.length > 0 || !!v.etymology.origin),
    confusables: v.confusables.length,
    mistakes: v.mistakes.length,
  };
}

export const hasLocked = (l: LockedBlocks) => l.mnemonic || l.etymology || l.confusables > 0 || l.mistakes > 0;

/** 去掉这四块的视图（不改传进来的那个） */
export function withoutLocked(v: WordView): WordView {
  return { ...v, mnemonic: null, etymology: null, confusables: [], mistakes: [] };
}

/** 卡片 / 提示里列出本词有的几块，按详情页上的先后：关联词 Tab 的两块在前，记忆 Tab 的两块在后 */
export function lockedLabels(l: LockedBlocks, only?: "related" | "memory"): string[] {
  const out: string[] = [];
  if (only !== "memory") {
    if (l.confusables > 0) out.push(`易混词 ${l.confusables} 个`);
    if (l.mistakes > 0) out.push(`常见错误 ${l.mistakes} 条`);
  }
  if (only !== "related") {
    if (l.mnemonic) out.push("助记");
    if (l.etymology) out.push("词源与构词");
  }
  return out;
}
