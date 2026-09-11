"use client";
import { rankBand, TAG_LABEL, type WordFreq } from "@/lib/dict";

const fmt = (n: number) => n.toLocaleString("zh-CN");

/** 单词详情「词频」Tab：当代语料 / BNC 词频排名、柯林斯星级、牛津 3000、考试标签（数据来自 ECDICT，随 word 表） */
export default function WordFreqPanel({ freq, kind }: { freq: WordFreq; kind: "word" | "phrase" }) {
  const empty = freq.frq == null && freq.bnc == null && freq.collins == null && !freq.oxford && freq.tags.length === 0;
  const rank = (r: number | null) => r == null ? <span className="v none">—</span> : <><span className="v">第 {fmt(r)} 位</span><span className="band">{rankBand(r)}</span></>;
  return (
    <div className="entry-section freq-panel">
      {empty ? <div className="ai-pending">{kind === "phrase" ? "短语暂无词频数据。" : "暂无词频数据。"}</div> : (
        <div className="freq-list">
          <div className="freq-row"><span className="k">当代语料词频</span>{rank(freq.frq)}</div>
          <div className="freq-row"><span className="k">BNC 词频</span>{rank(freq.bnc)}</div>
          <div className="freq-row"><span className="k">柯林斯星级</span>
            {freq.collins ? <span className="v stars" aria-label={`${freq.collins} 星`}>{"★".repeat(freq.collins)}<span className="off">{"★".repeat(5 - freq.collins)}</span></span> : <span className="v none">—</span>}
          </div>
          <div className="freq-row"><span className="k">牛津 3000</span>{freq.oxford ? <span className="v"><span className="chip on">核心词</span></span> : <span className="v none">—</span>}</div>
          <div className="freq-row"><span className="k">考试大纲</span>
            {freq.tags.length ? <span className="v"><span className="chips">{freq.tags.map((t) => <span className="chip" key={t}>{TAG_LABEL[t] ?? t}</span>)}</span></span> : <span className="v none">—</span>}
          </div>
        </div>
      )}
      <p className="freq-note">词频排名越小越常用；柯林斯 5 星最常用。数据来自 ECDICT 词典，短语没有词频排名。</p>
    </div>
  );
}
