"use client";
import Link from "next/link";
import { IconPause, IconPlay, IconX } from "./Icons";
import { pause, play, stop, useRunPlayer } from "@/lib/client/run-player";

/** 跑步模式（需求 3.2.6）离开 /run 后主框架底部的小条：当前词、暂停 / 继续、停止，点正文回到跑步页 */
export default function RunPill() {
  const st = useRunPlayer();
  if (st.status !== "playing" && st.status !== "paused") return null;
  const w = st.words[st.index];
  return (
    <div className="run-pill" role="status">
      <Link href="/run" className="body" prefetch={false}>
        <span className="icon">🎧</span>
        <span className="text"><b>{w ? w.display ?? w.spelling : "跑步模式"}</b>{w?.def && <span className="def">{w.def}</span>}</span>
      </Link>
      <button type="button" className="btn btn-icon sm btn-soft" onClick={st.status === "playing" ? pause : play} aria-label={st.status === "playing" ? "暂停" : "继续"}>{st.status === "playing" ? <IconPause /> : <IconPlay />}</button>
      <button type="button" className="btn btn-icon sm btn-ghost" onClick={stop} aria-label="停止跑步模式"><IconX /></button>
    </div>
  );
}
