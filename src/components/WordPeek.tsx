"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client/api";
import { speakWord, voiceKeyOf } from "@/lib/client/speech";
import { STATUS_LABEL, type WordStatus } from "@/lib/status";
import { IconSpeaker, IconX } from "./Icons";

type Peek = { spelling: string; display?: string | null; status: WordStatus; phonetic: { us: string; uk: string } | null; core: string | null; meanings: Array<{ pos: string; defs: string[] }>; stopword?: boolean };

/**
 * 点击单词后页面下部弹出的小框：发音 + 核心义 + 释义，点击进入详情（需求 3.2.5）。
 * `book` = 所在详情按哪本词库的进度算：状态按同一本查、进详情也带过去，免得同一个词在小框里和详情里两个状态
 */
export default function WordPeek({ word, book, accent, voice = "female", onClose, autoSpeak = true }: { word: string | null; book?: string | null; accent: "us" | "uk"; voice?: "female" | "male"; onClose: () => void; autoSpeak?: boolean }) {
  const vk = voiceKeyOf(accent, voice);
  const [data, setData] = useState<Peek | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  useEffect(() => {
    if (!word) { setData(null); return; }
    let alive = true;
    setLoading(true);
    // 等查到原形再发音：直接读点到的变形会念错，还会为每个变形触发一次按需合成（审计 NU07）
    api<Peek>(`/api/words/peek?w=${encodeURIComponent(word)}${book ? `&book=${book}` : ""}`)
      .then((d) => { if (!alive) return; setData(d); if (autoSpeak && !d.stopword) speakWord(d.spelling, vk); })
      .catch(() => { if (alive) setData(null); })
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [word, book, vk, autoSpeak]);
  useEffect(() => {
    if (!word) return;
    const onDoc = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!t.closest("#peek") && !t.closest(".w")) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("click", onDoc); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [word, onClose]);
  if (!word) return null;
  const bar = typeof document !== "undefined" ? document.querySelector<HTMLElement>(".rate-bar") : null;
  const bottom = (bar?.offsetHeight ?? 0) + 10;
  const status = data?.status ?? "none";
  return (
    <div className="peek" id="peek" style={{ bottom }} onClick={() => router.push(`/word/${encodeURIComponent(data?.spelling ?? word)}${book ? `?book=${book}` : ""}`, { scroll: false })}>
      <div className="peek-head">
        <span className="peek-word">{data?.display ?? data?.spelling ?? word}</span>
        <span className={`tag tag-${status === "new" ? "new" : status === "none" ? "none" : status}`}>{STATUS_LABEL[status]}</span>
        <span className="phonetic">{data?.phonetic ? (accent === "uk" ? data.phonetic.uk : data.phonetic.us) : "—"}</span>
        <button className="btn btn-icon sm btn-soft" type="button" aria-label="发音" onClick={(e) => { e.stopPropagation(); speakWord(data?.spelling ?? word, vk); }}><IconSpeaker /></button>
        <button className="btn btn-icon sm btn-ghost peek-close" type="button" aria-label="关闭" onClick={(e) => { e.stopPropagation(); onClose(); }}><IconX /></button>
      </div>
      <div className="peek-def">
        {loading && !data ? <span className="faint">查询中…</span> : data?.stopword ? <span className="faint">常用功能词，不提供学习资料</span> : (
          <>
            {data?.core && <div className="peek-core">{data.core}</div>}
            {data?.meanings?.length ? data.meanings.map((m, i) => (<div key={i}>{m.pos && <span className="pos">{m.pos}</span>}{m.defs.join("；")}</div>)) : !data?.core && <span className="faint">暂无资料</span>}
          </>
        )}
      </div>
      <div className="peek-foot"><span>点击小框进入单词详情</span><span className="go">查看详情 ›</span></div>
    </div>
  );
}
