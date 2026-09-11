"use client";
import { createContext, useContext } from "react";
import { tokenize } from "@/lib/lemma";

/** 点词回调：把点到的单词（小写）交给外层弹出点词小框 */
export const PickCtx = createContext<(base: string) => void>(() => {});

/** 把一段英文中的每个单词渲染成可点击的 span（需求 3.2.5）；本词及其变形加粗，不再按状态着色 */
export default function WordTokens({ text, headword }: { text: string; headword?: string }) {
  const onPick = useContext(PickCtx);
  const hwParts = headword ? headword.split(" ") : [];
  return (
    <>
      {tokenize(text).map((t, i) => {
        if (!t.word) return <span key={i}>{t.text}</span>;
        const base = t.text.toLowerCase();
        const hw = hwParts.length > 0 && (hwParts.includes(base) || (hwParts.length === 1 && base.startsWith(hwParts[0]) && base.length - hwParts[0].length <= 3));
        return (
          <span key={i} className={"w" + (hw ? " hw" : "")} data-w={base} role="button" tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onPick(base); }} onKeyDown={(e) => { if (e.key === "Enter") onPick(base); }}>{t.text}</span>
        );
      })}
    </>
  );
}
