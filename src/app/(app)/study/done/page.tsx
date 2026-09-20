"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AppShell from "@/components/AppShell";
import { IconCheck } from "@/components/Icons";
import ShareButton from "@/components/ShareButton";
import "./done.css";

function Done() {
  const p = useSearchParams();
  const extra = p.get("extra") === "1";
  const n = Number(p.get("new") ?? 0), r = Number(p.get("review") ?? 0), rate = p.get("rate") ?? "—";
  return (
    <main className="done-wrap">
      <div className="done-icon"><IconCheck /></div>
      <h1 className="done-title">{extra ? "这一组学完了" : "今日任务已完成"}</h1>
      <p className="done-sub">{extra ? "额外学习的新词明天会安排复习" : "坚持每天学一点，明天见 👋"}</p>
      <div className="recap">
        <div className="stat hi"><b>{n}</b><span>新词</span></div>
        <div className="stat"><b>{r}</b><span>复习</span></div>
        <div className="stat ok"><b>{rate}</b><span>认识率</span></div>
      </div>
      <Link className="btn btn-primary btn-lg btn-block" href="/home">返回首页</Link>
      {/* 学完这一刻最愿意说出去（需求 4.1「开源与分享」）：分享的是今天的成绩 + 站点链接 */}
      <ShareButton className="btn btn-secondary btn-block" text={`我今天在 AI加词 学了 ${n} 个新词、复习 ${r} 个，认识率 ${rate}。免费开源的背单词网站，一起来：`}>📣 分享今天的成绩</ShareButton>
      <div className="again">
        <h4>还有精力？再学一组</h4>
        <p>额外学习一组新词，不影响明天的计划。</p>
        <Link className="btn btn-secondary btn-block" href="/study?extra=1">再学一组</Link>
      </div>
    </main>
  );
}

export default function DonePage() {
  return <AppShell nav="study"><Suspense><Done /></Suspense></AppShell>;
}
